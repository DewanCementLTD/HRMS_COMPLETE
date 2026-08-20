"""App version repository — drives the mobile "please update" flow.

Reads the APP_VERSION table and decides whether a given app version is up to
date, needs a soft (optional) update, or a force (mandatory) update. Degrades
gracefully: if the extra columns don't exist it falls back to a single VERSION
column, and if the table is missing/empty it never blocks anyone.

    ALTER TABLE APP_VERSION ADD (
        PLATFORM VARCHAR2(20) DEFAULT 'ANDROID', MIN_VERSION VARCHAR2(100),
        LATEST_VERSION VARCHAR2(100), MIN_BUILD NUMBER, LATEST_BUILD NUMBER,
        UPDATE_URL VARCHAR2(400), FORCE_MESSAGE VARCHAR2(400),
        SOFT_MESSAGE VARCHAR2(400), UPDATED_AT DATE DEFAULT SYSDATE
    );
"""

import re

from core.database import get_connection


def _parse_ver(s):
    if not s:
        return ()
    parts = re.findall(r"\d+", str(s))
    return tuple(int(p) for p in parts) if parts else ()


def _cmp_ver(a, b) -> int:
    la, lb = list(a), list(b)
    n = max(len(la), len(lb))
    la += [0] * (n - len(la))
    lb += [0] * (n - len(lb))
    return (la > lb) - (la < lb)


def _to_int(v):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def get_app_version_config(platform: str = "ANDROID") -> dict:
    """Return the version config from APP_VERSION, or {} if unavailable. Never raises."""
    conn = get_connection()
    cursor = conn.cursor()
    full_cols = "MIN_VERSION, LATEST_VERSION, MIN_BUILD, LATEST_BUILD, UPDATE_URL, FORCE_MESSAGE, SOFT_MESSAGE"
    attempts = [
        (f"SELECT {full_cols} FROM APP_VERSION WHERE UPPER(NVL(PLATFORM,'ANDROID')) = :p FETCH FIRST 1 ROWS ONLY",
         {"p": (platform or "ANDROID").upper()}),
        (f"SELECT {full_cols} FROM APP_VERSION FETCH FIRST 1 ROWS ONLY", {}),
    ]
    try:
        for sql, params in attempts:
            try:
                cursor.execute(sql, params)
                row = cursor.fetchone()
                if not row:
                    return {}
                return {
                    "min_version": row[0], "latest_version": row[1],
                    "min_build": _to_int(row[2]), "latest_build": _to_int(row[3]),
                    "update_url": row[4], "force_message": row[5], "soft_message": row[6],
                }
            except Exception as e:
                if "ORA-00904" in str(e):
                    continue
                raise
        try:
            cursor.execute("SELECT VERSION FROM APP_VERSION FETCH FIRST 1 ROWS ONLY")
            row = cursor.fetchone()
            if row and row[0]:
                return {"latest_version": str(row[0])}
        except Exception:
            pass
        return {}
    except Exception as e:
        print(f"[APP_VERSION] config read failed (no enforcement): {e}")
        return {}
    finally:
        cursor.close()
        conn.close()


def evaluate_app_version(version: str = None, build=None, platform: str = "ANDROID") -> dict:
    """Decide update status. A client that sends no version is always 'ok'."""
    result = {"status": "ok", "force": False, "latest_version": None,
              "update_url": None, "message": None}
    cfg = get_app_version_config(platform)
    if not cfg:
        return result
    result["latest_version"] = cfg.get("latest_version")
    result["update_url"] = cfg.get("update_url")
    if version is None and build is None:
        return result

    b = _to_int(build)
    min_build, latest_build = cfg.get("min_build"), cfg.get("latest_build")
    min_ver, latest_ver = cfg.get("min_version"), cfg.get("latest_version")

    def _below(target_build, target_ver):
        if b is not None and target_build is not None:
            return b < target_build
        if version and target_ver:
            return _cmp_ver(_parse_ver(version), _parse_ver(target_ver)) < 0
        return False

    if _below(min_build, min_ver):
        result["status"] = "force_update"
        result["force"] = True
        result["message"] = cfg.get("force_message") or \
            "A required update is available. Please update the app to continue."
    elif _below(latest_build, latest_ver):
        result["status"] = "soft_update"
        result["message"] = cfg.get("soft_message") or "A new version of the app is available."
    return result


def force_update_block(version: str = None, build=None, platform: str = "ANDROID"):
    """Guard for login/attendance. Returns (message, update_url) when this client
    MUST update, else None. Never raises; returns None when no version is sent."""
    try:
        res = evaluate_app_version(version, build, platform)
        if res.get("force"):
            return res.get("message"), res.get("update_url")
    except Exception as e:
        print(f"[APP_VERSION] force check skipped: {e}")
    return None
