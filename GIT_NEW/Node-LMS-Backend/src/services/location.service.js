import { getDirectConnection } from "../config/database.js";
import { safeInt } from "../utils/conversionHelpers.js";
import { logger } from '../utils/logger.js';
import {
  buildNumericInClause,
  buildStringInClause,
} from "../utils/buildInClause.js";
import {
  getSessionWindows,
  isWithinAnyWindow,
  addDaysYmd,
  utcNaiveToLocalYmd,
} from "./sessionWindow.service.js";

// Format a Date's components (local or UTC) as a naive Oracle timestamp string
// "YYYY-MM-DD HH24:MI:SS.FF6" — no timezone, matching Python's naive datetime.
const fmtNaive = (d, useUtc) => {
  const p2 = (n) => String(n).padStart(2, '0');
  const y = useUtc ? d.getUTCFullYear() : d.getFullYear();
  const mo = (useUtc ? d.getUTCMonth() : d.getMonth()) + 1;
  const da = useUtc ? d.getUTCDate() : d.getDate();
  const h = useUtc ? d.getUTCHours() : d.getHours();
  const mi = useUtc ? d.getUTCMinutes() : d.getMinutes();
  const s = useUtc ? d.getUTCSeconds() : d.getSeconds();
  const ms = useUtc ? d.getUTCMilliseconds() : d.getMilliseconds();
  return `${y}-${p2(mo)}-${p2(da)} ${p2(h)}:${p2(mi)}:${p2(s)}.${String(ms).padStart(3, '0')}000`;
};

// Resolve an incoming `recorded_at` into a naive Oracle timestamp string, byte-
// for-byte matching the FastAPI backend (repositories/location_repository.py):
//   - missing        → current UTC time (datetime.utcnow)
//   - ISO string     → the literal wall-clock, with any Z/±offset STRIPPED (not
//                       converted) — mirrors datetime.fromisoformat(...).replace(tzinfo=None)
//   - unparseable    → current LOCAL time (datetime.now)
// Bound as a string via TO_TIMESTAMP so the stored value never depends on the
// Oracle session time zone (a raw JS Date bind would).
const resolveRecordedAt = (recorded_at) => {
  if (!recorded_at) return fmtNaive(new Date(), true); // utcnow()

  let s = String(recorded_at).trim();
  // Drop the timezone designator: Z / z / ±HH:MM / ±HHMM at the very end.
  s = s.replace(/(?:[Zz]|[+-]\d{2}:?\d{2})$/, '');
  s = s.replace(/[Tt]/, ' ').trim();
  if (!s.includes('.')) s += '.000000';

  // Keep only literal "YYYY-MM-DD HH:MM:SS.ffffff"; anything else → local now.
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/.test(s)) return fmtNaive(new Date(), false);
  return s;
};

/**
 * Legacy batch insert — kept for app builds that predate offline sync.
 *
 * These uploads carry no client_event_id, so they are NOT idempotent: a retry
 * inserts the point again. New clients must use POST /auth/location/sync
 * instead (locationSync.service.js).
 *
 * The ID now comes from LOCATION_TRACKS_SEQ rather than SELECT MAX(ID)+n, which
 * two concurrent uploads could resolve to the same value — a real risk once
 * several phones come back online together. Both insert paths share the one
 * sequence so they cannot collide with each other either.
 *
 * 2026-09-22: no longer stamps ATTENDANCE_DATE = TRUNC(SYSDATE) (the day the
 * batch ARRIVED). Each point is now attributed to whichever attendance
 * session (see sessionWindow.service.js) its own RECORDED_AT actually falls
 * inside — checked-in, and before checkout / the shift-end+grace cutoff — so
 * a point synced days late still lands on the day it was recorded, and a
 * point outside every session (no check-in that day, after checkout, past
 * cutoff) is never stored at all. Always returns HTTP 200 either way: the app
 * treats any non-200 as "retry forever", so an out-of-window point is
 * reported via `discarded`, never a per-point status the app would loop on.
 */
