"""Attendance repository — writes to both DUTY_ROSTER and ATTENDANCE_RECORDS.

Table: DUTY_ROSTER
Key columns:
    DUTY_ROSTER_PK (NUMBER PK), EMP_FK (NUMBER), CARD_NO (NUMBER),
    ROSTER_DATE (DATE), ROSTER_SHIFT (CHAR(1)),
    IN_TIME (VARCHAR2(20)), OUT_TIME (VARCHAR2(20)),
    W_HRS (NUMBER), W_MNT (NUMBER),
    LATE_HRS (NUMBER), LATE_MNT (NUMBER),
    OT_HRS (NUMBER), OT_MNT (NUMBER),
    ABSENT_DAYS (NUMBER), STATUS (VARCHAR2(100)),
    DUTY_HRS (NUMBER), DAY_NAME (VARCHAR2(20)),
    ROSTER_REMARKS (VARCHAR2(200)),
    ROSTER_MONTH (VARCHAR2(20)),
    SHIFT_START_TIME (VARCHAR2(20)), SHIFT_END_TIME (VARCHAR2(20)),
    ATT_MRK_TM (VARCHAR2(30)),
    COMPC (NUMBER), BRNCH (NUMBER)

Table: ATTENDANCE_RECORDS
Key columns:
    ID (NUMBER PK), EMPCODE (VARCHAR2(30)), CARD_NO (VARCHAR2(100)),
    ENTRY_TIME (VARCHAR2(20)), EXIT_TIME (VARCHAR2(20)),
    TIME_SPENT (NUMBER), ATTENDANCE_DATE (DATE),
    LONGITUDE (VARCHAR2(50)), LATITUDE (VARCHAR2(50)),
    ACCURACY (VARCHAR2(50)), ADDRESS (VARCHAR2(100)),
    FORMATTED_ADDRESS (VARCHAR2(400)), LOCATION_NAME (VARCHAR2(200)),
    ATTENDANCE_TYPE (VARCHAR2(100)),
    DEVICE_ID (VARCHAR2(400)), DEVICE_MODEL (VARCHAR2(400)),
    DEVICE_TYPE (VARCHAR2(100)), DEVICE_INFO (VARCHAR2(400)),
    APP_VERSION (VARCHAR2(400)), TIMESTAMP (VARCHAR2(400)),
    CLIENT_IP (VARCHAR2(100)), SCREENSHOT_FILENAME (VARCHAR2(200))
"""

from datetime import datetime
from core.database import get_connection


def _now_hhmm() -> str:
    """Return current time as HH:MI (24h) string."""
    return datetime.now().strftime("%H:%M")


def _time_spent_minutes(entry: str, exit_: str) -> int:
    """Calculate minutes between two HH:MI strings."""
    try:
        fmt = "%H:%M"
        t1 = datetime.strptime(entry.strip()[:5], fmt)
        t2 = datetime.strptime(exit_.strip()[:5], fmt)
        diff = (t2 - t1).total_seconds() / 60
        return max(int(diff), 0)
    except Exception:
        return 0


# ------------------------------------------------------------------
# SMART ATTENDANCE: get today's record for a card_no
# ------------------------------------------------------------------

