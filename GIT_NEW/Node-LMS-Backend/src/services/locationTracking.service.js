import { getDirectConnection } from "../config/database.js";

export const getTrackingSettings = async (empCode) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(`
            SELECT 
                EMPCODE, 
                NAME, 
                TRACK_LOCATION, 
                TRACK_LOCATION_HR,
                STATUS
            FROM HR_EMP_MASTER 
            WHERE EMPCODE = :emp_code
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

    return {
      status: "success",
      data: {
        emp_code: empcode,
        employee_name: name,
        track_location: track_location,
        track_location_hr: track_location_hr,
        status: status_val,
        message: track_location === 'Y' ? "Location tracking is ENABLED" : "Location tracking is DISABLED"
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

export const getActiveTrackingEmployees = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(`
            SELECT 
                EMPCODE,
                NAME,
                TRACK_LOCATION,
                TRACK_LOCATION_HR,
                LOCATION,
                DEPT_NO,
                STATUS
            FROM HR_EMP_MASTER
            WHERE TRACK_LOCATION = 'Y' AND STATUS = 'A'
            ORDER BY EMPCODE
        `, {}, { outFormat: 4001 });

    const employees = (result.rows || []).map(row => {
      const track_location_hr = row[3];
      return {
        emp_code: row[0],
        employee_name: row[1],
        track_location_hr: Math.max(1, track_location_hr ? parseInt(track_location_hr, 10) : 2),
        location: row[4],
        department: row[5],
        status: row[6]
      };
    });

    return {
      status: "success",
      data: {
        total_tracking: employees.length,
        employees: employees
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

    return {
      status: "success",
      data: {
        total_employees: parseInt(total, 10),
        tracking_enabled: parseInt(enabled, 10),
        tracking_disabled: parseInt(disabled, 10),
        average_interval_hours: Math.round(parseFloat(avg_hours) * 100) / 100,
        total_tracking_hours: parseInt(total_hours, 10)
      }
    };
  } finally {
    if (connection) await connection.close();
  }
};
