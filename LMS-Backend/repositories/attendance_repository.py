"""Attendance repository — reads and writes attendance ONLY via ATTENDANCE_RECORDS.

DUTY_ROSTER is an ERP-owned table that is populated automatically by the ERP;
this app no longer reads or writes it. Late / overtime / absent / shift are
DUTY_ROSTER (ERP) concepts that ATTENDANCE_RECORDS cannot compute, so they are
reported as 0/empty here.

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


def _btrunc(s, max_bytes: int):
    """Truncate a string so its UTF-8 encoding fits in max_bytes. Oracle VARCHAR2
    columns are sized in BYTES, so a character-count slice (e.g. addresses with
    non-ASCII chars) can still overflow and raise ORA-12899."""
    if s is None:
        return None
    b = str(s).encode("utf-8")[:max_bytes]
    return b.decode("utf-8", "ignore")  # drop a trailing partial multibyte char


def _hhmm_to_min(s):
    """Minutes-since-midnight for an 'HH:MI' string, or None."""
    try:
        h, m = str(s).strip()[:5].split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return None


def _later_hhmm(a, b):
    """Return whichever of two 'HH:MI' strings is the later time of day."""
    ma, mb = _hhmm_to_min(a), _hhmm_to_min(b)
    if ma is None:
        return b
    if mb is None:
        return a
    return a if ma >= mb else b


# Transient DB errors that should be retried rather than dropped: the MAX(PK)+1
# id generation races (unique-violation) when several employees mark at the same
# moment, plus deadlock/serialization. Retrying re-reads MAX and succeeds.
_TRANSIENT_DB_ERRORS = ("ORA-00001", "ORA-00060", "ORA-08177")


def _is_transient_db_error(exc) -> bool:
    msg = str(exc)
    return any(code in msg for code in _TRANSIENT_DB_ERRORS)


def _run_with_retry(fn, attempts: int = 5, what: str = ""):
    """Run fn(); on a transient DB error (e.g. PK collision from concurrent
    check-ins) retry a few times with a small backoff. Re-raises on the last try
    or on a non-transient error."""
    import time
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            if not _is_transient_db_error(e) or i == attempts - 1:
                raise
            print(f"[ATTENDANCE] transient error{(' on ' + what) if what else ''}, retry {i + 1}/{attempts}: {e}")
            time.sleep(0.05 * (i + 1))


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
    """Return today's ATTENDANCE_RECORDS row for this card, or None.

    ATTENDANCE_RECORDS is the app's single source of truth for attendance; the
    ERP populates DUTY_ROSTER separately, so the app never reads/writes it.
    """
    conn = get_connection()
    cursor = conn.cursor()
    card_int = _card_int(card_no)
    try:
        cursor.execute("""
            SELECT ID, ENTRY_TIME, EXIT_TIME, TO_CHAR(CARD_NO)
            FROM ATTENDANCE_RECORDS
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND TRUNC(ATTENDANCE_DATE) = TRUNC(SYSDATE)
            ORDER BY ID DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"card": card_no, "card_int": card_int})
        row = cursor.fetchone()
        if row:
            return {
                "id": row[0],
                "entry_time": (row[1] or "").strip(),
                "exit_time": (row[2] or "").strip(),
                "card_no": (row[3] or card_no),
                "source": "attendance_records",
            }
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
# CHECK-IN: upsert today's ATTENDANCE_RECORDS row (the app's only store)
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

        # ATTENDANCE_RECORDS is the app's only attendance store. DUTY_ROSTER is
        # the ERP's table and is populated automatically there — we never write it.
        # MERGE prevents duplicate rows when check-in is called more than once for
        # the same card on the same day, and keeps the EARLIEST mark as ENTRY_TIME.
        try:
            params = {
                "empcode": empcode,
                "card_no": card_no,
                "entry_time": now,
                "att_type": attendance_type,
                "latitude": str(latitude) if latitude else None,
                "longitude": str(longitude) if longitude else None,
                "accuracy": str(accuracy) if accuracy else None,
                "address": _btrunc(address, 100) if address else None,
                "formatted_address": _btrunc(formatted_address, 400) if formatted_address else None,
                "ts": _btrunc(timestamp, 400) if timestamp else None,
                "device_id": _btrunc(device_id, 400) if device_id else None,
                "device_model": _btrunc(device_model, 400) if device_model else None,
                "app_version": _btrunc(app_version, 400) if app_version else None,
            }
            _run_with_retry(lambda: cursor.execute("""
                MERGE INTO ATTENDANCE_RECORDS ar
                USING (SELECT :card_no AS cno, TRUNC(SYSDATE) AS adate FROM DUAL) src
                ON (ar.CARD_NO = src.cno
                    AND TRUNC(ar.ATTENDANCE_DATE) = src.adate
                    AND ar.EXIT_TIME IS NULL)
                WHEN MATCHED THEN
                    UPDATE SET ar.ENTRY_TIME        = CASE
                                   WHEN ar.ENTRY_TIME IS NULL THEN :entry_time
                                   WHEN :entry_time < ar.ENTRY_TIME THEN :entry_time
                                   ELSE ar.ENTRY_TIME END,
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
                    -- ID is an identity column (GENERATED BY DEFAULT); let Oracle
                    -- assign it instead of computing MAX(ID)+1 (which raced and
                    -- caused intermittent ORA-00001 rejections).
                    INSERT (EMPCODE, CARD_NO, ENTRY_TIME,
                            ATTENDANCE_DATE, ATTENDANCE_TYPE,
                            LATITUDE, LONGITUDE, ACCURACY,
                            ADDRESS, FORMATTED_ADDRESS,
                            TIMESTAMP, DEVICE_ID, DEVICE_MODEL,
                            APP_VERSION)
                    VALUES (
                        :empcode, :card_no, :entry_time,
                        TRUNC(SYSDATE), :att_type,
                        :latitude, :longitude, :accuracy,
                        :address, :formatted_address,
                        :ts, :device_id, :device_model,
                        :app_version
                    )
            """, params), what="ATTENDANCE_RECORDS")
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
                     source: str = "attendance_records", current_out: str = None):
    """Extend today's ATTENDANCE_RECORDS row's EXIT_TIME to the LATEST mark.
    OUT_TIME = later(existing OUT, now); ENTRY_TIME (set on the first mark) stays
    the earliest. record_id is the ATTENDANCE_RECORDS.ID. DUTY_ROSTER is the
    ERP's table and is never written here."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        now = _now_hhmm()
        out_time = _later_hhmm(now, current_out)
        spent = _time_spent_minutes(entry_time, out_time)

        _run_with_retry(lambda: cursor.execute("""
            UPDATE ATTENDANCE_RECORDS
            SET EXIT_TIME  = :exit_time,
                TIME_SPENT = :time_spent
            WHERE ID = :rid
        """, {"exit_time": out_time, "time_spent": spent, "rid": record_id}),
            what="ATTENDANCE_RECORDS checkout")

        conn.commit()
        return {
            "status": "success",
            "message": f"Checked out successfully ({spent} min)",
            "action": "check_out",
            "marked_at": out_time,
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
                TRUNC(ATTENDANCE_DATE)          AS roster_date,
                ENTRY_TIME                      AS in_time,
                EXIT_TIME                       AS out_time,
                'G'                             AS roster_shift,
                0                               AS absent_days,
                CASE WHEN ENTRY_TIME IS NOT NULL THEN 'Present' ELSE 'Absent' END AS status,
                FLOOR(NVL(TIME_SPENT, 0) / 60)  AS w_hrs,
                MOD(NVL(TIME_SPENT, 0), 60)     AS w_mnt,
                0                               AS late_hrs,
                0                               AS late_mnt,
                0                               AS ot_hrs,
                0                               AS ot_mnt,
                CAST(NULL AS VARCHAR2(200))     AS roster_remarks,
                CAST(NULL AS VARCHAR2(20))      AS day_name
            FROM ATTENDANCE_RECORDS
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND TRUNC(ATTENDANCE_DATE) = TO_DATE(:dt, 'DD-MON-YYYY')
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

    Reads ATTENDANCE_RECORDS only (precise entry/exit times + mobile location).
    One row per day: IN = earliest mark, OUT = latest mark.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        card_int = _card_int(card_no)
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
                CAST(NULL AS VARCHAR2(20))      AS day_name
            FROM ATTENDANCE_RECORDS
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND TRUNC(ATTENDANCE_DATE) BETWEEN
                  TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            GROUP BY TRUNC(ATTENDANCE_DATE)
            ORDER BY TRUNC(ATTENDANCE_DATE)
        """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})

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
# ATTENDANCE SUMMARY — aggregated stats for date range
# Reads from ATTENDANCE_RECORDS first; falls back to DUTY_ROSTER.
# ------------------------------------------------------------------

def get_attendance_summary(card_no: str, from_date: str, to_date: str):
    """from_date / to_date: 'YYYY-MM-DD'. Reads ATTENDANCE_RECORDS only."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        card_int = _card_int(card_no)
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
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND TRUNC(ATTENDANCE_DATE) BETWEEN
                  TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
        """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})
        row = cursor.fetchone()
        if not row:
            return {}
        columns = [col[0].lower() for col in cursor.description]
        return dict(zip(columns, row))

    except Exception as e:
        err = str(e)
        if "ORA-00942" in err:
            return {}
        raise
    finally:
        cursor.close()
        conn.close()
