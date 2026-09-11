/**
 * Attendance punch idempotency.
 *
 * The phone sends its own CLIENT_EVENT_ID with a punch and retries the SAME id
 * when a response goes missing. That retry must be answered with the original
 * answer, never processed again: the server converts a second tap more than an
 * hour after check-in into a check-OUT, so a replayed check-in could end the
 * employee's day.
 *
 * Two layers, because they fail in different ways:
 *   LMS_PUNCH_EVENT — durable, survives a restart, shared by every worker.
 *   an in-process map — answers the concurrent case (two retries in flight at
 *                       once) without a round trip, and keeps the guarantee
 *                       alive if the table has not been created yet.
 *
 * A punch that FAILED releases its id: nothing was stored, so a retry with the
 * same id should genuinely try again rather than replay the failure.
 */

import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';

const OBJ = { outFormat: 4002 };
const ORA_UNIQUE_VIOLATION = 'ORA-00001';
const ORA_TABLE_MISSING = 'ORA-00942';

/** How long a completed result stays replayable in memory. */
const MEMORY_TTL_MS = 15 * 60 * 1000;

/** How long to wait for an attempt that is still running elsewhere. */
const PENDING_WAIT_MS = 3000;
const PENDING_POLL_MS = 250;

/** Completed results are dropped from the table after this many days. */
const RETENTION_DAYS = 7;

/** Set once the table turns out to be missing, so we stop probing it. */
let durableStoreAvailable = true;

/** client_event_id -> { at, result } | { at, pending: true } */
const memory = new Map();

const sweepMemory = () => {
  const cutoff = Date.now() - MEMORY_TTL_MS;
  for (const [k, v] of memory) {
    if (v.at < cutoff) memory.delete(k);
  }
};

const rememberInMemory = (id, value) => {
  sweepMemory();
  memory.set(id, { at: Date.now(), ...value });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Oracle CLOBs come back as streams unless asked for as strings. */
const readResultJson = (raw) => {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    logger.info(`[PUNCH_IDEMPOTENCY] stored result was not readable JSON: ${e.message ?? e}`);
    return null;
  }
};

/**
 * Try to become the owner of this punch.
 *
 * Returns one of:
 *   { claimed: true }                     — go ahead and mark attendance
 *   { claimed: false, replay: {...} }     — answer with this stored result
 *   { claimed: false, replay: null }      — a twin attempt is running and never
 *                                           finished; caller decides (it falls
 *                                           back to reporting today's real state
 *                                           rather than punching twice)
 */
export const claimPunch = async (clientEventId, cardNo) => {
  const id = String(clientEventId ?? '').trim();
  if (!id) return { claimed: true };  // no id sent (older builds) — nothing to dedupe

  // ---- In-process first: catches concurrent retries with no DB round trip ----
  const known = memory.get(id);
  if (known && Date.now() - known.at < MEMORY_TTL_MS) {
    if (known.result) return { claimed: false, replay: known.result };
    // A twin is mid-flight in this process. Wait for it rather than racing it.
    const deadline = Date.now() + PENDING_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(PENDING_POLL_MS);
      const now = memory.get(id);
      if (now?.result) return { claimed: false, replay: now.result };
    }
    return { claimed: false, replay: null };
  }

  rememberInMemory(id, { pending: true });

  if (!durableStoreAvailable) return { claimed: true };

  // ---- Durable claim: the PK is the whole guarantee ----
  let connection;
  try {
    connection = await getDirectConnection();
    try {
      await connection.execute(
        `INSERT INTO LMS_PUNCH_EVENT (CLIENT_EVENT_ID, CARD_NO, ATTENDANCE_DATE, STATE)
         VALUES (:ceid, :card, TRUNC(SYSDATE), 'IN_PROGRESS')`,
        { ceid: id, card: String(cardNo ?? '').slice(0, 30) },
        { autoCommit: true },
      );
      return { claimed: true };
    } catch (e) {
      const msg = String(e.message ?? e);

      if (msg.includes(ORA_TABLE_MISSING)) {
        // The migration has not been run. Keep working on the memory layer
        // alone and say so once, loudly enough to be noticed.
        durableStoreAvailable = false;
        logger.error(
          '[PUNCH_IDEMPOTENCY] LMS_PUNCH_EVENT is missing — run ' +
            'LMS-Backend/sql/2026-09-10_attendance_punch_idempotency.sql. ' +
            'Replay protection is in-memory only until then and will not survive a restart.',
        );
        return { claimed: true };
      }

      if (!msg.includes(ORA_UNIQUE_VIOLATION)) throw e;

      // Someone already claimed this id. Read their answer, waiting briefly if
      // they have not finished writing it yet.
      const deadline = Date.now() + PENDING_WAIT_MS;
      for (;;) {
        const r = await connection.execute(
          `SELECT STATE AS "state", HTTP_STATUS AS "http_status",
                  TO_CHAR(RESULT_JSON) AS "result_json"
             FROM LMS_PUNCH_EVENT WHERE CLIENT_EVENT_ID = :ceid`,
          { ceid: id },
          OBJ,
        );
        const row = r.rows?.[0];

        // The owner failed and released the id — this attempt takes it over.
        if (!row) {
          rememberInMemory(id, { pending: true });
          return { claimed: true };
        }

        if (row.state === 'DONE') {
          const result = {
            http_status: row.http_status ?? 200,
            body: readResultJson(row.result_json),
          };
          if (result.body) {
            rememberInMemory(id, { result });
            logger.info(`[PUNCH_IDEMPOTENCY] replayed punch ${id} for card=${cardNo}`);
            return { claimed: false, replay: result };
          }
          return { claimed: false, replay: null };
        }

        if (Date.now() >= deadline) {
          logger.warn(
            `[PUNCH_IDEMPOTENCY] punch ${id} for card=${cardNo} is still IN_PROGRESS after ` +
              `${PENDING_WAIT_MS}ms — answering with today's stored state instead of punching again`,
          );
          return { claimed: false, replay: null };
        }
        await sleep(PENDING_POLL_MS);
      }
    }
  } catch (e) {
    // Never let the guard itself block a punch. Worst case we lose replay
    // protection for this one request, which is exactly today's behaviour.
    logger.info(`[PUNCH_IDEMPOTENCY] claim failed for ${id}: ${e.message ?? e}`);
    return { claimed: true };
  } finally {
    await connection?.close();
  }
};

