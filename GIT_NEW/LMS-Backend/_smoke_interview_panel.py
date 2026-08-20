"""Smoke test for the interview panel pool + assignments repo (writes real rows,
deletes them at the end). Run from LMS-Backend: .venv/Scripts/python.exe _smoke_interview_panel.py
"""
import sys
sys.path.insert(0, ".")
import repositories.interview_panel_repository as ipr
from core.database import get_connection

FAIL = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}" + (f" -- {detail}" if not cond else ""))
    if not cond:
        FAIL.append(label)


APP_ID = 72          # SHORTLISTED, job 104, COMPC 1, BRNCH NULL
EMP_A, EMP_B = "100505.1", "100511.1"   # active, company 1
C2_EMP = None        # found below

# 1. Add to company 1 pool via "All Branches" (company 1 has 1 branch)
r = ipr.add_panel_members(1, None, [EMP_A, EMP_B, "NOPE-1"], added_by="smoke")
check("add: 2 inserted, bogus rejected",
      r["status"] == "success" and r["inserted"] == 2 and r["rejected"] == ["NOPE-1"], str(r))

# duplicate add -> reactivated not duplicated
r = ipr.add_panel_members(1, 1, [EMP_A], added_by="smoke")
check("re-add: reactivate not insert", r["status"] == "success" and r["inserted"] == 0
      and r["reactivated"] == 1, str(r))

pool = ipr.list_panel_pool(1)
mine = [i for i in pool["items"] if i["added_by"] == "smoke"]
check("list: 2 active members, names joined",
      len(mine) == 2 and all(i["name"] for i in mine), str(mine))
check("list: company_branches present", len(pool["company_branches"]) == 1, str(pool["company_branches"]))

# 2. Company-2 fan-out: one employee -> 7 branch rows
conn = get_connection(); cur = conn.cursor()
cur.execute("SELECT EMPCODE FROM HR_EMP_MASTER WHERE STATUS='A' AND TO_NUMBER(UNIT_ID)=2 FETCH FIRST 1 ROWS ONLY")
row = cur.fetchone()
cur.close(); conn.close()
if row:
    C2_EMP = str(row[0]).strip()
    r = ipr.add_panel_members(2, None, [C2_EMP], added_by="smoke")
    check("fan-out: one row per branch of company 2",
          r["status"] == "success" and r["inserted"] == len(r["branches"]) and len(r["branches"]) == 7, str(r))
    # scoped list: branch 3 view shows only that branch's row
    p3 = ipr.list_panel_pool(2, 3)
    check("scope: branch view only shows that branch",
          all(i["brnch"] == 3 for i in p3["items"] if i["added_by"] == "smoke"), str(p3["items"]))
    # company 1 never sees company 2's pool
    check("scope: company 1 pool has no company-2 emp",
          all(i["empcode"] != C2_EMP for i in ipr.list_panel_pool(1)["items"]))
    # all-branches removal deactivates everywhere
    r = ipr.deactivate_panel_member(2, None, C2_EMP)
    check("all-branches removal deactivates all 7", r.get("deactivated") == 7, str(r))
    p2 = ipr.list_panel_pool(2, include_inactive=True)
    check("soft removal: rows kept with IS_ACTIVE=N",
          sum(1 for i in p2["items"] if i["empcode"] == C2_EMP and i["is_active"] == "N") == 7)
else:
    print("[SKIP] no active company-2 employee for fan-out test")

# 3. Panel options for application (company 1, job BRNCH NULL)
opts = ipr.panel_options_for_app(APP_ID)
codes = {o["empcode"] for o in opts["items"]}
check("options: pool members offered for app", {EMP_A, EMP_B} <= codes, str(opts))
check("options: no duplicates", len(codes) == len(opts["items"]))

# 4. Assignments: validation
r = ipr.create_interview_assignments(APP_ID, [EMP_A], "", "2026-07-15", "10:00")
check("400 when interview_type blank", r["status"] == "error" and r.get("code") == 400, str(r))
r = ipr.create_interview_assignments(APP_ID, ["NOPE-1"], "Technical", "2026-07-15", "10:00")
check("400 when interviewer not in pool", r["status"] == "error" and r.get("code") == 400, str(r))
r = ipr.create_interview_assignments(APP_ID, [EMP_A], "Technical", "2026-07-15", "25:99")
check("400 on bad time", r["status"] == "error" and r.get("code") == 400, str(r))