export const batchInsertLocations = async (card_no, locations) => {
  if (!Array.isArray(locations) || locations.length === 0) {
    return { inserted: 0, discarded: 0 };
  }

  let connection;
  let inserted = 0;
  let discarded = 0;
  // One DB round trip per distinct roster date touched by this batch, not per
  // point — a batch is typically many points for the same one or two days.
  const windowsCache = new Map(); // "YYYY-MM-DD" -> window[] (one entry per check-in/checkout pair that day)

  try {
    connection = await getDirectConnection();

    const windowsFor = async (ymd) => {
      if (windowsCache.has(ymd)) return windowsCache.get(ymd);
      const w = await getSessionWindows(card_no, ymd, connection);
      windowsCache.set(ymd, w);
      return w;
    };

    for (const loc of locations) {
      const recAt = resolveRecordedAt(loc.recorded_at); // UTC-naive "YYYY-MM-DD HH:MM:SS.ffffff"
      const recAtSec = recAt.slice(0, 19);

      // The point's own local (Asia/Karachi) calendar date, since RECORDED_AT
      // is UTC wall time. Try that day's sessions first, then the PREVIOUS
      // local day's — a night-shift point recorded after local midnight still
      // belongs to yesterday's roster/session. A day can hold several
      // check-in/checkout pairs, so a point counts if it falls in ANY of them.
      const localYmd = utcNaiveToLocalYmd(recAtSec);
      const prevYmd = addDaysYmd(localYmd, -1);

      let attendanceDate = null;
      for (const candidate of [localYmd, prevYmd]) {
        const windows = await windowsFor(candidate);
        if (isWithinAnyWindow(windows, recAtSec)) {
          attendanceDate = candidate;
          break;
        }
      }

      if (!attendanceDate) {
        discarded++;
        continue;
      }

      await connection.execute(
        `
        INSERT INTO LOCATION_TRACKS (
            ID,
            CARD_NO,
            LATITUDE,
            LONGITUDE,
            ACCURACY,
            RECORDED_AT,
            SYNCED_AT,
            ATTENDANCE_DATE
        )
        VALUES (
            LOCATION_TRACKS_SEQ.NEXTVAL,
            :card_no,
            :lat,
            :lng,
            :acc,
            TO_TIMESTAMP(:rec_at, 'YYYY-MM-DD HH24:MI:SS.FF6'),
            SYSTIMESTAMP,
            TO_DATE(:att_date, 'YYYY-MM-DD')
        )
        `,
        {
          card_no,
          lat: Number(loc.latitude),
          lng: Number(loc.longitude),
          acc: Number(loc.accuracy ?? 0),
          rec_at: recAt,
          att_date: attendanceDate,
        },
        {
          autoCommit: false,
        },
      );

      inserted++;
    }

    await connection.commit();

    logger.info(
      `[LOCATION] card=${card_no} inserted=${inserted} discarded=${discarded} (out of session window)`,
    );

    return { inserted, discarded };
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_) {
        // Ignore rollback errors
      }
    }

    logger.error({ err }, "[LOCATION] Batch insert error");
    throw err;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (_) {
        // Ignore close errors
      }
    }
  }
};

/**
 * Record the location an employee marked attendance from as a LOCATION_TRACKS
 * point, so it shows up (as the first point of the day) in the web portal's
 * location tracking view. Mirrors save_attendance_origin_point in the FastAPI
 * LMS-Backend (repositories/location_repository.py).
 *
 * Best-effort and idempotent: skips insertion when an identical point already
 * exists for this card today. RECORDED_AT is stored in UTC (SYS_EXTRACT_UTC) to
 * match the convention used by the periodic location batch. Returns true if a
 * new point was inserted, false otherwise.
 *
 * `attendanceDate` ("YYYY-MM-DD") is required (2026-09-22) — the caller
 * (attendance.service.js) passes the same roster date it computes for the
 * check-in response's `attendance_date`, rather than this insert deciding its
 * own via TRUNC(SYSDATE). They're the same value for an actual fresh
 * check-in (this runs synchronously at that instant), but deriving it twice
 * with two different rules was exactly the kind of drift the rest of this
 * file's insert paths were fixed to avoid.
 */
