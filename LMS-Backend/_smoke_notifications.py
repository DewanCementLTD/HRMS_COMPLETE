"""Smoke test for notification templates + the SEND-READY message outbox
(writes real rows, deletes them at the end).
Run: .venv/Scripts/python.exe _smoke_notifications.py
"""
import sys
sys.path.insert(0, ".")
import repositories.notification_repository as nr
import repositories.interview_panel_repository as ipr
from core.database import get_connection

FAIL = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}" + (f" -- {detail}" if not cond else ""))
    if not cond:
        FAIL.append(label)


APP_ID = 72                      # company 1, candidate #37 (has email + mobile)

# Pick two active company-1 employees that actually HAVE a mobile number so the
# contact-fill assertion tests real data (many rows have no email/mobile).
_conn = get_connection()
_cur = _conn.cursor()
_cur.execute("""
    SELECT EMPCODE FROM HR_EMP_MASTER
    WHERE STATUS = 'A' AND TO_NUMBER(UNIT_ID) = 1
      AND COALESCE("MOBILE#", NXT_MOBILE, "PHONE#") IS NOT NULL
    ORDER BY EMPCODE FETCH FIRST 2 ROWS ONLY
""")
_rows = [str(r[0]).strip() for r in _cur.fetchall()]
_cur.close(); _conn.close()
assert len(_rows) == 2, f"need 2 company-1 employees with mobiles, got {_rows}"
EMP_A, EMP_B = _rows

nr.ensure_notification_tables()

# 1. Seeds: 4 required Interview Scheduled combos + extras
tpl = nr.list_templates()
combos = {(t["notification_type"], t["recipient_type"], t["event_type"]) for t in tpl}
need = {("EMAIL", "INTERVIEWER", "Interview Scheduled"),
        ("EMAIL", "CANDIDATE", "Interview Scheduled"),
        ("WHATSAPP", "INTERVIEWER", "Interview Scheduled"),
        ("WHATSAPP", "CANDIDATE", "Interview Scheduled")}
check("seed: all 4 Interview Scheduled combos exist", need <= combos, str(combos))
check("seed: placeholders JSON parsed", all(isinstance(t["placeholders"], list) for t in tpl))

f = nr.list_templates("Interview Scheduled", "EMAIL", "CANDIDATE")
check("filter: event+type+recipient narrows to 1", len(f) == 1, str(len(f)))

by = {(t["notification_type"], t["recipient_type"]): t
      for t in nr.list_templates("Interview Scheduled")}
T_CAND_EMAIL = by[("EMAIL", "CANDIDATE")]["template_id"]
T_INT_EMAIL = by[("EMAIL", "INTERVIEWER")]["template_id"]
T_CAND_WA = by[("WHATSAPP", "CANDIDATE")]["template_id"]

# 2. Set up interview context: pool members + a scheduled interview so the
#    rendered messages carry real date/time/mode/location data.
ipr.add_panel_members(1, None, [EMP_A, EMP_B], added_by="smoke")
asg = ipr.create_interview_assignments(
    APP_ID, empcodes=[EMP_A, EMP_B], interview_type="Technical",
    interview_date="2026-07-20", start_time="10:00", end_time="11:30",
    remarks="Bring your laptop.", assigned_by="smoke",
    location_or_link="https://meet.example.com/xyz", interview_mode="Online")
check("setup: interview assignments created", asg.get("status") == "success", str(asg))

# 3. Save selections -> outbox: 1 candidate msg + 2 interviewer msgs (one per member)
r = nr.create_notification_selections(APP_ID, [
    {"template_id": T_CAND_EMAIL, "notification_type": "EMAIL", "recipient_type": "CANDIDATE"},
    {"template_id": T_INT_EMAIL, "notification_type": "EMAIL", "recipient_type": "INTERVIEWER",
     "empcodes": [EMP_A, EMP_B]},
], selected_by="smoke")
check("save: success", r["status"] == "success", str(r))
check("save: 3 message rows (1 candidate + 2 interviewers)", len(r.get("created", [])) == 3, str(r))

