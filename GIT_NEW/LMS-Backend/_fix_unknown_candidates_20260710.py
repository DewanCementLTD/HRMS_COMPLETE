"""
One-off repair: pool CVs stored as "Unknown" candidates (2026-07-10).

The metrics-only LLM template double-nested the extracted profile as
{"metrics": {"metrics": {...}}}, so RECRUITMENT_CANDIDATES rows were written
with CANDIDATE_NAME='Unknown' and no email/mobile/children. The archived eval
JSON next to each CV still holds the full (nested) profile, so every such row
is recoverable from disk.

For each candidate named 'Unknown':
  1. Find its eval JSON in the CV archive folder (via CV_FILE_PATH/CV_FILE_NAME).
  2. Unwrap the double-nested metrics and read the real profile.
  3. UPDATE the row in place and rebuild education/experience/skills. If
     another candidate in the same company already has that email/mobile, the
     name/profile are still fixed but EMAIL/MOBILE are left blank (so the
     dedupe key stays unique) and the row is flagged for manual merge/delete.

Dry-run by default (prints what it WOULD do).  Apply with:
    python _fix_unknown_candidates_20260710.py --apply
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from repositories.recruitment_repository import (  # noqa: E402
    get_connection, find_duplicate_candidate, _insert_candidate_children,
)

APPLY = "--apply" in sys.argv


def load_eval_record(cv_file_path, cv_file_name):
    """Locate the eval JSON for an archived CV. The JSON is named after the
    ORIGINAL pdf stem while the archived pdf may have been uniquified, so fall
    back to scanning the folder for a record whose cv_file matches."""
    if not cv_file_path:
        return None, "no CV_FILE_PATH on the row"
    folder = Path(cv_file_path).parent
    if not folder.is_dir():
        return None, f"archive folder missing: {folder}"

    exact = Path(cv_file_path).with_suffix(".json")
    candidates = [exact] if exact.is_file() else []
    candidates += [p for p in folder.glob("*.json")
                   if p != exact and not p.name.startswith("_")]
    for path in candidates:
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if record.get("cv_file") == cv_file_name or path == exact:
            return record, str(path)
    return None, f"no eval JSON for {cv_file_name!r} in {folder}"


def unwrap_metrics(record: dict) -> dict:
    """Return the bare metrics object, tolerating the historical double nesting."""
    metrics = record.get("metrics") or {}
    if "contact_info" not in metrics and isinstance(metrics.get("metrics"), dict):
        metrics = metrics["metrics"]
    return metrics if isinstance(metrics, dict) else {}


def main():
    conn = get_connection()
    cursor = conn.cursor()
    fixed = skipped = 0
    try:
        cursor.execute("""
            SELECT CANDIDATE_ID, EMAIL, MOBILE, COMPC, BRNCH,
                   CV_FILE_NAME, CV_FILE_PATH
            FROM RECRUITMENT_CANDIDATES
            WHERE CANDIDATE_NAME = 'Unknown'
            ORDER BY CANDIDATE_ID
        """)
        rows = cursor.fetchall()
        print(f"{'APPLY' if APPLY else 'DRY-RUN'}: {len(rows)} 'Unknown' candidate(s) found\n")

        for cid, email0, mobile0, compc, brnch, cv_name, cv_path in rows:
            record, where = load_eval_record(cv_path, cv_name)
            if record is None:
                print(f"  #{cid}: SKIP -- {where}")
                skipped += 1
                continue

            metrics = unwrap_metrics(record)
            contact = metrics.get("contact_info") or {}
            name = (contact.get("name") or "").strip()[:200]
            if not name or name.lower() == "unknown":
                print(f"  #{cid}: SKIP -- eval JSON has no usable name ({where})")
                skipped += 1
                continue

            email = (contact.get("email") or "").strip()[:200] or None
            mobile = (contact.get("phone") or "").strip()[:30] or None
            # If another candidate already owns this email or mobile (a later
            # re-upload of the same person worked, or a template placeholder
            # email), fix the name/profile but blank only the COLLIDING key so
            # dedupe on future uploads still points at the real row.
            dup_notes = []
            dup = email and find_duplicate_candidate(
                cursor, email=email, exclude_id=int(cid), compc=compc)
            if dup:
                dup_notes.append(f"email taken by candidate #{int(dup[0])}")
                email = None
            dup = mobile and find_duplicate_candidate(
                cursor, mobile=mobile, exclude_id=int(cid), compc=compc)
            if dup:
                dup_notes.append(f"mobile taken by candidate #{int(dup[0])}")
                mobile = None
            dup_note = (f"  [{'; '.join(dup_notes)} -- left blank; "
                        f"merge/delete manually]" if dup_notes else "")

            location = (contact.get("location") or "").strip()[:200] or None
            pref = (metrics.get("preferred_job_title") or "").strip()[:200] or None
            summary = metrics.get("profile_summary")
            children = {
                "education": metrics.get("education") or [],
                "experience": metrics.get("experience") or [],
                "skills": metrics.get("skills") or [],
            }
            print(f"  #{cid}: FIX -> {name!r} (email={email}, mobile={mobile}, "
                  f"edu={len(children['education'])}, exp={len(children['experience'])}, "
                  f"skills={len(children['skills'])})  [{where}]{dup_note}")

            if APPLY:
                cursor.execute("""
                    UPDATE RECRUITMENT_CANDIDATES SET
                        CANDIDATE_NAME = :name,
                        EMAIL = NVL(:email, EMAIL),
                        MOBILE = NVL(:mobile, MOBILE),
                        LOCATION = NVL(:loc, LOCATION),
                        PREFERRED_JOB_TITLE = NVL(:pref, PREFERRED_JOB_TITLE),
                        PROFILE_SUMMARY = NVL(:summary, PROFILE_SUMMARY),
                        UPDATED_AT = SYSDATE
                    WHERE CANDIDATE_ID = :cid
                """, {"name": name, "email": email, "mobile": mobile,
                      "loc": location, "pref": pref, "summary": summary, "cid": cid})
                for table in ("RECRUITMENT_CANDIDATE_EDUCATION",
                              "RECRUITMENT_CANDIDATE_EXPERIENCE",
                              "RECRUITMENT_CANDIDATE_SKILLS"):
                    cursor.execute(
                        f"DELETE FROM {table} WHERE CANDIDATE_ID = :cid", {"cid": cid})
                _insert_candidate_children(cursor, cid, children)
            fixed += 1

        if APPLY:
            conn.commit()
            print(f"\nCommitted: {fixed} fixed, {skipped} skipped.")
        else:
            conn.rollback()
            print(f"\nDry-run only: {fixed} fixable, {skipped} skipped. "
                  f"Re-run with --apply to write.")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    main()