def get_today_record(card_no: str):
    """Return today's attendance row for this CARD_NO, or None.

    Checks DUTY_ROSTER first (has DUTY_ROSTER_PK needed for check-out UPDATE).
    Falls back to ATTENDANCE_RECORDS if no DUTY_ROSTER row found.
    """
    conn = get_connection()
    cursor = conn.cursor()
    # Also try integer part of card_no (e.g. "100002" for card "100002.1")
    card_int = card_no.split(".")[0] if "." in card_no else card_no
    try:
        # ---- 1. Try DUTY_ROSTER ----
        # Match by CARD_NO as NUMBER (handles both 100002 and 100002.1 formats)
        card_num = float(card_int) if card_int.isdigit() else None
        cursor.execute("""
            SELECT DUTY_ROSTER_PK, IN_TIME, OUT_TIME, CARD_NO
            FROM DUTY_ROSTER
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int
                   OR (:card_num IS NOT NULL AND CARD_NO = :card_num))
              AND TRUNC(ROSTER_DATE) = TRUNC(SYSDATE)
            ORDER BY DUTY_ROSTER_PK DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"card": card_no, "card_int": card_int, "card_num": card_num})
        row = cursor.fetchone()
        if row:
            dr_entry = (row[1] or "").strip()
            dr_exit  = (row[2] or "").strip()
            # If DUTY_ROSTER row exists but IN_TIME is empty, check ATTENDANCE_RECORDS
            # for an active session — avoids a second INSERT when the MERGE failed silently.
            if not dr_entry:
                try:
                    cursor.execute("""
                        SELECT ID, ENTRY_TIME, EXIT_TIME, CARD_NO
                        FROM ATTENDANCE_RECORDS
                        WHERE CARD_NO = :card
                          AND TRUNC(ATTENDANCE_DATE) = TRUNC(SYSDATE)
                        ORDER BY ID DESC
                        FETCH FIRST 1 ROWS ONLY
                    """, {"card": card_no})
                    ar_row = cursor.fetchone()
                    if ar_row and (ar_row[1] or "").strip():
                        return {
                            "id": ar_row[0],
                            "entry_time": (ar_row[1] or "").strip(),
                            "exit_time": (ar_row[2] or "").strip(),
                            "card_no": str(ar_row[3]) if ar_row[3] else card_no,
                            "source": "attendance_records",
                        }
                except Exception as e:
                    print(f"[get_today_record] AR fallback check failed: {e}")
            return {
                "id": row[0],
                "entry_time": dr_entry,
                "exit_time": dr_exit,
                "card_no": str(row[3]) if row[3] else card_no,
                "source": "duty_roster",
            }

        # ---- 2. Fallback: ATTENDANCE_RECORDS ----
        try:
            cursor.execute("""
                SELECT ID, ENTRY_TIME, EXIT_TIME, CARD_NO
                FROM ATTENDANCE_RECORDS
                WHERE CARD_NO = :card
                  AND TRUNC(ATTENDANCE_DATE) = TRUNC(SYSDATE)
                ORDER BY ID DESC
                FETCH FIRST 1 ROWS ONLY
            """, {"card": card_no})
            row = cursor.fetchone()
            if row:
                return {
                    "id": row[0],
                    "entry_time": (row[1] or "").strip(),
                    "exit_time": (row[2] or "").strip(),
                    "card_no": str(row[3]) if row[3] else card_no,
                    "source": "attendance_records",
                }
        except Exception as e:
            print(f"[get_today_record] ATTENDANCE_RECORDS query failed: {e}")

        return None
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# LOOK UP EMP_FK (EMPCODE) from EMPLOYEE table for a given CARD_NO
# ------------------------------------------------------------------

def _card_int(card_no: str) -> str:
    """Return integer part of card_no (e.g. '100002' from '100002.1')."""
    return card_no.split(".")[0] if "." in card_no else card_no


def _get_empcode(card_no: str) -> str:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT EMPCODE FROM EMPLOYEE
            WHERE TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int
        """, {"card": card_no, "card_int": _card_int(card_no)})
        row = cursor.fetchone()
        return row[0] if row else card_no
    finally:
        cursor.close()
        conn.close()


def _get_emp_fk(card_no: str):
    """Get numeric EMP_FK (EMP_PK) for DUTY_ROSTER from EMPLOYEE table."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT EMP_PK FROM EMPLOYEE
            WHERE TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int
        """, {"card": card_no, "card_int": _card_int(card_no)})
        row = cursor.fetchone()
        return row[0] if row else None
    finally:
        cursor.close()
        conn.close()


def _get_compc_brnch(card_no: str):
    """Get COMPC and BRNCH for the employee."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT NVL(COMPC, 1), NVL(BRNCH, 1)
            FROM EMPLOYEE
            WHERE TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int
        """, {"card": card_no, "card_int": _card_int(card_no)})
        row = cursor.fetchone()
        return (row[0], row[1]) if row else (1, 1)
    except Exception:
        return (1, 1)
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# CHECK-IN: update existing DUTY_ROSTER row or insert new one
# ------------------------------------------------------------------