msgs = nr.list_notification_selections(APP_ID)
mine = [m for m in msgs if m["created_by"] == "smoke"]
cand = [m for m in mine if m["recipient_type"] == "CANDIDATE"]
ints = [m for m in mine if m["recipient_type"] == "INTERVIEWER"]

check("outbox: candidate row has their own email",
      len(cand) == 1 and cand[0]["email"] == "zohaibbabar22@gmail.com", str(cand))
check("outbox: candidate row has person_name",
      bool(cand) and cand[0]["person_name"] == "Muhammad Zohaib Farooqui",
      str(cand and cand[0]["person_name"]))
check("outbox: interviewer rows one per member with own empcode",
      {m["empcode"] for m in ints} == {EMP_A, EMP_B}, str([m["empcode"] for m in ints]))
check("outbox: interviewer rows carry each member's own contact",
      all(m["email"] or m["phone"] for m in ints),
      str([(m["empcode"], m["email"], m["phone"]) for m in ints]))

body = (cand[0]["message_body"] or "") if cand else ""
check("render: no unresolved {{placeholders}} left", "{{" not in body, body[:200])
check("render: interview date resolved", "20-JUL-2026" in body, body[:300])
check("render: time span + duration resolved",
      "10:00 - 11:30" in body and "1 hour 30 minutes" in body, body[:400])
check("render: mode + link resolved", "Online" in body and "meet.example.com" in body, body[:400])
check("render: subject rendered with job title",
      bool(cand) and "Software Engineer" in (cand[0]["subject"] or ""),
      str(cand and cand[0]["subject"]))
check("outbox: job_title + interview_mode columns filled",
      bool(cand) and cand[0]["job_title"] == "Software Engineer"
      and cand[0]["interview_mode"] == "Online",
      str(cand and (cand[0]["job_title"], cand[0]["interview_mode"])))
check("outbox: status PENDING", all(m["status"] == "PENDING" for m in mine))

ib = {m["empcode"]: (m["message_body"] or "") for m in ints}
names = {m["empcode"]: (m["person_name"] or "") for m in ints}
check("render: interviewer bodies fully resolved", all("{{" not in b for b in ib.values()),
      str({k: v[:60] for k, v in ib.items()}))
check("render: each interviewer greeted by own name",
      all(names[e].upper() in ib[e].upper() for e in ib),
      str({k: v[:80] for k, v in ib.items()}))
check("render: other panel members listed (not self)",
      names.get(EMP_B, "??").upper()
      in ib.get(EMP_A, "").upper().split("OTHER PANEL MEMBERS:")[-1][:120],
      ib.get(EMP_A, "")[:500])

# 4. New events: Interview Feedback + Offer Extended (candidate, both channels)
combos2 = {(t["notification_type"], t["recipient_type"], t["event_type"]) for t in nr.list_templates()}
check("seed: Interview Feedback templates exist",
      ("EMAIL", "CANDIDATE", "Interview Feedback") in combos2
      and ("WHATSAPP", "CANDIDATE", "Interview Feedback") in combos2, str(combos2))
check("seed: Offer Extended templates exist",
      ("EMAIL", "CANDIDATE", "Offer Extended") in combos2
      and ("WHATSAPP", "CANDIDATE", "Offer Extended") in combos2, str(combos2))

# Offer Extended renders the latest offer's salary + date into the message.
conn = get_connection()
cur = conn.cursor()
cur.execute("""
    INSERT INTO RECRUITMENT_OFFERS (OFFER_ID, APP_ID, OFFER_DATE, SALARY_OFFERED, STATUS, NOTES, CREATED_AT)
    VALUES (RECRUITMENT_OFFERS_SEQ.NEXTVAL, :id, SYSDATE, 150000, 'SENT', 'smoke', SYSDATE)
""", {"id": APP_ID})
conn.commit()
cur.close()
conn.close()

T_OFFER_EMAIL = next(t["template_id"] for t in nr.list_templates("Offer Extended", "EMAIL", "CANDIDATE"))
r = nr.create_notification_selections(APP_ID, [
    {"template_id": T_OFFER_EMAIL, "notification_type": "EMAIL", "recipient_type": "CANDIDATE"}],
    selected_by="smoke")