export const saveAttendanceOriginPoint = async (card_no, latitude, longitude, accuracy = null, attendanceDate) => {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined)
    return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(attendanceDate ?? ''))) {
    logger.info(`[LOCATION] Attendance-origin insert skipped for card=${card_no}: no attendanceDate given`);
    return false;
  }

  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  const accNum = Number(accuracy);
  const acc = Number.isFinite(accNum) ? accNum : 0.0;

  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `
      INSERT INTO LOCATION_TRACKS (
          ID, CARD_NO, LATITUDE, LONGITUDE, ACCURACY,
          RECORDED_AT, SYNCED_AT, ATTENDANCE_DATE
      )
      SELECT
          -- Same ID source as every other insert into this table. Deriving it
          -- from MAX(ID)+1 here while the batch paths drew from the sequence
          -- meant both could hand out the same number, and whichever committed
          -- second failed with ORA-00001.
          LOCATION_TRACKS_SEQ.NEXTVAL,
          :card_no, :lat, :lng, :acc,
          SYS_EXTRACT_UTC(SYSTIMESTAMP), SYSTIMESTAMP, TO_DATE(:att_date, 'YYYY-MM-DD')
      FROM DUAL
      WHERE NOT EXISTS (
          SELECT 1 FROM LOCATION_TRACKS lt
          WHERE TO_CHAR(lt.CARD_NO) = :card_no
            AND lt.ATTENDANCE_DATE = TO_DATE(:att_date, 'YYYY-MM-DD')
            AND ROUND(lt.LATITUDE, 6)  = ROUND(:lat, 6)
            AND ROUND(lt.LONGITUDE, 6) = ROUND(:lng, 6)
      )
      `,
      { card_no: String(card_no), lat, lng: lon, acc, att_date: attendanceDate },
      { autoCommit: true },
    );
    const inserted = result.rowsAffected ?? 0;
    if (inserted)
      logger.info(`[LOCATION] Attendance-origin point saved for card=${card_no} (${lat},${lon})`);
    else logger.info(`[LOCATION] Attendance-origin point already present for card=${card_no}`);
    return Boolean(inserted);
  } catch (e) {
    try {
      await connection?.rollback();
    } catch {
      /* ignore */
    }
    logger.info(`[LOCATION] Attendance-origin insert failed (non-fatal): ${e.message ?? e}`);
    return false;
  } finally {
    await connection?.close();
  }
};

// 2026-09-22: bounded to that roster date's session window (check-in through
// checkout/cutoff), not just ATTENDANCE_DATE. Ingest now only ever stores
// points inside a session's window, so this is belt-and-braces for rows
// synced before that fix shipped, and for an employee with no check-in that
// day at all (window is null -> no points, matching the summary endpoint).
export const getLocationHistory = async (card_no, date) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const card = String(card_no);
    const card_int = card.includes(".") ? card.split(".")[0] : card;

    // A day can hold several check-in/checkout pairs (see
    // sessionWindow.service.js); fetch the whole span they cover, then keep
    // only points that actually fall inside one of them.
    const windows = await getSessionWindows(card_no, date, connection);
    if (windows.length === 0) {
      return { card_no: card, date, points: [] };
    }
    const spanStart = windows[0].match_start_utc_naive;
    const spanEnd = windows[windows.length - 1].match_end_utc_naive;

    const sql = `
      SELECT
        LATITUDE,
        LONGITUDE,
        ACCURACY,
        TO_CHAR(RECORDED_AT, 'YYYY-MM-DD HH24:MI:SS') AS RECORDED_AT
      FROM LOCATION_TRACKS
      WHERE (
        TO_CHAR(CARD_NO) = :card
        OR TO_CHAR(CARD_NO) = :card_int
    )
      AND RECORDED_AT BETWEEN
          TO_TIMESTAMP(:span_start, 'YYYY-MM-DD HH24:MI:SS')
          AND TO_TIMESTAMP(:span_end, 'YYYY-MM-DD HH24:MI:SS')
      ORDER BY RECORDED_AT ASC
    `;

    const result = await connection.execute(
      sql,
      {
        card,
        card_int,
        span_start: spanStart,
        span_end: spanEnd,
      },
      {
        outFormat: 4002,
      },
    );

    const res = (result.rows ?? [])
      .filter((row) => isWithinAnyWindow(windows, row.RECORDED_AT.toString()))
      .map((row) => ({
        latitude: row.LATITUDE != null ? Number(row.LATITUDE) : null,
        longitude: row.LONGITUDE != null ? Number(row.LONGITUDE) : null,
        accuracy: Number(row.ACCURACY ?? 0),
        recorded_at: row.RECORDED_AT ? row.RECORDED_AT.toString() : null,
      }));
    return {
      "card_no": card,
      "date": date,
      "points": res,
    };
  } finally {
    await connection?.close();
  }
};