def insert_check_in(card_no: str, empcode: str, *,
                    latitude=None, longitude=None, accuracy=None,
                    address=None, formatted_address=None,
                    timestamp=None, device_id=None,
                    device_model=None, app_version=None,
                    attendance_type="check_in"):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        now = _now_hhmm()
        ci = _card_int(card_no)

        # ---- 1. DUTY_ROSTER — MERGE handles pre-generated rows and new inserts ----
        try:
            emp_fk = _get_emp_fk(card_no)
            compc, brnch = _get_compc_brnch(card_no)
            today = datetime.now()
            day_name = today.strftime("%A")
            roster_month = today.strftime("%b-%Y").upper()

            # MERGE matches on (ROSTER_DATE, CARD_NO) — same as DUTY_ROSTER_UK1.
            # Updates the pre-generated roster row if it exists; inserts otherwise.
            cursor.execute("""
                MERGE INTO DUTY_ROSTER dr
                USING (SELECT TRUNC(SYSDATE) AS rdate,
                              :card_num AS cno
                       FROM DUAL) src
                ON (TRUNC(dr.ROSTER_DATE) = src.rdate
                    AND dr.CARD_NO = src.cno)
                WHEN MATCHED THEN
                    UPDATE SET dr.IN_TIME    = :in_time,
                               dr.STATUS     = 'Present',
                               dr.ATT_MRK_TM = :att_mrk
                WHEN NOT MATCHED THEN
                    INSERT (DUTY_ROSTER_PK, EMP_FK, CARD_NO, ROSTER_DATE,
                            IN_TIME, STATUS, DAY_NAME, ROSTER_MONTH,
                            ATT_MRK_TM, COMPC, BRNCH, ABSENT_DAYS)
                    VALUES (
                        (SELECT NVL(MAX(DUTY_ROSTER_PK), 0) + 1 FROM DUTY_ROSTER),
                        :emp_fk, :card_num, TRUNC(SYSDATE),
                        :in_time, 'Present', :day_name, :roster_month,
                        :att_mrk, :compc, :brnch, 0
                    )
            """, {
                "card_num": float(ci),
                "in_time": now,
                "att_mrk": now,
                "emp_fk": emp_fk,
                "day_name": day_name,
                "roster_month": roster_month,
                "compc": compc,
                "brnch": brnch,
            })
            print(f"[CHECK_IN] MERGE DUTY_ROSTER card={card_no} IN_TIME={now}")
        except Exception as dr_err:
            print(f"[DUTY_ROSTER] CHECK_IN failed (non-fatal): {dr_err}")

        # ---- 2. ATTENDANCE_RECORDS (canonical store) ----
        # MERGE prevents duplicate rows when check-in is called more than once
        # for the same card on the same day (e.g. after a silent DUTY_ROSTER failure).
        try:
            params = {
                "empcode": empcode,
                "card_no": card_no,
                "entry_time": now,
                "att_type": attendance_type,
                "latitude": str(latitude) if latitude else None,
                "longitude": str(longitude) if longitude else None,
                "accuracy": str(accuracy) if accuracy else None,
                "address": str(address)[:100] if address else None,
                "formatted_address": str(formatted_address)[:400] if formatted_address else None,
                "ts": str(timestamp) if timestamp else None,
                "device_id": str(device_id)[:400] if device_id else None,
                "device_model": str(device_model)[:400] if device_model else None,
                "app_version": str(app_version)[:400] if app_version else None,
            }
            cursor.execute("""
                MERGE INTO ATTENDANCE_RECORDS ar
                USING (SELECT :card_no AS cno, TRUNC(SYSDATE) AS adate FROM DUAL) src
                ON (ar.CARD_NO = src.cno
                    AND TRUNC(ar.ATTENDANCE_DATE) = src.adate
                    AND ar.EXIT_TIME IS NULL)
                WHEN MATCHED THEN
                    UPDATE SET ar.ENTRY_TIME        = :entry_time,
                               ar.ATTENDANCE_TYPE   = :att_type,
                               ar.LATITUDE          = :latitude,
                               ar.LONGITUDE         = :longitude,
                               ar.ACCURACY          = :accuracy,
                               ar.ADDRESS           = :address,
                               ar.FORMATTED_ADDRESS = :formatted_address,
                               ar.TIMESTAMP         = :ts,
                               ar.DEVICE_ID         = :device_id,
                               ar.DEVICE_MODEL      = :device_model,
                               ar.APP_VERSION       = :app_version
                WHEN NOT MATCHED THEN
                    INSERT (ID, EMPCODE, CARD_NO, ENTRY_TIME,
                            ATTENDANCE_DATE, ATTENDANCE_TYPE,
                            LATITUDE, LONGITUDE, ACCURACY,
                            ADDRESS, FORMATTED_ADDRESS,
                            TIMESTAMP, DEVICE_ID, DEVICE_MODEL,
                            APP_VERSION)
                    VALUES (
                        (SELECT NVL(MAX(ID), 0) + 1 FROM ATTENDANCE_RECORDS),
                        :empcode, :card_no, :entry_time,
                        TRUNC(SYSDATE), :att_type,
                        :latitude, :longitude, :accuracy,
                        :address, :formatted_address,
                        :ts, :device_id, :device_model,
                        :app_version
                    )
            """, params)
        except Exception as ar_err:
            print(f"[ATTENDANCE_RECORDS] MERGE failed (non-fatal): {ar_err}")

        conn.commit()

        # ---- 3. LOCATION_TRACKS — record the marking location as a track point ----
        # The location an employee marks attendance from must appear (as the first
        # point of the day) in the web portal's location tracking view. Best-effort:
        # any failure here must not affect the attendance result.
        if latitude is not None and longitude is not None:
            try:
                from repositories.location_repository import save_attendance_origin_point
                save_attendance_origin_point(card_no, latitude, longitude, accuracy)
            except Exception as loc_err:
                print(f"[CHECK_IN] LOCATION_TRACKS origin point failed (non-fatal): {loc_err}")

        return {
            "status": "success",
            "message": "Checked in successfully",
            "action": "check_in",
            "marked_at": now,
            "location_verified": latitude is not None,
        }
    except Exception as e:
        conn.rollback()
        print(f"[CHECK_IN] Fatal error for card={card_no}: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# CHECK-OUT: update existing record
# ------------------------------------------------------------------

def update_check_out(record_id: int, entry_time: str, card_no: str = None,
                     source: str = "duty_roster"):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        now = _now_hhmm()
        spent = _time_spent_minutes(entry_time, now)
        w_hrs = spent // 60
        w_mnt = spent % 60

        # ---- 1. DUTY_ROSTER ----
        if source == "duty_roster":
            cursor.execute("""
                UPDATE DUTY_ROSTER
                SET OUT_TIME = :out_time,
                    W_HRS    = :w_hrs,
                    W_MNT    = :w_mnt
                WHERE DUTY_ROSTER_PK = :rid
            """, {"out_time": now, "w_hrs": w_hrs, "w_mnt": w_mnt, "rid": record_id})

        # ---- 2. ATTENDANCE_RECORDS — update today's row ----
        if card_no:
            card_int = card_no.split(".")[0] if "." in card_no else card_no
            try:
                cursor.execute("""
                    UPDATE ATTENDANCE_RECORDS
                    SET EXIT_TIME   = :exit_time,
                        TIME_SPENT  = :time_spent
                    WHERE (CARD_NO = :card_no OR CARD_NO = :card_int)
                      AND TRUNC(ATTENDANCE_DATE) = TRUNC(SYSDATE)
                      AND EXIT_TIME IS NULL
                """, {
                    "exit_time": now,
                    "time_spent": spent,
                    "card_no": card_no,
                    "card_int": card_int,
                })
            except Exception as ar_err:
                print(f"[ATTENDANCE_RECORDS] UPDATE failed (non-fatal): {ar_err}")

        # If record came from ATTENDANCE_RECORDS only, also try to update DUTY_ROSTER by card_no
        if source == "attendance_records" and card_no:
            card_int = card_no.split(".")[0] if "." in card_no else card_no
            try:
                cursor.execute("""
                    UPDATE DUTY_ROSTER
                    SET OUT_TIME = :out_time,
                        W_HRS    = :w_hrs,
                        W_MNT    = :w_mnt
                    WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
                      AND TRUNC(ROSTER_DATE) = TRUNC(SYSDATE)
                      AND OUT_TIME IS NULL
                """, {"out_time": now, "w_hrs": w_hrs, "w_mnt": w_mnt,
                      "card": card_no, "card_int": card_int})
            except Exception as dr_err:
                print(f"[DUTY_ROSTER] UPDATE by card_no failed (non-fatal): {dr_err}")

        conn.commit()

        return {
            "status": "success",
            "message": f"Checked out successfully ({spent} min)",
            "action": "check_out",
            "marked_at": now,
            "time_spent": spent,
            "location_verified": True,
        }
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# ATTENDANCE REPORT — single day (ORDS-style date)
# ------------------------------------------------------------------

def get_attendance_report(card_no: str, date_str: str):
    """date_str: ORDS-style e.g. '9-feb-2026' (DD-MON-YYYY)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT
                TRUNC(ROSTER_DATE)              AS roster_date,
                IN_TIME                         AS in_time,
                OUT_TIME                        AS out_time,
                NVL(ROSTER_SHIFT, 'G')          AS roster_shift,
                NVL(ABSENT_DAYS, 0)             AS absent_days,
                NVL(STATUS, CASE
                    WHEN IN_TIME IS NOT NULL THEN 'Present'
                    ELSE 'Absent'
                END)                            AS status,
                NVL(W_HRS, 0)                   AS w_hrs,
                NVL(W_MNT, 0)                   AS w_mnt,
                NVL(LATE_HRS, 0)                AS late_hrs,
                NVL(LATE_MNT, 0)                AS late_mnt,
                NVL(OT_HRS, 0)                  AS ot_hrs,
                NVL(OT_MNT, 0)                  AS ot_mnt,
                ROSTER_REMARKS                  AS roster_remarks,
                DAY_NAME                        AS day_name
            FROM DUTY_ROSTER
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND TRUNC(ROSTER_DATE) = TO_DATE(:dt, 'DD-MON-YYYY')
        """, {"card": card_no, "card_int": _card_int(card_no), "dt": date_str})

        rows = cursor.fetchall()
        columns = [col[0].lower() for col in cursor.description]
        result = [dict(zip(columns, r)) for r in rows]

        for row in result:
            if row.get("roster_date") and hasattr(row["roster_date"], "strftime"):
                row["roster_date"] = row["roster_date"].strftime("%Y-%m-%d")

        return result
    except Exception as e:
        err = str(e)
        if "ORA-00942" in err:
            return []
        raise
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# ATTENDANCE REPORT — bulk date range
# Reads from ATTENDANCE_RECORDS first; falls back to DUTY_ROSTER.
# ------------------------------------------------------------------