check("offer: selection saved", r["status"] == "success", str(r))
omsg = [m for m in nr.list_notification_selections(APP_ID)
        if m["created_by"] == "smoke" and m["event_type"] == "Offer Extended"]
obody = (omsg[0]["message_body"] or "") if omsg else ""
check("offer: salary rendered", "PKR 150,000" in obody, obody[:300])
import time as _t
check("offer: offer date rendered", _t.strftime("%d-%b-%Y").upper() in obody.upper(), obody[:300])
check("offer: no unresolved placeholders", "{{" not in obody, obody[:200])

# Interview Feedback template renders the round + candidate name.
T_FB_EMAIL = next(t["template_id"] for t in nr.list_templates("Interview Feedback", "EMAIL", "CANDIDATE"))
r = nr.create_notification_selections(APP_ID, [
    {"template_id": T_FB_EMAIL, "notification_type": "EMAIL", "recipient_type": "CANDIDATE"}],
    selected_by="smoke")
check("feedback: selection saved", r["status"] == "success", str(r))
fmsg = [m for m in nr.list_notification_selections(APP_ID)
        if m["created_by"] == "smoke" and m["event_type"] == "Interview Feedback"]
fbody = (fmsg[0]["message_body"] or "") if fmsg else ""
check("feedback: round + name rendered",
      "Technical" in fbody and "Muhammad Zohaib" in fbody and "{{" not in fbody, fbody[:300])

# 5. Validation
r = nr.create_notification_selections(APP_ID, [
    {"template_id": T_INT_EMAIL, "notification_type": "EMAIL", "recipient_type": "INTERVIEWER"}],
    selected_by="smoke")
check("400 when INTERVIEWER selection has no empcodes",
      r["status"] == "error" and r["code"] == 400, str(r))

r = nr.create_notification_selections(APP_ID, [
    {"template_id": T_CAND_WA, "notification_type": "EMAIL", "recipient_type": "CANDIDATE"}],
    selected_by="smoke")
check("400 when template type mismatches selection",
      r["status"] == "error" and r["code"] == 400, str(r))

r = nr.create_notification_selections(999999, [
    {"template_id": T_CAND_EMAIL, "notification_type": "EMAIL", "recipient_type": "CANDIDATE"}],
    selected_by="smoke")
check("404 on unknown application", r["status"] == "error" and r["code"] == 404, str(r))

check("list: template names joined", all(m["template_name"] for m in mine),
      str([m["template_name"] for m in mine]))

# 6. Cleanup — messages, offer, assignments + interview event, pool rows
conn = get_connection()
cur = conn.cursor()
cur.execute("DELETE FROM APP_NOTIFICATION_MESSAGES WHERE CREATED_BY = 'smoke'")
n_msg = cur.rowcount
cur.execute("DELETE FROM RECRUITMENT_OFFERS WHERE NOTES = 'smoke'")
n_off = cur.rowcount
cur.execute("""SELECT DISTINCT INTERVIEW_ID FROM INTERVIEW_ASSIGNMENTS
               WHERE ASSIGNED_BY = 'smoke' AND INTERVIEW_ID IS NOT NULL""")
iids = [r[0] for r in cur.fetchall()]
cur.execute("DELETE FROM INTERVIEW_ASSIGNMENTS WHERE ASSIGNED_BY = 'smoke'")
n_asg = cur.rowcount
n_iv = 0
for iid in iids:
    cur.execute("DELETE FROM RECRUITMENT_INTERVIEWS WHERE INTERVIEW_ID = :i", {"i": iid})
    n_iv += cur.rowcount
cur.execute("DELETE FROM INTERVIEW_PANEL_POOL WHERE ADDED_BY = 'smoke'")
n_pool = cur.rowcount
conn.commit()
cur.close()
conn.close()
print(f"\ncleanup: {n_msg} messages, {n_off} offers, {n_asg} assignments, {n_iv} interviews, {n_pool} pool rows removed")

print()
if FAIL:
    print(f"{len(FAIL)} FAILURES: {FAIL}")
    sys.exit(1)
print("All notification outbox smoke tests passed.")
