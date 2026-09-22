import { getDirectConnection } from "../config/database.js";
import { getLatestSessionWindow, addDaysYmd, sessionStatus } from "./sessionWindow.service.js";

/** Today as "YYYY-MM-DD", app-server (Asia/Karachi) local time. */
const todayYmd = () => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

/**
 * The employee's most recent attendance session (today, else yesterday, in
 * case a still-open overnight session hasn't rolled over yet), or null when
 * there is none. 2026-09-22: lets the app pick up a cutoff change (HR edited
 * the shift mid-day) or close a session that already expired, per
 * GET /location-tracking/settings/:emp_code's contract.
 */
const latestSessionWindow = async (cardNo) => {
  const today = todayYmd();
  const todayWindow = await getLatestSessionWindow(cardNo, today);
  if (todayWindow) return todayWindow;
  return getLatestSessionWindow(cardNo, addDaysYmd(today, -1));
};

export const getTrackingSettings = async (empCode) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(`
            SELECT
                h.EMPCODE,
                h.NAME,
                h.TRACK_LOCATION,
                h.TRACK_LOCATION_HR,
                h.STATUS,
                e.CARD_NO
            FROM HR_EMP_MASTER h
            LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            WHERE h.EMPCODE = :emp_code
        `, { emp_code: empCode }, { outFormat: 4001 });

    if (!result.rows || result.rows.length === 0) {
      return { status: "error", message: `Employee ${empCode} not found`, code: 404 };
    }

    const row = result.rows[0];
    const empcode = row[0];
    const name = row[1];
    const track_location = row[2] || 'N';
    const track_location_hr = Math.max(1, row[3] ? parseInt(row[3], 10) : 2);
    const status_val = row[4];
    const cardNo = row[5];

    // Additive (2026-09-22): when tracking must stop for the employee's
    // latest session, and the roster day it belongs to. Null when there is no
    // recent session, or the card couldn't be resolved — never a reason to
    // fail this call, since callers already use it without these fields.
    let tracking_cutoff_at = null;
    let attendance_date = null;
    if (cardNo) {
      try {
        const window = await latestSessionWindow(cardNo);
        tracking_cutoff_at = window?.cutoff_at ?? null;
        attendance_date = window?.attendance_date ?? null;
      } catch {
        /* best-effort — settings still return without the tracking hint */
      }
    }

    return {
      status: "success",
      data: {
        emp_code: empcode,
        employee_name: name,
        track_location: track_location,
        track_location_hr: track_location_hr,
        status: status_val,
        message: track_location === 'Y' ? "Location tracking is ENABLED" : "Location tracking is DISABLED",
        tracking_cutoff_at,
        attendance_date,
      }
    };
  } finally {
    if (connection) await connection.close();
  }
};

export const updateTrackingSettings = async (empCode, trackLocation, trackLocationHr) => {
  let connection;
  try {
    connection = await getDirectConnection();
    
    const result = await connection.execute(`
            UPDATE HR_EMP_MASTER 
            SET 
                TRACK_LOCATION = :track_location,
                TRACK_LOCATION_HR = :track_location_hr,
                USR_DATE_UPD = SYSDATE
            WHERE EMPCODE = :emp_code
              OR "ATDTCARD#" = :emp_code
               OR TO_CHAR(EMPCODE) = :emp_code
        `, {
      track_location: trackLocation.toUpperCase(),
      track_location_hr: trackLocationHr,
      emp_code: empCode
    }, { autoCommit: true });

    if (result.rowsAffected === 0) {
      return { status: "error", message: `Employee ${empCode} not found`, code: 404 };
    }

    return {
      status: "success",
      data: {
        success: true,
        emp_code: empCode,
        track_location: trackLocation.toUpperCase(),
        track_location_hr: trackLocationHr,
        message: "Settings updated successfully"
      }
    };
  } finally {
    if (connection) await connection.close();
  }
};

export const getGeofenceSettings = async (empCode) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(`
            SELECT EMPCODE, NAME, LOCATION_FIXED,
                   DEFAULT_LATITUDE, DEFAULT_LONGITUDE, MARGIN
            FROM HR_EMP_MASTER
            WHERE EMPCODE = :emp_code
               OR TO_CHAR("ATDTCARD#") = :emp_code
            FETCH FIRST 1 ROWS ONLY
        `, { emp_code: empCode }, { outFormat: 4001 });

    if (!result.rows || result.rows.length === 0) {
      return { status: "error", message: `Employee ${empCode} not found`, code: 404 };
    }

    const row = result.rows[0];
    const empcode = row[0];
    const name = row[1];
    const location_fixed = row[2];
    const lat = row[3];
    const lon = row[4];
    const margin = row[5];

    const fixed = (location_fixed || "N").trim().toUpperCase();
    const lat_f = lat !== null && lat !== undefined ? parseFloat(lat) : null;
    const lon_f = lon !== null && lon !== undefined ? parseFloat(lon) : null;
    let margin_f = margin !== null && margin !== undefined ? parseFloat(margin) : 200.0;
    if (!margin_f || margin_f <= 0) margin_f = 200.0;

    const enabled = fixed === "Y" && lat_f !== null && lon_f !== null;

    return {
      status: "success",
      data: {
        emp_code: empcode,
        employee_name: name,
        location_fixed: fixed,
        latitude: lat_f,
        longitude: lon_f,
        margin: margin_f,
        geofence_enabled: enabled,
      }
    };
  } finally {
    if (connection) await connection.close();
  }
};