/**
 * HR-only: all employees with location data for a given date, restricted to the given allowed companies/branches. Mirrors get_all_locations_summary in the FastAPI LMS-Backend (repositories/location_repository.py).
 *
 * 2026-09-22: bounded per employee by that day's session window (check-in
 * through checkout/cutoff), the same way getLocationHistory is — not just
 * ATTENDANCE_DATE. Ingest now only ever stores in-window points, so this is
 * belt-and-braces for rows synced before that fix, and it drops an employee
 * entirely when they have no check-in that day at all, even if stray rows
 * still carry that ATTENDANCE_DATE from before the repair runs.
 */
export const getLocationSummary = async (
  date,
  allowedCompanies,
  allowedBranches,
) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const binds = { dt: date };
    const extraFilter = [
      buildNumericInClause("h.UNIT_ID", allowedCompanies, "cmpf", binds),
      buildNumericInClause("h.LOCATION", allowedBranches, "brnf", binds),
    ]
      .filter(Boolean)
      .map((clause) => ` AND ${clause}`)
      .join("");

    // Candidates: everyone with a row dated this day, in the admin's scope.
    // Per-employee figures are then recomputed against that employee's own
    // session window below, rather than trusted straight from this query.
    const sql = `
      SELECT
          lt.CARD_NO,
          NVL(h.NAME, lt.CARD_NO) AS EMPLOYEE_NAME,
          h.EMPCODE
      FROM LOCATION_TRACKS lt
      INNER JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = lt.CARD_NO
                            OR e.CARD_NO = TO_NUMBER(REGEXP_SUBSTR(lt.CARD_NO, '^[0-9]+'))
      INNER JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
      WHERE lt.ATTENDANCE_DATE = TO_DATE(:dt, 'YYYY-MM-DD')${extraFilter}
      GROUP BY lt.CARD_NO, h.NAME, h.EMPCODE
    `;

    const result = await connection.execute(sql, binds, { outFormat: 4002 });
    const candidates = result.rows ?? [];

    const summary = [];
    for (const c of candidates) {
      // A day can hold several check-in/checkout pairs; fetch the whole span
      // they cover, then keep only points that actually fall inside one of
      // them (isWithinAnyWindow) before aggregating in JS.
      const windows = await getSessionWindows(c.CARD_NO, date, connection);
      if (windows.length === 0) continue; // no check-in that day -> not present, whatever stray rows say

      const spanStart = windows[0].match_start_utc_naive;
      const spanEnd = windows[windows.length - 1].match_end_utc_naive;

      const pts = await connection.execute(
        `
        SELECT LATITUDE, LONGITUDE, ACCURACY,
               TO_CHAR(RECORDED_AT, 'YYYY-MM-DD HH24:MI:SS') AS RECORDED_AT
        FROM LOCATION_TRACKS
        WHERE TO_CHAR(CARD_NO) = :card
          AND RECORDED_AT BETWEEN
              TO_TIMESTAMP(:span_start, 'YYYY-MM-DD HH24:MI:SS')
              AND TO_TIMESTAMP(:span_end, 'YYYY-MM-DD HH24:MI:SS')
        ORDER BY RECORDED_AT ASC
        `,
        { card: c.CARD_NO, span_start: spanStart, span_end: spanEnd },
        { outFormat: 4002 },
      );
      const inWindow = (pts.rows ?? []).filter((row) =>
        isWithinAnyWindow(windows, row.RECORDED_AT.toString()),
      );
      if (inWindow.length === 0) continue; // every point for this card that day was out-of-window

      const last = inWindow[inWindow.length - 1];
      summary.push({
        card_no: c.CARD_NO,
        employee_name: c.EMPLOYEE_NAME,
        empcode: c.EMPCODE,
        point_count: inWindow.length,
        last_seen: last.RECORDED_AT ?? null,
        last_latitude: last.LATITUDE != null ? Number(last.LATITUDE) : null,
        last_longitude: last.LONGITUDE != null ? Number(last.LONGITUDE) : null,
        last_accuracy: Number(last.ACCURACY ?? 0),
      });
    }

    summary.sort((a, b) => String(b.last_seen ?? '').localeCompare(String(a.last_seen ?? '')));
    return summary;
  } finally {
    await connection?.close();
  }
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return 0;
  }

  const toRad = (d) => (d * Math.PI) / 180;

  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
};

