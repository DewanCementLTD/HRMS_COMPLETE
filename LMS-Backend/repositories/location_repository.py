"""Location tracking repository — stores hourly employee positions.

DDL (run once on Oracle DB):
    CREATE TABLE LOCATION_TRACKS (
        ID              NUMBER NOT NULL,
        CARD_NO         VARCHAR2(50) NOT NULL,
        LATITUDE        NUMBER(10,7) NOT NULL,
        LONGITUDE       NUMBER(10,7) NOT NULL,
        ACCURACY        NUMBER(10,2) DEFAULT 0,
        RECORDED_AT     TIMESTAMP NOT NULL,
        SYNCED_AT       TIMESTAMP DEFAULT SYSTIMESTAMP,
        ATTENDANCE_DATE DATE DEFAULT TRUNC(SYSDATE),
        CONSTRAINT LOCATION_TRACKS_PK PRIMARY KEY (ID)
    );
    CREATE INDEX LT_CARD_DATE_IDX ON LOCATION_TRACKS(CARD_NO, ATTENDANCE_DATE);
"""

from datetime import datetime

from core.database import get_connection


def insert_location_batch(card_no: str, locations: list) -> int:
    """Insert multiple location points. Returns count inserted."""
    if not locations:
        return 0

    conn = get_connection()
    cursor = conn.cursor()
    inserted = 0

    try:
        for loc in locations:
            recorded_at = loc.get("recorded_at", datetime.utcnow().isoformat())
            try:
                recorded_dt = datetime.fromisoformat(
                    recorded_at.replace("Z", "+00:00").replace("z", "+00:00")
                )
                # Oracle TIMESTAMP (not WITH TIME ZONE) rejects timezone-aware datetimes
                if recorded_dt.tzinfo is not None:
                    recorded_dt = recorded_dt.replace(tzinfo=None)
            except Exception:
                recorded_dt = datetime.now()

            cursor.execute(
                """
                INSERT INTO LOCATION_TRACKS (
                    ID, CARD_NO, LATITUDE, LONGITUDE, ACCURACY,
                    RECORDED_AT, SYNCED_AT, ATTENDANCE_DATE
                ) VALUES (
                    (SELECT NVL(MAX(ID), 0) + :offset FROM LOCATION_TRACKS),
                    :card_no, :lat, :lng, :acc,
                    :rec_at, SYSTIMESTAMP, TRUNC(SYSDATE)
                )
                """,
                {
                    "offset": inserted + 1,
                    "card_no": card_no,
                    "lat": float(loc.get("latitude", 0)),
                    "lng": float(loc.get("longitude", 0)),
                    "acc": float(loc.get("accuracy", 0)),
                    "rec_at": recorded_dt,
                },
            )
            inserted += 1

        conn.commit()
        print(f"[LOCATION] Saved {inserted} points for card={card_no}")
    except Exception as e:
        conn.rollback()
        print(f"[LOCATION] Batch insert error: {e}")
        raise
    finally:
        cursor.close()
        conn.close()

    return inserted


def save_attendance_origin_point(card_no: str, latitude, longitude, accuracy=None) -> bool:
    """Record the location an employee marked attendance from as a LOCATION_TRACKS
    point, so it shows up (as the first point of the day) in the web portal's
    location tracking view.

    Best-effort and idempotent: skips insertion when an identical point already
    exists for this card today (e.g. repeated check-in calls, or the app already
    sent the same coordinates via the periodic batch). RECORDED_AT is stored in
    UTC to match the convention used by insert_location_batch.

    Returns True if a new point was inserted, False otherwise.
    """
    if latitude is None or longitude is None:
        return False
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (ValueError, TypeError):
        return False
    try:
        acc = float(accuracy) if accuracy is not None else 0.0
    except (ValueError, TypeError):
        acc = 0.0

    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Insert only if no identical point already exists for this card today.
        # RECORDED_AT uses SYS_EXTRACT_UTC so the check-in time sorts correctly
        # against the app's UTC batch points (earliest first in history view).
        cursor.execute(
            """
            INSERT INTO LOCATION_TRACKS (
                ID, CARD_NO, LATITUDE, LONGITUDE, ACCURACY,
                RECORDED_AT, SYNCED_AT, ATTENDANCE_DATE
            )
            SELECT
                (SELECT NVL(MAX(ID), 0) + 1 FROM LOCATION_TRACKS),
                :card_no, :lat, :lng, :acc,
                SYS_EXTRACT_UTC(SYSTIMESTAMP), SYSTIMESTAMP, TRUNC(SYSDATE)
            FROM DUAL
            WHERE NOT EXISTS (
                SELECT 1 FROM LOCATION_TRACKS lt
                WHERE TO_CHAR(lt.CARD_NO) = :card_no
                  AND lt.ATTENDANCE_DATE = TRUNC(SYSDATE)
                  AND ROUND(lt.LATITUDE, 6)  = ROUND(:lat, 6)
                  AND ROUND(lt.LONGITUDE, 6) = ROUND(:lng, 6)
            )
            """,
            {"card_no": str(card_no), "lat": lat, "lng": lon, "acc": acc},
        )
        inserted = cursor.rowcount
        conn.commit()
        if inserted:
            print(f"[LOCATION] Attendance-origin point saved for card={card_no} ({lat},{lon})")
        else:
            print(f"[LOCATION] Attendance-origin point already present for card={card_no}")
        return bool(inserted)
    except Exception as e:
        conn.rollback()
        print(f"[LOCATION] Attendance-origin insert failed (non-fatal): {e}")
        return False
    finally:
        cursor.close()
        conn.close()


