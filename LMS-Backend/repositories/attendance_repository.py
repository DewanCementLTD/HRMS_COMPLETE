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
    CHECKOUT_LATS / CHECKOUT_LONGS (VARCHAR2(50)), CHECKOUT_ADDRESS (VARCHAR2(400))
        — the check-out location, kept separate from the check-in location above.

    EXIT_DATE (DATE)              — the actual check-out instant; set on check-out
        (update_check_out writes SYSDATE). OUT_DT is derived from this.

Virtual (read-only, auto-derived) columns — do NOT insert/update them:
    IN_DT (VARCHAR2(30))   — ENTRY_TIME + ATTENDANCE_DATE, 'DD-MON-YY HH24:MI'.
    OUT_DT (VARCHAR2(30))  — EXIT_DATE formatted 'DD-MON-YY HH24:MI'
        (naturally rolls to the next day for overnight shifts).
    TOTAL_HOURS (VARCHAR2(20)) — TIME_SPENT shown as HRS:MINS (zero-padded HH:MM).
    These are computed from the columns above, so they always stay in sync and
    require no virtual-column write. See sql/2026-06-24_attendance_virtual_cols.sql.
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
    """Minutes between two HH:MI strings. If exit is earlier than entry the
    shift crossed midnight (e.g. 20:00 -> 04:00), so add a full day."""
    try:
        fmt = "%H:%M"
        t1 = datetime.strptime(entry.strip()[:5], fmt)
        t2 = datetime.strptime(exit_.strip()[:5], fmt)
        diff = (t2 - t1).total_seconds() / 60
        if diff < 0:
            diff += 1440   # overnight shift
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