export const getLocationReportSummary = async ({
  from_date,
  to_date,
  allowedCompanies,
  allowedBranches,
  dept_no,
  desg_cd,
}) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const binds = { from_date, to_date };
    const extraClauses = [
      buildNumericInClause("h.UNIT_ID", allowedCompanies, "cf", binds),
      buildNumericInClause("h.LOCATION", allowedBranches, "bf", binds),
      buildNumericInClause("h.DEPT_NO", dept_no, "df", binds),
      buildNumericInClause("h.DESG_CD", desg_cd, "gf", binds),
    ]
      .filter(Boolean)
      .map((c) => ` AND ${c}`)
      .join("");

    const sql = `
      SELECT
          h.EMPCODE,
          h.NAME,
          NVL(
              (
                  SELECT MIN(d.DEPT_NAME)
                  FROM HR_DEPT d
                  WHERE LTRIM(d.DEPT_NO,'0') = LTRIM(h.DEPT_NO,'0')
                  AND TO_CHAR(d.COMPC)=TO_CHAR(h.UNIT_ID)
              ),
              TO_CHAR(h.DEPT_NO)
          ) DEPT_NAME,

          NVL(
              (
                SELECT MIN(g.DESG_DESC)
                FROM HR_DESG g
                WHERE LTRIM(g.DESG_CD,'0')=LTRIM(h.DESG_CD,'0')
                AND TO_CHAR(g.COMPC)=TO_CHAR(h.UNIT_ID)
              ),
              TO_CHAR(h.DESG_CD)
          ) DESG_NAME,

          TO_CHAR(lt.ATTENDANCE_DATE,'YYYY-MM-DD') ADATE,

          TO_CHAR(
              lt.RECORDED_AT,
              'YYYY-MM-DD HH24:MI:SS'
          ) RECORDED_AT,

          lt.LATITUDE,
          lt.LONGITUDE,
          lt.ACCURACY

      FROM LOCATION_TRACKS lt

      INNER JOIN EMPLOYEE e
          ON TO_CHAR(e.CARD_NO)=lt.CARD_NO
          OR e.CARD_NO=TO_NUMBER(REGEXP_SUBSTR(lt.CARD_NO,'^[0-9]+'))

      INNER JOIN HR_EMP_MASTER h
          ON h.EMPCODE=e.EMPCODE

      WHERE lt.ATTENDANCE_DATE BETWEEN
            TO_DATE(:from_date,'YYYY-MM-DD')
        AND TO_DATE(:to_date,'YYYY-MM-DD')
      ${extraClauses}

      ORDER BY
          h.EMPCODE,
          lt.ATTENDANCE_DATE,
          lt.RECORDED_AT,
          lt.ID
    `;

    const result = await connection.execute(
      sql,
      binds,
      {
        outFormat: 4002,
      },
    );

    const rows = result.rows ?? [];

    const summary = [];

    let i = 0;

    while (i < rows.length) {
      const first = rows[i];
      const key = first.EMPCODE + "|" + first.ADATE;
      let j = i;

      while (j < rows.length && rows[j].EMPCODE + "|" + rows[j].ADATE === key) {
        j++;
      }

      const group = rows.slice(i, j);

      let totalKm = 0;

      for (let k = 1; k < group.length; k++) {
        totalKm += haversineKm(
          Number(group[k - 1].LATITUDE),
          Number(group[k - 1].LONGITUDE),
          Number(group[k].LATITUDE),
          Number(group[k].LONGITUDE),
        );
      }

      summary.push({
        empcode: first.EMPCODE,
        name: (first.NAME ?? "").trim(),
        department: (first.DEPT_NAME ?? "").trim(),
        designation: (first.DESG_NAME ?? "").trim(),
        date: first.ADATE,
        first_time: first.RECORDED_AT,
        last_time: group[group.length - 1].RECORDED_AT,
        total_entries: group.length,
        total_distance_km: Number(totalKm.toFixed(2)),
        status: "Present",
      });

      i = j;
    }

    return summary;
  } finally {
    await connection?.close();
  }
};