# valid save: two interviewers, one event
r1 = ipr.create_interview_assignments(APP_ID, [EMP_A, EMP_B], "Technical",
                                      "2026-07-15", "10:00", None, "smoke test", "smoke")
check("save: 2 assignment rows + interview event",
      r1["status"] == "success" and len(r1["assignment_ids"]) == 2 and r1["interview_id"], str(r1))

# clash: EMP_A already busy 10:00-11:00 -> overlapping 10:30 rejected
r2 = ipr.create_interview_assignments(APP_ID, [EMP_A], "HR", "2026-07-15", "10:30", "11:30")
check("409 on date+time clash", r2["status"] == "error" and r2.get("code") == 409, str(r2))
# same interviewer, non-overlapping slot -> allowed ("same interviewer multiple interviews")
r3 = ipr.create_interview_assignments(APP_ID, [EMP_A], "HR", "2026-07-15", "11:00", "12:00",
                                      None, "smoke")
check("same interviewer, later slot OK", r3["status"] == "success", str(r3))

rows = ipr.list_interview_assignments(APP_ID)
check("list assignments: rows with joined names",
      len([x for x in rows if x["assigned_by"] == "smoke" or x["remarks"] == "smoke test"]) >= 2
      and all(x["name"] for x in rows[:3]), str(rows[:2]))

# 5. Single-row deactivate (spec DELETE /panel-pool/:id)
pid = mine[0]["panel_pool_id"]
r = ipr.deactivate_panel_row(pid)
check("single row soft delete", r["status"] == "success")
check("deactivated row hidden from active list",
      all(i["panel_pool_id"] != pid for i in ipr.list_panel_pool(1)["items"]))

# 6. Interview types add/remove per company
r = ipr.add_interview_type("Panel Discussion", 1)
tid = r.get("type_id")
check("add company type", r["status"] == "success", str(r))
r = ipr.add_interview_type("panel discussion", 1)
check("duplicate type rejected", r["status"] == "error", str(r))
check("company list includes new + global types",
      {"Panel Discussion", "HR", "Technical"} <= {t["descr"] for t in ipr.list_interview_types(1)})
check("other company does not see it",
      "Panel Discussion" not in {t["descr"] for t in ipr.list_interview_types(2)})
r = ipr.remove_interview_type(tid, 1)
check("remove company type", r["status"] == "success", str(r))
glob_id = next(t["type_id"] for t in ipr.list_interview_types(1) if t["compc"] is None)
r = ipr.remove_interview_type(glob_id, 1)
check("global seed type protected", r["status"] == "error", str(r))

# ---- cleanup: delete everything this test created ----
conn = get_connection(); cur = conn.cursor()
cur.execute("DELETE FROM INTERVIEW_ASSIGNMENTS WHERE APP_ID = :a AND ASSIGNED_BY IN ('smoke','')", {"a": APP_ID})
n1 = cur.rowcount
cur.execute("""DELETE FROM RECRUITMENT_INTERVIEWS WHERE INTERVIEW_ID IN (:i1, :i2)""",
            {"i1": r1.get("interview_id") or -1, "i2": r3.get("interview_id") or -1})
n2 = cur.rowcount
cur.execute("DELETE FROM INTERVIEW_PANEL_POOL WHERE ADDED_BY = 'smoke'")
n3 = cur.rowcount
cur.execute("DELETE FROM INTERVIEW_TYPES WHERE DESCR = 'Panel Discussion'")
n4 = cur.rowcount
conn.commit(); cur.close(); conn.close()
print(f"\ncleanup: {n1} assignments, {n2} interviews, {n3} pool rows, {n4} types removed")

print()
if FAIL:
    print(f"{len(FAIL)} FAILURE(S): {FAIL}")
    sys.exit(1)
print("All interview panel smoke tests passed.")