def get_open_overnight_record(card_no: str, max_window_hours: int = 16):
    """For a NIGHT-shift worker, return a still-open check-in from a PRIOR day
    that the current (after-midnight) mark should close, or None.

    Used when there is no record for *today*: a person on an overnight shift
    (DUTY_ROSTER shift whose SHIFT_HEAD time_to is earlier than time_from, e.g.
    20:00 -> 04:00) who checked in last night and is now marking their check-out
    after midnight. We only do this when the open check-in is recent (within
    max_window_hours) so a genuinely forgotten check-out becomes a fresh day,
    not a 24-hour shift.
    """
    conn = get_connection()
    cursor = conn.cursor()
    card_int = _card_int(card_no)
    try:
        # Most recent OPEN check-in from a previous day, with hours since entry.
        cursor.execute("""
            SELECT ID, ENTRY_TIME, TO_CHAR(CARD_NO), EMPCODE,
                   TO_CHAR(ATTENDANCE_DATE, 'YYYY-MM-DD'),
                   (SYSDATE - (TRUNC(ATTENDANCE_DATE)
                               + TO_NUMBER(SUBSTR(ENTRY_TIME,1,2))/24
                               + TO_NUMBER(SUBSTR(ENTRY_TIME,4,2))/1440)) * 24 AS hrs_since_in
            FROM ATTENDANCE_RECORDS
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND ENTRY_TIME IS NOT NULL AND EXIT_TIME IS NULL
              AND TRUNC(ATTENDANCE_DATE) < TRUNC(SYSDATE)
              AND REGEXP_LIKE(ENTRY_TIME, '^[0-9][0-9]:[0-9][0-9]$')
            ORDER BY ID DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"card": card_no, "card_int": card_int})
        row = cursor.fetchone()
        if not row:
            return None
        rid, entry, card_full, empcode, rdate, hrs = row
        if hrs is None or hrs < 1 or hrs > max_window_hours:
            return None  # <1h (handled elsewhere) or too old (forgotten checkout)

        # Was that day's shift an OVERNIGHT one (time_to < time_from)?
        cursor.execute("""
            SELECT sh.TIME_FROM, sh.TIME_TO
            FROM SHIFT_HEAD sh
            WHERE sh.compc = (SELECT TO_NUMBER(MAX(UNIT_ID)) FROM HR_EMP_MASTER WHERE EMPCODE = :emp)
              AND sh.shift = (
                    SELECT MIN(ROSTER_SHIFT) FROM DUTY_ROSTER
                     WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int
                            OR TO_CHAR(EMP_FK) = :card)
                       AND TRUNC(ROSTER_DATE) = TO_DATE(:rdate, 'YYYY-MM-DD'))
              AND ROWNUM = 1
        """, {"emp": empcode, "card": card_no, "card_int": card_int, "rdate": rdate})
        sh = cursor.fetchone()
        if not sh:
            return None
        time_from, time_to = (sh[0] or "").strip(), (sh[1] or "").strip()
        # Overnight only when the shift end is earlier in the clock than its start.
        if not time_from or not time_to or time_to >= time_from:
            return None

        return {
            "id": rid,
            "entry_time": (entry or "").strip(),
            "exit_time": "",
            "card_no": (card_full or card_no),
            "source": "attendance_records",
        }
    except Exception as e:
        print(f"[OVERNIGHT] lookup failed for card={card_no}: {e}")
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
                     source: str = "attendance_records", current_out: str = None,
                     checkout_lat=None, checkout_long=None, checkout_address=None):
    """Extend today's ATTENDANCE_RECORDS row's EXIT_TIME to the LATEST mark.
    OUT_TIME = later(existing OUT, now); ENTRY_TIME (set on the first mark) stays
    the earliest. record_id is the ATTENDANCE_RECORDS.ID. DUTY_ROSTER is the
    ERP's table and is never written here.

    The location sent with the check-out is stored in the dedicated columns
    CHECKOUT_LATS / CHECKOUT_LONGS / CHECKOUT_ADDRESS (separate from the
    check-in location in LATITUDE / LONGITUDE / ADDRESS), so each row keeps the
    check-in spot AND the check-out spot. Only overwritten when the latest mark
    actually carries a location."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        now = _now_hhmm()
        out_time = _later_hhmm(now, current_out)
        spent = _time_spent_minutes(entry_time, out_time)

        params = {"exit_time": out_time, "time_spent": spent, "rid": record_id}
        loc_set = ""
        if checkout_lat is not None or checkout_long is not None or checkout_address is not None:
            params["co_lat"] = str(checkout_lat) if checkout_lat is not None else None
            params["co_long"] = str(checkout_long) if checkout_long is not None else None
            params["co_addr"] = _btrunc(checkout_address, 400) if checkout_address else None
            loc_set = (",\n                CHECKOUT_LATS    = :co_lat,"
                       "\n                CHECKOUT_LONGS   = :co_long,"
                       "\n                CHECKOUT_ADDRESS = :co_addr")

        # EXIT_DATE = the actual check-out instant (full date-time). OUT_DT is a
        # virtual column derived from it (formatted DD-MON-YY HH24:MI), so this
        # is what drives the displayed check-out date-time.
        _run_with_retry(lambda: cursor.execute(f"""
            UPDATE ATTENDANCE_RECORDS
            SET EXIT_TIME  = :exit_time,
                EXIT_DATE  = SYSDATE,
                TIME_SPENT = :time_spent{loc_set}
            WHERE ID = :rid
        """, params),
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
# ATTENDANCE REPORT — sourced from TMS_DUTY_ROSTER_V (the ERP duty-roster view)
#
# The view carries the ERP's own per-person-per-day roster with the derived
# status flags the app cannot compute itself:
#   MORNING_LATE / EARLY_OUT_LATE = 'Y'  → late      (shown yellow)
#   MORNING_HALF_DAY / EAR_OUT_HALF_DAY  → half day  (shown orange)
#   ABSENT = 1 with no punch             → absent    (shown red)
# ABSENT = 1 is the roster's *default* until the ERP reconciles a punch, so a
# row is only truly "Absent" when it also has no IN/OUT time. Late / half-day
# imply attendance, so they take priority over the absent flag.
# CARD_NO in the view is the full company-qualified card (e.g. 100011.2).
# ------------------------------------------------------------------

def _clean_hhmm(s):
    """Return an 'HH:MI' string, or None for empty/':' placeholders the ERP
    leaves in IN_TIME / OUT_TIME when there was no punch."""
    if s is None:
        return None
    t = str(s).strip()
    if not t or t == ":" or _hhmm_to_min(t) is None:
        return None
    return t[:5]


def _roster_status(in_time, out_time, absent, morning_late, early_out_late, half_day):
    """Collapse the ERP roster flags into a single status label. Order matters:
    late / half-day imply the person attended, so they win over the ABSENT
    default; a row is only 'Absent' when flagged absent AND has no punch."""
    ml = (morning_late or "").strip().upper()
    eol = (early_out_late or "").strip().upper()
    has_punch = bool(in_time) or bool(out_time)
    try:
        hd = float(half_day or 0)
    except (TypeError, ValueError):
        hd = 0
    if ml == "Y" or eol == "Y":
        return "Late"
    if hd > 0:
        return "Half Day"
    if absent and int(absent) == 1 and not has_punch:
        return "Absent"
    if has_punch:
        return "Present"
    return "Off"


def _shape_roster_row(rec):
    """Normalise a raw TMS_DUTY_ROSTER_V dict into the AttendanceRecord shape the
    frontend expects, adding cleaned times, a status label and boolean flags."""
    if rec.get("roster_date") and hasattr(rec["roster_date"], "strftime"):
        rec["roster_date"] = rec["roster_date"].strftime("%Y-%m-%d")

    in_time = _clean_hhmm(rec.get("in_time"))
    out_time = _clean_hhmm(rec.get("out_time"))
    absent = rec.get("absent")
    morning_late = rec.get("morning_late")
    early_out_late = rec.get("early_out_late")
    half_day = (rec.get("morning_half_day") or 0) + (rec.get("ear_out_half_day") or 0)

    status = _roster_status(in_time, out_time, absent, morning_late, early_out_late, half_day)

    worked = _time_spent_minutes(in_time, out_time) if (in_time and out_time) else 0

    rec["in_time"] = in_time
    rec["out_time"] = out_time
    rec["w_hrs"] = worked // 60
    rec["w_mnt"] = worked % 60
    rec["late_hrs"] = 0
    rec["late_mnt"] = 0
    rec["ot_hrs"] = 0
    rec["ot_mnt"] = 0
    rec["absent_days"] = 1 if status == "Absent" else 0
    rec["half_day"] = half_day
    rec["morning_late"] = (morning_late or "").strip() or None
    rec["early_out_late"] = (early_out_late or "").strip() or None
    rec["status"] = status
    rec["is_late"] = status == "Late"
    rec["is_absent"] = status == "Absent"
    rec["is_half_day"] = status == "Half Day"
    for k in ("morning_half_day", "ear_out_half_day"):
        rec.pop(k, None)
    return rec


_ROSTER_SELECT = """
    TRUNC(ROSTER_DATE)      AS roster_date,
    DAY_NAME                AS day_name,
    ROSTER_SHIFT            AS roster_shift,
    ROSTER_MONTH            AS roster_month,
    IN_TIME                 AS in_time,
    OUT_TIME                AS out_time,
    ABSENT                  AS absent,
    MORNING_LATE            AS morning_late,
    EARLY_OUT_LATE          AS early_out_late,
    MORNING_HALF_DAY        AS morning_half_day,
    EAR_OUT_HALF_DAY        AS ear_out_half_day,
    LEAVE_REMARKS           AS leave_remarks,
    ROSTER_REMARKS          AS roster_remarks
"""


def get_attendance_report(card_no: str, date_str: str):
    """Single-day roster row for a card. date_str: ORDS-style 'DD-MON-YYYY'."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(f"""
            SELECT {_ROSTER_SELECT}
            FROM TMS_DUTY_ROSTER_V
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND TRUNC(ROSTER_DATE) = TO_DATE(:dt, 'DD-MON-YYYY')
            ORDER BY ROSTER_DATE
        """, {"card": card_no, "card_int": _card_int(card_no), "dt": date_str})

        columns = [col[0].lower() for col in cursor.description]
        result = [_shape_roster_row(dict(zip(columns, r))) for r in cursor.fetchall()]
        return result
    except Exception as e:
        if "ORA-00942" in str(e):
            return []
        raise
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# ATTENDANCE REPORT — date range (one row per roster day)
# ------------------------------------------------------------------

def get_attendance_report_range(card_no: str, from_date: str, to_date: str):
    """Fetch one employee's roster rows in a date range from TMS_DUTY_ROSTER_V.
    from_date/to_date: 'YYYY-MM-DD'. Each row carries the ERP late / half-day /
    absent flags so the report can colour late (yellow), half-day (orange) and
    absent (red)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        card_int = _card_int(card_no)
        cursor.execute(f"""
            SELECT {_ROSTER_SELECT}
            FROM TMS_DUTY_ROSTER_V
            WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
              AND TRUNC(ROSTER_DATE) BETWEEN
                  TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            ORDER BY ROSTER_DATE
        """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})

        columns = [col[0].lower() for col in cursor.description]
        result = [_shape_roster_row(dict(zip(columns, r))) for r in cursor.fetchall()]
        return result

    except Exception as e:
        if "ORA-00942" in str(e):
            return []
        raise
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# ATTENDANCE SUMMARY — aggregated stats for a date range
# ------------------------------------------------------------------