/**
 * 2026-09-22: `total_tracking`/`employees` keep their original meaning
 * (configured for tracking — TRACK_LOCATION='Y' on an active employee) so any
 * existing consumer of this endpoint sees the same numbers as before. Added,
 * per-employee: `currently_tracking` and `session` (null when there is none)
 * — whether that employee has a session open RIGHT NOW (checked in, not
 * checked out, not past cutoff), via the same session-window logic as
 * ingest. Added, top level: `total_currently_tracking`. A dashboard that
 * wants a genuine "who is actively being tracked right now" view should read
 * the new fields; the old ones no longer mean that, if they ever did.
 */
export const getActiveTrackingEmployees = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(`
            SELECT
                h.EMPCODE,
                h.NAME,
                h.TRACK_LOCATION,
                h.TRACK_LOCATION_HR,
                h.LOCATION,
                h.DEPT_NO,
                h.STATUS,
                e.CARD_NO
            FROM HR_EMP_MASTER h
            LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            WHERE h.TRACK_LOCATION = 'Y' AND h.STATUS = 'A'
            ORDER BY h.EMPCODE
        `, {}, { outFormat: 4001 });

    const today = todayYmd();
    let totalCurrentlyTracking = 0;

    const employees = await Promise.all((result.rows || []).map(async (row) => {
      const track_location_hr = row[3];
      const cardNo = row[7];

      let currentlyTracking = false;
      let session = null;
      if (cardNo) {
        try {
          const window = await getLatestSessionWindow(cardNo, today);
          const status = sessionStatus(window);
          currentlyTracking = status.open;
          if (window) {
            session = {
              check_in_at: window.check_in_at,
              cutoff_at: window.cutoff_at,
              missing_checkout: status.missing_checkout,
            };
          }
        } catch {
          /* best-effort — employee still listed, just without live session info */
        }
      }
      if (currentlyTracking) totalCurrentlyTracking++;

      return {
        emp_code: row[0],
        employee_name: row[1],
        track_location_hr: Math.max(1, track_location_hr ? parseInt(track_location_hr, 10) : 2),
        location: row[4],
        department: row[5],
        status: row[6],
        currently_tracking: currentlyTracking,
        session,
      };
    }));

    return {
      status: "success",
      data: {
        total_tracking: employees.length,
        employees: employees,
        total_currently_tracking: totalCurrentlyTracking,
      }
    };
  } finally {
    if (connection) await connection.close();
  }
};

export const getTrackingStatistics = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN TRACK_LOCATION = 'Y' THEN 1 ELSE 0 END) as enabled,
                SUM(CASE WHEN TRACK_LOCATION = 'Y' THEN TRACK_LOCATION_HR ELSE 0 END) as total_hours,
                AVG(CASE WHEN TRACK_LOCATION = 'Y' THEN TRACK_LOCATION_HR ELSE NULL END) as avg_hours
            FROM HR_EMP_MASTER
        `, {}, { outFormat: 4001 });

    const row = result.rows[0];
    const total = row[0] || 0;
    const enabled = row[1] || 0;
    const total_hours = row[2] || 0;
    const avg_hours = row[3] || 2.0;
    
    const disabled = total - enabled;

    // Additive (2026-09-22): how many of the tracking-enabled employees have
    // a session open RIGHT NOW (checked in, not checked out, not past
    // cutoff) — reuses getActiveTrackingEmployees rather than a second
    // implementation of the same session-window logic.
    let currently_active = 0;
    try {
      const active = await getActiveTrackingEmployees();
      currently_active = active.data?.total_currently_tracking ?? 0;
    } catch {
      /* best-effort — statistics still return without this figure */
    }

    return {
      status: "success",
      data: {
        total_employees: parseInt(total, 10),
        tracking_enabled: parseInt(enabled, 10),
        tracking_disabled: parseInt(disabled, 10),
        average_interval_hours: Math.round(parseFloat(avg_hours) * 100) / 100,
        total_tracking_hours: parseInt(total_hours, 10),
        currently_active,
      }
    };
  } finally {
    if (connection) await connection.close();
  }
};