def _safe_int(v):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def get_all_locations_summary(date_str: str, allowed_companies=None, allowed_branches=None) -> list:
    """Fetch employees with location data for a date, restricted to allowed companies/branches."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        params: dict = {"dt": date_str}
        extra_filter = ""

        if allowed_companies:
            nums = [n for n in (_safe_int(c) for c in allowed_companies) if n is not None]
            if nums:
                ph = ", ".join(f":cmpf{i}" for i in range(len(nums)))
                extra_filter += f" AND TO_NUMBER(h.UNIT_ID) IN ({ph})"
                for i, n in enumerate(nums):
                    params[f"cmpf{i}"] = n

        if allowed_branches:
            nums = [n for n in (_safe_int(b) for b in allowed_branches) if n is not None]
            if nums:
                ph = ", ".join(f":brnf{i}" for i in range(len(nums)))
                extra_filter += f" AND TO_NUMBER(h.LOCATION) IN ({ph})"
                for i, n in enumerate(nums):
                    params[f"brnf{i}"] = n

        cursor.execute(
            f"""
            SELECT
                lt.CARD_NO,
                NVL(h.NAME, lt.CARD_NO) AS EMPLOYEE_NAME,
                h.EMPCODE,
                COUNT(*) AS POINT_COUNT,
                TO_CHAR(MAX(lt.RECORDED_AT), 'YYYY-MM-DD HH24:MI:SS') AS LAST_SEEN,
                MAX(lt.LATITUDE) KEEP (DENSE_RANK LAST ORDER BY lt.RECORDED_AT) AS LAST_LAT,
                MAX(lt.LONGITUDE) KEEP (DENSE_RANK LAST ORDER BY lt.RECORDED_AT) AS LAST_LNG,
                MAX(lt.ACCURACY) KEEP (DENSE_RANK LAST ORDER BY lt.RECORDED_AT) AS LAST_ACC
            FROM LOCATION_TRACKS lt
            INNER JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = lt.CARD_NO
                                  OR e.CARD_NO = TO_NUMBER(REGEXP_SUBSTR(lt.CARD_NO, '^[0-9]+'))
            INNER JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
            WHERE lt.ATTENDANCE_DATE = TO_DATE(:dt, 'YYYY-MM-DD'){extra_filter}
            GROUP BY lt.CARD_NO, h.NAME, h.EMPCODE
            ORDER BY MAX(lt.RECORDED_AT) DESC
            """,
            params,
        )
        rows = cursor.fetchall()
        return [
            {
                "card_no": r[0],
                "employee_name": r[1],
                "empcode": r[2],
                "point_count": int(r[3]),
                "last_seen": str(r[4]) if r[4] else None,
                "last_latitude": float(r[5]) if r[5] is not None else None,
                "last_longitude": float(r[6]) if r[6] is not None else None,
                "last_accuracy": float(r[7] or 0),
            }
            for r in rows
        ]
    finally:
        cursor.close()
        conn.close()


def get_location_history(card_no: str, date_str: str) -> list:
    """Fetch all location points for a card on a given date (YYYY-MM-DD)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT LATITUDE, LONGITUDE, ACCURACY, RECORDED_AT
            FROM   LOCATION_TRACKS
            WHERE  (TO_CHAR(CARD_NO) = :card
                    OR TO_CHAR(CARD_NO) = :card_int)
              AND  ATTENDANCE_DATE = TO_DATE(:dt, 'YYYY-MM-DD')
            ORDER BY RECORDED_AT ASC
            """,
            {
                "card": card_no,
                "card_int": card_no.split(".")[0] if "." in card_no else card_no,
                "dt": date_str,
            },
        )
        rows = cursor.fetchall()
        return [
            {
                "latitude": float(r[0]),
                "longitude": float(r[1]),
                "accuracy": float(r[2] or 0),
                "recorded_at": str(r[3]),
            }
            for r in rows
        ]
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# LOCATION TRACKING REPORTS (employee-wise trail + per-day summary)
# ------------------------------------------------------------------

from math import radians, sin, cos, asin, sqrt


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    """Great-circle distance between two lat/lon points, in kilometres."""
    if None in (lat1, lon1, lat2, lon2):
        return 0.0
    r = 6371.0  # Earth radius km
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return round(2 * r * asin(sqrt(a)), 2)


def _build_report_filters(params: dict, allowed_companies=None, allowed_branches=None,
                          dept_no=None, desg_cd=None, empcodes=None) -> str:
    """Build a ' AND ...' SQL fragment restricting the HR_EMP_MASTER alias `h` to the
    given company/branch/department/designation/employee selections. Populates params.
    Each argument may be a list (multi-select) or None."""
    def _nums(vals):
        return [n for n in (_safe_int(v) for v in (vals or [])) if n is not None]

    parts = []
    for col, vals, pfx in (
        ("h.UNIT_ID", allowed_companies, "cf"),
        ("h.LOCATION", allowed_branches, "bf"),
        ("h.DEPT_NO", dept_no, "df"),
        ("h.DESG_CD", desg_cd, "gf"),
    ):
        nums = _nums(vals)
        if nums:
            ph = ", ".join(f":{pfx}{i}" for i in range(len(nums)))
            parts.append(f"TO_NUMBER({col}) IN ({ph})")
            for i, n in enumerate(nums):
                params[f"{pfx}{i}"] = n

    emps = [str(e).strip() for e in (empcodes or []) if str(e).strip()]
    if emps:
        ph = ", ".join(f":ef{i}" for i in range(len(emps)))
        parts.append(f"h.EMPCODE IN ({ph})")
        for i, e in enumerate(emps):
            params[f"ef{i}"] = e

    return (" AND " + " AND ".join(parts)) if parts else ""


def _build_optional_filters(params: dict, region=None, category=None) -> str:
    """Build a ' AND ...' fragment for Region (COM_LOCATION.REGIONCODE via the
    employee's branch) and Employee Category (HR_EMP_MASTER.CADRE). These columns
    are less certain than the core ones, so the caller retries without this
    fragment if Oracle reports a missing column (ORA-00904)."""
    parts = []
    regions = [str(r).strip() for r in (region or []) if str(r).strip()]
    if regions:
        ph = ", ".join(f":rg{i}" for i in range(len(regions)))
        parts.append(
            f"TO_CHAR(h.LOCATION) IN (SELECT TO_CHAR(LCODE) FROM COM_LOCATION WHERE REGIONCODE IN ({ph}))"
        )
        for i, rv in enumerate(regions):
            params[f"rg{i}"] = rv

    cats = [str(c).strip() for c in (category or []) if str(c).strip()]
    if cats:
        ph = ", ".join(f":ct{i}" for i in range(len(cats)))
        parts.append(f"h.CADRE IN ({ph})")
        for i, cv in enumerate(cats):
            params[f"ct{i}"] = cv

    return (" AND " + " AND ".join(parts)) if parts else ""


def _fetch_trail_rows(from_date, to_date, *, allowed_companies=None, allowed_branches=None,
                      dept_no=None, desg_cd=None, empcodes=None, region=None, category=None) -> list:
    """Return every GPS point in range joined to employee master, ordered by
    employee then time. Shared by the detail and summary reports."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        base_params = {"from_d": from_date, "to_d": to_date}
        core = _build_report_filters(
            base_params, allowed_companies, allowed_branches, dept_no, desg_cd, empcodes
        )

        def _sql(extra_filter):
            return f"""
            SELECT
                h.EMPCODE,
                h.NAME,
                NVL((SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
                       WHERE LTRIM(d.DEPT_NO,'0')=LTRIM(h.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(h.UNIT_ID)),
                    TO_CHAR(h.DEPT_NO)) AS DEPT_NAME,
                NVL((SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg
                       WHERE LTRIM(dg.DESG_CD,'0')=LTRIM(h.DESG_CD,'0')),
                    TO_CHAR(h.DESG_CD)) AS DESG_NAME,
                TO_CHAR(lt.ATTENDANCE_DATE, 'YYYY-MM-DD')          AS ADATE,
                TO_CHAR(lt.RECORDED_AT, 'YYYY-MM-DD HH24:MI:SS')   AS RECORDED_AT,
                lt.LATITUDE,
                lt.LONGITUDE,
                lt.ACCURACY
            FROM LOCATION_TRACKS lt
            INNER JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = lt.CARD_NO
                                  OR e.CARD_NO = TO_NUMBER(REGEXP_SUBSTR(lt.CARD_NO, '^[0-9]+'))
            INNER JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
            WHERE lt.ATTENDANCE_DATE BETWEEN TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
              {core}{extra_filter}
            ORDER BY h.EMPCODE, lt.ATTENDANCE_DATE, lt.RECORDED_AT, lt.ID
            FETCH FIRST 50000 ROWS ONLY
            """

        # Try with the optional Region/Category filters; if those columns don't
        # exist in this schema (ORA-00904), fall back to core filters only.
        opt_params = {}
        opt = _build_optional_filters(opt_params, region, category)
        try:
            cursor.execute(_sql(opt), {**base_params, **opt_params})
        except Exception as e:
            if opt and "ORA-00904" in str(e):
                print(f"[LOCATION_REPORT] region/category column missing, ignoring those filters: {e}")
                cursor.execute(_sql(""), base_params)
            else:
                raise

        cols = [c[0].lower() for c in cursor.description]
        return [dict(zip(cols, r)) for r in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def get_location_trail_report(from_date, to_date, **filters) -> list:
    """Feature 1 — one row per GPS point, with distance-from-previous and
    Login/Active/Logout status computed per employee per day."""
    rows = _fetch_trail_rows(from_date, to_date, **filters)
    out = []
    # rows are ordered by (empcode, date, time). Walk each (empcode, date) group.
    i = 0
    n = len(rows)
    while i < n:
        j = i
        key = (rows[i]["empcode"], rows[i]["adate"])
        while j < n and (rows[j]["empcode"], rows[j]["adate"]) == key:
            j += 1
        group = rows[i:j]
        prev_lat = prev_lon = None
        for idx, p in enumerate(group):
            lat = float(p["latitude"]) if p["latitude"] is not None else None
            lon = float(p["longitude"]) if p["longitude"] is not None else None
            dist = 0.0 if idx == 0 else _haversine_km(prev_lat, prev_lon, lat, lon)
            if idx == 0:
                status = "Login"
            elif idx == len(group) - 1:
                status = "Logout"
            else:
                status = "Active"
            out.append({
                "empcode": p["empcode"],
                "name": (p["name"] or "").strip(),
                "department": (p["dept_name"] or "").strip(),
                "designation": (p["desg_name"] or "").strip(),
                "date": p["adate"],
                "recorded_at": p["recorded_at"],   # UTC; frontend converts to local
                "latitude": lat,
                "longitude": lon,
                "accuracy": float(p["accuracy"] or 0),
                "distance_km": dist,
                "status": status,
            })
            prev_lat, prev_lon = lat, lon
        i = j
    return out


def get_location_summary_report(from_date, to_date, **filters) -> list:
    """Feature 2 — one row per employee per day: first/last time, point count,
    total distance covered, and Present status."""
    rows = _fetch_trail_rows(from_date, to_date, **filters)
    summary = []
    i = 0
    n = len(rows)
    while i < n:
        j = i
        key = (rows[i]["empcode"], rows[i]["adate"])
        while j < n and (rows[j]["empcode"], rows[j]["adate"]) == key:
            j += 1
        group = rows[i:j]
        total_km = 0.0
        prev_lat = prev_lon = None
        for idx, p in enumerate(group):
            lat = float(p["latitude"]) if p["latitude"] is not None else None
            lon = float(p["longitude"]) if p["longitude"] is not None else None
            if idx > 0:
                total_km += _haversine_km(prev_lat, prev_lon, lat, lon)
            prev_lat, prev_lon = lat, lon
        summary.append({
            "empcode": group[0]["empcode"],
            "name": (group[0]["name"] or "").strip(),
            "department": (group[0]["dept_name"] or "").strip(),
            "designation": (group[0]["desg_name"] or "").strip(),
            "date": group[0]["adate"],
            "first_time": group[0]["recorded_at"],
            "last_time": group[-1]["recorded_at"],
            "total_entries": len(group),
            "total_distance_km": round(total_km, 2),
            "status": "Present",
        })
        i = j
    return summary