def get_attendance_summary(card_no: str, from_date: str, to_date: str):
    """Aggregate one employee's roster over a date range from TMS_DUTY_ROSTER_V.
    Present = has a punch; Absent = flagged absent with no punch; Late / Half-Day
    are counted from the ERP flags. from_date / to_date: 'YYYY-MM-DD'."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        card_int = _card_int(card_no)
        cursor.execute("""
            WITH r AS (
                SELECT
                    CASE WHEN IN_TIME  IS NOT NULL AND TRIM(IN_TIME)  <> ':'
                         THEN 1 ELSE 0 END                          AS has_in,
                    CASE WHEN OUT_TIME IS NOT NULL AND TRIM(OUT_TIME) <> ':'
                         THEN 1 ELSE 0 END                          AS has_out,
                    NVL(ABSENT, 0)                                  AS absent,
                    CASE WHEN UPPER(NVL(MORNING_LATE, ' ')) = 'Y'
                           OR UPPER(NVL(EARLY_OUT_LATE, ' ')) = 'Y'
                         THEN 1 ELSE 0 END                          AS is_late,
                    CASE WHEN NVL(MORNING_HALF_DAY, 0) > 0
                           OR NVL(EAR_OUT_HALF_DAY, 0) > 0
                         THEN 1 ELSE 0 END                          AS is_half
                FROM TMS_DUTY_ROSTER_V
                WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
                  AND TRUNC(ROSTER_DATE) BETWEEN
                      TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            )
            SELECT
                COUNT(*)                                                     AS total_days,
                SUM(CASE WHEN has_in = 1 OR has_out = 1 THEN 1 ELSE 0 END)   AS present,
                SUM(CASE WHEN has_in = 1 AND has_out = 0 THEN 1 ELSE 0 END)  AS incomplete,
                0                                                            AS total_minutes,
                0                                                            AS late_minutes,
                0                                                            AS overtime_minutes,
                SUM(CASE WHEN absent = 1 AND has_in = 0 AND has_out = 0
                         THEN 1 ELSE 0 END)                                  AS absent_days,
                SUM(is_late)                                                 AS late_days,
                SUM(is_half)                                                 AS half_days
            FROM r
        """, {"card": card_no, "card_int": card_int, "from_d": from_date, "to_d": to_date})
        row = cursor.fetchone()
        if not row:
            return {}
        columns = [col[0].lower() for col in cursor.description]
        return dict(zip(columns, row))

    except Exception as e:
        if "ORA-00942" in str(e):
            return {}
        raise
    finally:
        cursor.close()
        conn.close()