// ------------------------------------------------------------------
// LOCATION TRAIL REPORT (Feature 1 — one row per GPS point)
// Mirrors get_location_trail_report / _fetch_trail_rows in the FastAPI
// LMS-Backend (repositories/location_repository.py).
// ------------------------------------------------------------------

// Restricts the HR_EMP_MASTER alias `h` to the given company/branch/department/
// designation/employee selections. Returns a leading " AND ..." fragment (or ""
// when no filters apply) and writes bind values into `binds`.
const buildCoreFilters = (
  { allowedCompanies, allowedBranches, deptNo, desgCd, empcodes },
  binds,
) => {
  const clauses = [
    buildNumericInClause("h.UNIT_ID", allowedCompanies, "cf", binds),
    buildNumericInClause("h.LOCATION", allowedBranches, "bf", binds),
    buildNumericInClause("h.DEPT_NO", deptNo, "df", binds),
    buildNumericInClause("h.DESG_CD", desgCd, "gf", binds),
    buildStringInClause("h.EMPCODE", empcodes, "ef", binds),
  ].filter(Boolean);

  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
};

// Optional Region (COM_LOCATION.REGIONCODE via the employee's branch) and
// Employee Category (HR_EMP_MASTER.CADRE) filters. These columns are less
// certain than the core ones, so the caller retries without this fragment if
// Oracle reports a missing column (ORA-00904).
const buildOptionalFilters = ({ region, category }, binds) => {
  const clauses = [];

  const regions = (region ?? []).map((v) => String(v).trim()).filter(Boolean);
  if (regions.length) {
    regions.forEach((v, i) => {
      binds[`rg${i}`] = v;
    });
    const placeholders = regions.map((_, i) => `:rg${i}`).join(", ");
    clauses.push(
      `TO_CHAR(h.LOCATION) IN (SELECT TO_CHAR(LCODE) FROM COM_LOCATION WHERE REGIONCODE IN (${placeholders}))`,
    );
  }

  const categoryClause = buildStringInClause("h.CADRE", category, "ct", binds);
  if (categoryClause) clauses.push(categoryClause);

  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
};

const isMissingColumnError = (err) =>
  err?.errorNum === 904 || String(err?.message ?? "").includes("ORA-00904");

const trailRowsSql = (coreFilter, extraFilter) => `
  SELECT
      h.EMPCODE,
      h.NAME,
      NVL(
        (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
          WHERE LTRIM(d.DEPT_NO,'0') = LTRIM(h.DEPT_NO,'0') AND TO_CHAR(d.COMPC) = TO_CHAR(h.UNIT_ID)),
        TO_CHAR(h.DEPT_NO)
      ) AS DEPT_NAME,
      NVL(
        (SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg
          WHERE LTRIM(dg.DESG_CD,'0') = LTRIM(h.DESG_CD,'0')
            AND TO_CHAR(dg.COMPC) = TO_CHAR(h.UNIT_ID)),
        TO_CHAR(h.DESG_CD)
      ) AS DESG_NAME,
      TO_CHAR(lt.ATTENDANCE_DATE, 'YYYY-MM-DD')         AS ADATE,
      TO_CHAR(lt.RECORDED_AT, 'YYYY-MM-DD HH24:MI:SS')  AS RECORDED_AT,
      lt.LATITUDE,
      lt.LONGITUDE,
      lt.ACCURACY
  FROM LOCATION_TRACKS lt
  INNER JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = lt.CARD_NO
                        OR e.CARD_NO = TO_NUMBER(REGEXP_SUBSTR(lt.CARD_NO, '^[0-9]+'))
  INNER JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
  WHERE lt.ATTENDANCE_DATE BETWEEN TO_DATE(:from_date, 'YYYY-MM-DD') AND TO_DATE(:to_date, 'YYYY-MM-DD')
    ${coreFilter}${extraFilter}
  ORDER BY h.EMPCODE, lt.ATTENDANCE_DATE, lt.RECORDED_AT, lt.ID
  FETCH FIRST 50000 ROWS ONLY
`;