/** Store the answer this punch produced, so a replay is answered with it. */
export const completePunch = async (clientEventId, httpStatus, body) => {
  const id = String(clientEventId ?? '').trim();
  if (!id) return;

  const result = { http_status: httpStatus, body };
  rememberInMemory(id, { result });

  if (!durableStoreAvailable) return;

  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(
      `UPDATE LMS_PUNCH_EVENT
          SET STATE = 'DONE', HTTP_STATUS = :st, RESULT_JSON = :body, COMPLETED_AT = SYSDATE
        WHERE CLIENT_EVENT_ID = :ceid`,
      { st: httpStatus, body: JSON.stringify(body ?? {}), ceid: id },
      { autoCommit: true },
    );
    await sweepOldEvents(connection);
  } catch (e) {
    logger.info(`[PUNCH_IDEMPOTENCY] could not store result for ${id}: ${e.message ?? e}`);
  } finally {
    await connection?.close();
  }
};

/**
 * Give the id back after a punch that stored nothing.
 *
 * A business rejection or a crash means there is no attendance to protect, so
 * the employee's next attempt — same id or not — must be a real attempt.
 */
export const releasePunch = async (clientEventId) => {
  const id = String(clientEventId ?? '').trim();
  if (!id) return;
  memory.delete(id);
  if (!durableStoreAvailable) return;

  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(
      `DELETE FROM LMS_PUNCH_EVENT WHERE CLIENT_EVENT_ID = :ceid AND STATE = 'IN_PROGRESS'`,
      { ceid: id },
      { autoCommit: true },
    );
  } catch (e) {
    logger.info(`[PUNCH_IDEMPOTENCY] could not release ${id}: ${e.message ?? e}`);
  } finally {
    await connection?.close();
  }
};

/**
 * Drop events older than the retention window. Runs occasionally rather than on
 * every punch — this is housekeeping, not part of the guarantee.
 */
const sweepOldEvents = async (connection) => {
  if (Math.random() > 0.01) return;
  try {
    const r = await connection.execute(
      `DELETE FROM LMS_PUNCH_EVENT WHERE CREATED_AT < TRUNC(SYSDATE) - :days`,
      { days: RETENTION_DAYS },
      { autoCommit: true },
    );
    if (r.rowsAffected) {
      logger.info(`[PUNCH_IDEMPOTENCY] swept ${r.rowsAffected} event(s) older than ${RETENTION_DAYS} days`);
    }
  } catch (e) {
    logger.info(`[PUNCH_IDEMPOTENCY] sweep failed: ${e.message ?? e}`);
  }
};
