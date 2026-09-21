import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { applyAllRosterDefaults } from './rosterDefaults.service.js';

// ---------------------------------------------------------------------------
// Duty roster generation — CREATE_DUTY_ROSTER_PRO
//
// A new employee has no roster rows, so attendance, the monthly duty roster and
// every report built on TMS_DUTY_ROSTER_V show nothing for them until the
// roster is generated. This runs the ERP's own procedure to fill that in.
//
// Three properties of the procedure drive everything here:
//
//   1. It takes no arguments — it is global, not per-employee. It reads
//      CR_ROSTER_V, which already filters to `roster_status = 0`, i.e. only
//      employee/date pairs with no DUTY_ROSTER row yet, for active employees
//      from their joining date across SYSDATE-60..SYSDATE+60. So it only ever
//      ADDS missing days and never rewrites an existing roster.
//
//   2. It is slow. A measured run took over six minutes: the insert loop is
//      quick, but the holiday/late/absent UPDATE passes scan all 152,000
//      DUTY_ROSTER rows, and some compare the DATE column against a string,
//      which forces a conversion per row and rules out the indexes. Calling it
//      inline would leave HR staring at a frozen "Save" and time the request
//      out, so it runs detached and the employee is saved immediately.
//
//   3. It COMMITs internally, several times. It therefore gets its own
//      connection — sharing one would commit whatever else that connection had
//      in flight.
//
// Runs are serialised. Two people adding employees a minute apart must not
// start two six-minute passes over the same table, so a second request while
// one is running just sets a flag: exactly one more pass follows, which picks
// up every employee added in the meantime.
// ---------------------------------------------------------------------------

let running = null;      // the in-flight run, or null
let rerunQueued = false; // an employee was created while a run was in progress

const runProcedure = async (reason) => {
  const startedAt = Date.now();
  let connection;
  try {
    connection = await getDirectConnection();
    logger.info(`[ROSTER_GEN] CREATE_DUTY_ROSTER_PRO started (${reason})`);
    await connection.execute(`BEGIN CREATE_DUTY_ROSTER_PRO; END;`);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    logger.info(`[ROSTER_GEN] CREATE_DUTY_ROSTER_PRO finished in ${secs}s (${reason})`);
    return { status: 'success', seconds: secs };
  } catch (e) {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    // Never rethrow: the employee is already saved and committed, and a roster
    // that failed to build is a background problem, not a failed creation.
    logger.error(
      `[ROSTER_GEN] CREATE_DUTY_ROSTER_PRO failed after ${secs}s (${reason}): ${e.message ?? e}`,
    );
    return { status: 'error', message: String(e.message ?? e), seconds: secs };
  } finally {
    await connection?.close();
  }
};

/**
 * The window the ERP procedure fills, and therefore the window whose new days
 * need the branch default applied. CR_ROSTER_V works SYSDATE-60..SYSDATE+60;
 * only the future half is reshaped, because rewriting the shift on days that
 * have already been worked would change attendance history.
 */
const defaultsWindow = () => {
  const ymd = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 60);
  return { from: ymd(today), to: ymd(end) };
};

const drain = async (reason) => {
  let result = await runProcedure(reason);
  // Anything requested mid-run gets one more pass, so nobody added during a
  // build is left without a roster.
  while (rerunQueued) {
    rerunQueued = false;
    result = await runProcedure('queued while a build was running');
  }

  // The ERP stamps every generated day 'G' (or 'R' on Sunday) regardless of
  // what the branch actually runs — that decision is hardcoded in the
  // INSERT_PK_ROSTER trigger. Reshape the days it just created to the branch's
  // configured default. Days HR has edited by hand are left alone, so this is
  // safe to run after every build.
  //
  // Deliberately outside the success check: a procedure that failed part-way
  // may still have inserted days, and a branch with no configuration is a
  // no-op anyway.
  try {
    const { from, to } = defaultsWindow();
    await applyAllRosterDefaults(from, to);
  } catch (e) {
    // A roster that generated correctly must not be reported as failed because
    // the defaults pass stumbled.
    logger.error(`[ROSTER_GEN] applying branch shift defaults failed: ${e.message ?? e}`);
  }

  return result;
};

/**
 * Ask for the duty roster to be brought up to date.
 *
 * Returns immediately — the caller is not made to wait for a multi-minute
 * procedure. Awaiting the returned promise is only useful in tests or a manual
 * trigger; normal callers fire and forget.
 *
 * @param {string} reason  what prompted the build, for the log line
 */
export const requestDutyRosterBuild = (reason = 'unspecified') => {
  if (running) {
    rerunQueued = true;
    logger.info(`[ROSTER_GEN] build already running — queued a follow-up (${reason})`);
    return running;
  }
  running = drain(reason).finally(() => {
    running = null;
  });
  return running;
};

/** Whether a build is in progress — used by the status endpoint. */
export const isDutyRosterBuildRunning = () => running !== null;