// Returns every GPS point in range joined to employee master, ordered by
// employee then time.
const fetchTrailRows = async (connection, { fromDate, toDate, ...filters }) => {
  const baseBinds = { from_date: fromDate, to_date: toDate };
  const coreFilter = buildCoreFilters(filters, baseBinds);

  const optionalBinds = {};
  const optionalFilter = buildOptionalFilters(filters, optionalBinds);

  try {
    const result = await connection.execute(
      trailRowsSql(coreFilter, optionalFilter),
      { ...baseBinds, ...optionalBinds },
      { outFormat: 4002 },
    );
    return result.rows ?? [];
  } catch (err) {
    if (optionalFilter && isMissingColumnError(err)) {
      logger.warn(
        `[LOCATION_REPORT] region/category column missing, ignoring those filters: ${err.message}`,
      );
      const result = await connection.execute(
        trailRowsSql(coreFilter, ""),
        baseBinds,
        { outFormat: 4002 },
      );
      return result.rows ?? [];
    }
    throw err;
  }
};

// Groups rows (already ordered by empcode, date, time) into consecutive
// (empcode, date) buckets.
const groupRowsByEmployeeDay = (rows) => {
  const groups = [];
  let i = 0;
  while (i < rows.length) {
    const key = `${rows[i].EMPCODE}|${rows[i].ADATE}`;
    let j = i;
    while (j < rows.length && `${rows[j].EMPCODE}|${rows[j].ADATE}` === key) {
      j++;
    }
    groups.push(rows.slice(i, j));
    i = j;
  }
  return groups;
};

/**
 * Feature 1 — one row per GPS point, with distance-from-previous and
 * Login/Active/Logout status computed per employee per day.
 */
export const getLocationTrail = async ({
  fromDate,
  toDate,
  allowedCompanies,
  allowedBranches,
  deptNo,
  desgCd,
  empcodes,
  region,
  category,
}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const rows = await fetchTrailRows(connection, {
      fromDate,
      toDate,
      allowedCompanies,
      allowedBranches,
      deptNo,
      desgCd,
      empcodes,
      region,
      category,
    });

    const items = [];
    for (const group of groupRowsByEmployeeDay(rows)) {
      let prevLat = null;
      let prevLon = null;

      group.forEach((point, idx) => {
        const lat = point.LATITUDE != null ? Number(point.LATITUDE) : null;
        const lon = point.LONGITUDE != null ? Number(point.LONGITUDE) : null;
        const distanceKm =
          idx === 0
            ? 0
            : Number(haversineKm(prevLat, prevLon, lat, lon).toFixed(2));

        let status = "Active";
        if (idx === 0) status = "Login";
        else if (idx === group.length - 1) status = "Logout";

        items.push({
          empcode: point.EMPCODE,
          name: (point.NAME ?? "").trim(),
          department: (point.DEPT_NAME ?? "").trim(),
          designation: (point.DESG_NAME ?? "").trim(),
          date: point.ADATE,
          recorded_at: point.RECORDED_AT, // UTC; frontend converts to local
          latitude: lat,
          longitude: lon,
          accuracy: Number(point.ACCURACY ?? 0),
          distance_km: distanceKm,
          status,
        });

        prevLat = lat;
        prevLon = lon;
      });
    }

    return items;
  } finally {
    await connection?.close();
  }
};