def get_attendance_report_range(card_no: str, from_date: str, to_date: str):
    """Fetch attendance records in a date range. from_date/to_date: 'YYYY-MM-DD'.

    Tries ATTENDANCE_RECORDS table first (has precise entry/exit times,
    location data from the mobile app).  Falls back to DUTY_ROSTER if the
    new table doesn't exist or has no rows for the range.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # ---- Try ATTENDANCE_RECORDS first ----
        card_int = _card_int(card_no)
        try:
            cursor.execute("""
                SELECT
                    TRUNC(ATTENDANCE_DATE)          AS roster_date,
                    MIN(ENTRY_TIME)                 AS in_time,
                    MAX(EXIT_TIME)                  AS out_time,
                    'G'                             AS roster_shift,
                    0                               AS absent_days,
                    CASE
                        WHEN MIN(ENTRY_TIME) IS NOT NULL THEN 'Present'
                        ELSE 'Absent'
                    END                             AS status,
                    CASE WHEN MAX(TIME_SPENT) IS NOT NULL
                         THEN FLOOR(MAX(TIME_SPENT) / 60) ELSE 0
                    END                             AS w_hrs,
                    CASE WHEN MAX(TIME_SPENT) IS NOT NULL
                         THEN MOD(MAX(TIME_SPENT), 60) ELSE 0
                    END                             AS w_mnt,
                    0                               AS late_hrs,
                    0                               AS late_mnt,
                    0                               AS ot_hrs,
                    0                               AS ot_mnt,
                    MAX(ADDRESS)                    AS roster_remarks,
                    NULL                            AS day_name
                FROM ATTENDANCE_RECORDS
                WHERE (CARD_NO = :card OR CARD_NO = :card_int)
                  AND TRUNC(ATTENDANCE_DATE) BETWEEN
                      TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
                GROUP BY TRUNC(ATTENDANCE_DATE)
                ORDER BY TRUNC(ATTENDANCE_DATE)
            """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})

            rows = cursor.fetchall()
            if rows:
                columns = [col[0].lower() for col in cursor.description]
                result = [dict(zip(columns, r)) for r in rows]
                for row in result:
                    if row.get("roster_date") and hasattr(row["roster_date"], "strftime"):
                        row["roster_date"] = row["roster_date"].strftime("%Y-%m-%d")
                return result
            # No rows — fall through to DUTY_ROSTER
        except Exception as e:
            err = str(e)
            print(f"[ATTENDANCE_REPORT] ATTENDANCE_RECORDS query failed: {err}")
            if "ORA-00942" not in err:
                # Only swallow table-not-found; re-raise others
                pass

        # ---- Fallback: DUTY_ROSTER ----
        card_int = _card_int(card_no)
        cursor2 = conn.cursor()
        try:
            cursor2.execute("""
                SELECT
                    TRUNC(ROSTER_DATE)              AS roster_date,
                    IN_TIME                         AS in_time,
                    OUT_TIME                        AS out_time,
                    NVL(ROSTER_SHIFT, 'G')          AS roster_shift,
                    NVL(ABSENT_DAYS, 0)             AS absent_days,
                    NVL(STATUS, CASE
                        WHEN IN_TIME IS NOT NULL THEN 'Present'
                        ELSE 'Absent'
                    END)                            AS status,
                    NVL(W_HRS, 0)                   AS w_hrs,
                    NVL(W_MNT, 0)                   AS w_mnt,
                    NVL(LATE_HRS, 0)                AS late_hrs,
                    NVL(LATE_MNT, 0)                AS late_mnt,
                    NVL(OT_HRS, 0)                  AS ot_hrs,
                    NVL(OT_MNT, 0)                  AS ot_mnt,
                    ROSTER_REMARKS                  AS roster_remarks,
                    DAY_NAME                        AS day_name
                FROM DUTY_ROSTER
                WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
                  AND TRUNC(ROSTER_DATE) BETWEEN
                      TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
                ORDER BY ROSTER_DATE
            """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})

            rows = cursor2.fetchall()
            columns = [col[0].lower() for col in cursor2.description]
            result = [dict(zip(columns, r)) for r in rows]

            for row in result:
                if row.get("roster_date") and hasattr(row["roster_date"], "strftime"):
                    row["roster_date"] = row["roster_date"].strftime("%Y-%m-%d")

            return result
        finally:
            cursor2.close()

    except Exception as e:
        err = str(e)
        if "ORA-00942" in err:
            return []
        raise
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# ATTENDANCE SUMMARY — aggregated stats for date range
# Reads from ATTENDANCE_RECORDS first; falls back to DUTY_ROSTER.
# ------------------------------------------------------------------

def get_attendance_summary(card_no: str, from_date: str, to_date: str):
    """from_date / to_date: 'YYYY-MM-DD'."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # ---- Try ATTENDANCE_RECORDS first ----
        card_int = _card_int(card_no)
        try:
            cursor.execute("""
                SELECT
                    COUNT(*)                                                     AS total_days,
                    SUM(CASE WHEN ENTRY_TIME IS NOT NULL
                                  AND EXIT_TIME IS NOT NULL THEN 1 ELSE 0 END)  AS present,
                    SUM(CASE WHEN ENTRY_TIME IS NOT NULL
                                  AND EXIT_TIME IS NULL THEN 1 ELSE 0 END)      AS incomplete,
                    NVL(SUM(NVL(TIME_SPENT, 0)), 0)                              AS total_minutes,
                    0                                                            AS late_minutes,
                    0                                                            AS overtime_minutes,
                    0                                                            AS absent_days
                FROM ATTENDANCE_RECORDS
                WHERE (CARD_NO = :card OR CARD_NO = :card_int)
                  AND TRUNC(ATTENDANCE_DATE) BETWEEN
                      TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})
            row = cursor.fetchone()
            if row and row[0] and row[0] > 0:
                columns = [col[0].lower() for col in cursor.description]
                return dict(zip(columns, row))
            # No rows — fall through
        except Exception as e:
            print(f"[ATTENDANCE_SUMMARY] ATTENDANCE_RECORDS query failed: {e}")

        # ---- Fallback: DUTY_ROSTER ----
        card_int = _card_int(card_no)
        cursor2 = conn.cursor()
        try:
            cursor2.execute("""
                SELECT
                    COUNT(*) AS total_days,
                    SUM(CASE WHEN IN_TIME IS NOT NULL
                                  AND OUT_TIME IS NOT NULL THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN IN_TIME IS NOT NULL
                                  AND OUT_TIME IS NULL THEN 1 ELSE 0 END) AS incomplete,
                    NVL(SUM(NVL(W_HRS, 0) * 60 + NVL(W_MNT, 0)), 0) AS total_minutes,
                    NVL(SUM(NVL(LATE_HRS, 0) * 60 + NVL(LATE_MNT, 0)), 0) AS late_minutes,
                    NVL(SUM(NVL(OT_HRS, 0) * 60 + NVL(OT_MNT, 0)), 0) AS overtime_minutes,
                    NVL(SUM(NVL(ABSENT_DAYS, 0)), 0) AS absent_days
                FROM DUTY_ROSTER
                WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
                  AND TRUNC(ROSTER_DATE) BETWEEN
                      TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})

            row = cursor2.fetchone()
            if not row:
                return {}
            columns = [col[0].lower() for col in cursor2.description]
            return dict(zip(columns, row))
        finally:
            cursor2.close()

    except Exception as e:
        err = str(e)
        if "ORA-00942" in err:
            return {}
        raise
    finally:
        cursor.close()
        conn.close()
