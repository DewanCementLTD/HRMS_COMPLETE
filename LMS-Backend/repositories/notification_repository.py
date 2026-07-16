"""Notification templates + per-application SEND-READY messages (outbox).

NOTIFICATION_TEMPLATES — reusable message templates for recruitment events
(EMAIL/WHATSAPP x INTERVIEWER/CANDIDATE x event). Bodies are stored RAW with
{{placeholder}} markers intact. Email subjects live in their own SUBJECT
column so bodies stay pure message text.

APP_NOTIFICATION_MESSAGES — the outbox. ONE ROW PER ACTUAL MESSAGE, fully
rendered and ready to send: the recipient's own email/phone (the panel
member's for INTERVIEWER rows, the candidate's for CANDIDATE rows), the
resolved subject + body (placeholders substituted with the real candidate /
job / interview data at save time), plus job title, person name, channel and
interview mode. A future sender just reads PENDING rows and dispatches them —
no template resolution needed at send time. An INTERVIEWER selection with 3
panel members produces 3 rows.

(The earlier APPLICATION_NOTIFICATION_SELECTIONS / _INTERVIEWERS tables and
their contact-fill triggers are superseded by this outbox; existing rows are
left untouched but the app no longer writes them.)
"""

import json
import re

from core.database import get_connection

# ------------------------------------------------------------------
# DDL
# ------------------------------------------------------------------

_ready = False

_DDL = (
    ("NOTIFICATION_TEMPLATES", """
        CREATE TABLE NOTIFICATION_TEMPLATES (
            TEMPLATE_ID       NUMBER PRIMARY KEY,
            TEMPLATE_NAME     VARCHAR2(100) NOT NULL,
            NOTIFICATION_TYPE VARCHAR2(10) NOT NULL,
            RECIPIENT_TYPE    VARCHAR2(15) NOT NULL,
            EVENT_TYPE        VARCHAR2(50) NOT NULL,
            SUBJECT           VARCHAR2(200),
            MESSAGE_BODY      CLOB NOT NULL,
            PLACEHOLDERS      CLOB,
            IS_ACTIVE         VARCHAR2(1) DEFAULT 'Y' NOT NULL,
            CREATED_BY        VARCHAR2(20) NOT NULL,
            CREATED_ON        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
            UPDATED_ON        TIMESTAMP
        )"""),
    ("APP_NOTIFICATION_MESSAGES", """
        CREATE TABLE APP_NOTIFICATION_MESSAGES (
            MESSAGE_ID        NUMBER PRIMARY KEY,
            APP_ID            NUMBER NOT NULL,
            TEMPLATE_ID       NUMBER,
            EVENT_TYPE        VARCHAR2(50),
            NOTIFICATION_TYPE VARCHAR2(10) NOT NULL,
            RECIPIENT_TYPE    VARCHAR2(15) NOT NULL,
            EMPCODE           VARCHAR2(20),
            PERSON_NAME       VARCHAR2(200),
            EMAIL             VARCHAR2(150),
            PHONE             VARCHAR2(50),
            SUBJECT           VARCHAR2(300),
            MESSAGE_BODY      CLOB,
            JOB_TITLE         VARCHAR2(200),
            INTERVIEW_MODE    VARCHAR2(30),
            STATUS            VARCHAR2(15) DEFAULT 'PENDING' NOT NULL,
            CREATED_BY        VARCHAR2(20) NOT NULL,
            CREATED_ON        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
        )"""),
)

_SEQS = ("NOTIFICATION_TEMPLATES_SEQ", "APP_NOTIF_MESSAGES_SEQ")

# ------------------------------------------------------------------
# Seed templates — bodies verbatim from the module spec, stored raw.
# (name, notification_type, recipient_type, event_type, subject, body)
# ------------------------------------------------------------------

_SEED_TEMPLATES = (
    ("Interview Confirmed — Email to Candidate", "EMAIL", "CANDIDATE", "Interview Scheduled",
     "Interview Confirmed — {{job_title}} at {{company_name}}",
     """Dear {{candidate_name}},

Thank you for your interest in the {{job_title}} position at {{company_name}}. We're pleased to invite you for an interview.

Date: {{interview_date}}
Time: {{interview_time}}
Duration: {{duration}}
Mode: {{interview_mode}}
Location / Link: {{location_or_link}}

Please bring a copy of your CV and a valid ID card. If you need to reschedule, reply to this email or contact us at {{hr_contact}}.

We look forward to speaking with you.

Best regards,
{{recruiter_name}}
{{company_name}} — HR Team"""),

    ("Interview Panel Assignment — Email to Interviewer", "EMAIL", "INTERVIEWER", "Interview Scheduled",
     "Interview Panel Assignment — {{candidate_name}} for {{job_title}}",
     """Hi {{panel_member_name}},

You've been assigned as {{panel_role}} for the following interview:

Candidate: {{candidate_name}}
Role: {{job_title}}
Round: {{interview_round}}
Date: {{interview_date}}
Time: {{interview_time}}
Duration: {{duration}}
Mode: {{interview_mode}}
Location / Link: {{location_or_link}}

Other panel members: {{other_panel_members}}

{{instructions_note}}

A calendar invite has been attached. Please submit your feedback in the recruitment app within 24 hours of the interview.

Best regards,
{{company_name}} — HR Team"""),

    ("Interview Confirmed — WhatsApp to Candidate", "WHATSAPP", "CANDIDATE", "Interview Scheduled",
     None,
     """Hi {{candidate_name}}, your interview for {{job_title}} at {{company_name}} is confirmed.

📅 {{interview_date}}, {{interview_time}}
📍 {{location_or_link}}
🕐 Duration: {{duration}}

Please bring a copy of your CV and a valid ID. Reply here if you need to reschedule."""),

    ("Panel Assignment — WhatsApp to Interviewer", "WHATSAPP", "INTERVIEWER", "Interview Scheduled",
     None,
     """Hi {{panel_member_name}}, you've been added as {{panel_role}} for an interview.

👤 Candidate: {{candidate_name}}
💼 Role: {{job_title}}
📅 {{interview_date}}, {{interview_time}}
📍 {{location_or_link}}

{{instructions_note}}

Panel: {{other_panel_members}}"""),

    ("Application Rejected — Email to Candidate", "EMAIL", "CANDIDATE", "Rejected",
     "Update on your application — {{job_title}}",
     """Dear {{candidate_name}},

Thank you for applying for the {{job_title}} position at {{company_name}} and for the time you invested in the process.

After careful consideration, we've decided to move forward with other candidates whose experience more closely matches our current requirements. This decision does not reflect on your qualifications, and we encourage you to apply for future openings that match your profile.

We wish you the very best in your job search.

Best regards,
{{recruiter_name}}
{{company_name}} — HR Team"""),

    ("Application Rejected — WhatsApp to Candidate", "WHATSAPP", "CANDIDATE", "Rejected",
     None,
     """Hi {{candidate_name}}, thank you for applying for {{job_title}} at {{company_name}}.

After careful review, we've decided to move forward with other candidates for this role. We appreciate the time you took to apply and wish you the best in your search."""),

    ("Application Shortlisted — Email to Candidate", "EMAIL", "CANDIDATE", "Shortlisted",
     "You've been shortlisted — {{job_title}} at {{company_name}}",
     """Dear {{candidate_name}},

Good news — your application for the {{job_title}} position at {{company_name}} has been shortlisted.

Our HR team will contact you shortly to schedule the next step. If you have any questions in the meantime, contact us at {{hr_contact}}.

Best regards,
{{recruiter_name}}
{{company_name}} — HR Team"""),

    ("Application Shortlisted — WhatsApp to Candidate", "WHATSAPP", "CANDIDATE", "Shortlisted",
     None,
     """Hi {{candidate_name}}, good news! Your application for {{job_title}} at {{company_name}} has been shortlisted. 🎉

Our HR team will reach out soon to schedule your interview."""),

    ("Interview Feedback Recorded — Email to Candidate", "EMAIL", "CANDIDATE", "Interview Feedback",
     "Thank you for interviewing — {{job_title}} at {{company_name}}",
     """Dear {{candidate_name}},

Thank you for taking the time to interview for the {{job_title}} position at {{company_name}}.

Your {{interview_round}} interview has been evaluated by our panel and your application is moving through our review process. Our HR team will contact you shortly with the outcome and the next steps.

If you have any questions in the meantime, contact us at {{hr_contact}}.

Best regards,
{{recruiter_name}}
{{company_name}} — HR Team"""),

    ("Interview Feedback Recorded — WhatsApp to Candidate", "WHATSAPP", "CANDIDATE", "Interview Feedback",
     None,
     """Hi {{candidate_name}}, thank you for interviewing for {{job_title}} at {{company_name}}.

Your interview has been evaluated by our panel — our HR team will contact you soon with the outcome and next steps."""),

    ("Offer Extended — Email to Candidate", "EMAIL", "CANDIDATE", "Offer Extended",
     "Job Offer — {{job_title}} at {{company_name}}",
     """Dear {{candidate_name}},

Congratulations! We are delighted to offer you the position of {{job_title}} at {{company_name}}.

Offered salary: {{salary_offered}}
Offer date: {{offer_date}}

The formal offer letter with complete terms and benefits will follow. Please review it and share your decision with us; if you have any questions, contact us at {{hr_contact}}.

We look forward to welcoming you to the team.

Best regards,
{{recruiter_name}}
{{company_name}} — HR Team"""),

    ("Offer Extended — WhatsApp to Candidate", "WHATSAPP", "CANDIDATE", "Offer Extended",
     None,
     """Hi {{candidate_name}}, congratulations! 🎉

We're pleased to offer you the {{job_title}} position at {{company_name}}.

💰 Offered salary: {{salary_offered}}
📅 Offer date: {{offer_date}}

The formal offer letter will follow — reply here or contact HR if you have any questions."""),
)

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def _placeholders_of(*texts) -> list:
    """Distinct {{placeholder}} names used across the given texts, in order."""
    seen, out = set(), []
    for t in texts:
        for name in _PLACEHOLDER_RE.findall(t or ""):
            if name not in seen:
                seen.add(name)
                out.append(name)
    return out


def ensure_notification_tables():
    """Create the templates + outbox tables and sequences; seed the template
    library once. Idempotent; degrades gracefully without DDL rights."""
    global _ready
    if _ready:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        for name, ddl in _DDL:
            try:
                cursor.execute(ddl)
                print(f"[NOTIFY] Created table {name}")
            except Exception as e:
                if "ORA-00955" not in str(e):
                    print(f"[NOTIFY] Could not create {name}: {str(e).splitlines()[0]}")
        for seq in _SEQS:
            try:
                cursor.execute(f"CREATE SEQUENCE {seq} START WITH 1 NOCACHE")
                print(f"[NOTIFY] Created sequence {seq}")
            except Exception as e:
                if "ORA-00955" not in str(e):
                    print(f"[NOTIFY] Could not create {seq}: {str(e).splitlines()[0]}")

        try:
            # Top-up seeding: insert any seed template whose NAME is missing, so
            # new events (e.g. Interview Feedback / Offer Extended) reach
            # existing installs. HR-edited copies keep their own names → untouched.
            cursor.execute("SELECT TEMPLATE_NAME FROM NOTIFICATION_TEMPLATES")
            existing = {str(r[0]).strip() for r in cursor.fetchall()}
            added = 0
            for name, ntype, rtype, event, subject, body in _SEED_TEMPLATES:
                if name in existing:
                    continue
                cursor.execute("""
                    INSERT INTO NOTIFICATION_TEMPLATES (
                        TEMPLATE_ID, TEMPLATE_NAME, NOTIFICATION_TYPE, RECIPIENT_TYPE,
                        EVENT_TYPE, SUBJECT, MESSAGE_BODY, PLACEHOLDERS,
                        IS_ACTIVE, CREATED_BY, CREATED_ON
                    ) VALUES (
                        NOTIFICATION_TEMPLATES_SEQ.NEXTVAL, :nm, :nt, :rt,
                        :ev, :subj, :body, :ph, 'Y', 'SYSTEM', SYSTIMESTAMP
                    )
                """, {"nm": name, "nt": ntype, "rt": rtype, "ev": event,
                      "subj": subject, "body": body,
                      "ph": json.dumps(_placeholders_of(subject, body))})
                added += 1
            if added:
                conn.commit()
                print(f"[NOTIFY] Seeded {added} notification templates")
        except Exception as e:
            print(f"[NOTIFY] Could not seed templates: {str(e).splitlines()[0]}")
        _ready = True
    finally:
        cursor.close()
        conn.close()


def _lob(v):
    return v.read() if hasattr(v, "read") else v


# ------------------------------------------------------------------
# Templates
# ------------------------------------------------------------------

def list_templates(event_type: str = None, notification_type: str = None,
                   recipient_type: str = None, include_inactive: bool = False) -> list:
    """Templates matching the filters, raw bodies + parsed placeholder list."""
    ensure_notification_tables()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        conds, params = [], {}
        if not include_inactive:
            conds.append("IS_ACTIVE = 'Y'")
        for col, val, key in (("EVENT_TYPE", event_type, "ev"),
                              ("NOTIFICATION_TYPE", notification_type, "nt"),
                              ("RECIPIENT_TYPE", recipient_type, "rt")):
            if val:
                conds.append(f"UPPER({col}) = UPPER(:{key})")
                params[key] = str(val).strip()
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cursor.execute(f"""
            SELECT TEMPLATE_ID, TEMPLATE_NAME, NOTIFICATION_TYPE, RECIPIENT_TYPE,
                   EVENT_TYPE, SUBJECT, MESSAGE_BODY, PLACEHOLDERS, IS_ACTIVE,
                   CREATED_BY, TO_CHAR(CREATED_ON, 'YYYY-MM-DD') AS CREATED_ON
            FROM NOTIFICATION_TEMPLATES {where}
            ORDER BY NOTIFICATION_TYPE, RECIPIENT_TYPE, TEMPLATE_ID
        """, params)
        cols = [d[0].lower() for d in cursor.description]
        items = []
        for r in cursor.fetchall():
            d = dict(zip(cols, r))
            d["message_body"] = _lob(d.get("message_body"))
            try:
                d["placeholders"] = json.loads(_lob(d.get("placeholders")) or "[]")
            except Exception:
                d["placeholders"] = []
            items.append(d)
        return items
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# Rendering — resolve {{placeholders}} with the real data AT SAVE TIME so
# every outbox row is a complete, send-ready message.
# ------------------------------------------------------------------

def _render(text: str, ctx: dict) -> str:
    """Substitute {{placeholders}} from ctx; unknown/empty ones vanish and
    the resulting extra blank lines are collapsed so the message stays clean."""
    if not text:
        return text
    out = _PLACEHOLDER_RE.sub(lambda m: str(ctx.get(m.group(1)) or ""), text)
    out = re.sub(r"[ \t]+\n", "\n", out)      # trailing spaces left by empty subs
    out = re.sub(r"\n{3,}", "\n\n", out)      # collapse blank-line runs
    return out.strip()


def _fmt_duration(start: str, end: str) -> str:
    """'14:00','15:30' -> '1 hour 30 minutes'."""
    try:
        sh, sm = map(int, str(start).strip()[:5].split(":"))
        eh, em = map(int, str(end).strip()[:5].split(":"))
        mins = (eh * 60 + em) - (sh * 60 + sm)
        if mins <= 0:
            return ""
        h, m = divmod(mins, 60)
        parts = []
        if h:
            parts.append(f"{h} hour" + ("s" if h > 1 else ""))
        if m:
            parts.append(f"{m} minutes")
        return " ".join(parts)
    except Exception:
        return ""


def _message_context(cursor, app_id: int, selected_by: str) -> dict:
    """Everything the templates can reference, looked up once per save:
    candidate + contacts, job + company, the LATEST interview event (date /
    time / duration / mode / location) and the recruiter (selected_by)."""
    ctx = {"app_id": app_id}

    # Candidate + job + company (candidate profile wins over legacy app columns).
    cursor.execute("""
        SELECT NVL(c.CANDIDATE_NAME, a.CANDIDATE_NAME),
               COALESCE(c.EMAIL, a.EMAIL),
               COALESCE(c.MOBILE, a.MOBILE),
               j.JOB_TITLE,
               j.COMPC
        FROM RECRUITMENT_APPLICATIONS a
        LEFT JOIN RECRUITMENT_CANDIDATES c ON c.CANDIDATE_ID = a.CANDIDATE_ID
        JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
        WHERE a.APP_ID = :id
    """, {"id": app_id})
    row = cursor.fetchone()
    if not row:
        return {}
    ctx["candidate_name"] = (row[0] or "").strip()
    ctx["candidate_email"] = (row[1] or "").strip() or None
    ctx["candidate_phone"] = (row[2] or "").strip() or None
    ctx["job_title"] = (row[3] or "").strip()
    compc = row[4]

    ctx["company_name"] = ""
    if compc is not None:
        try:
            cursor.execute("SELECT UNIT_NAME FROM UNIT_MST WHERE UNIT_ID = :u", {"u": int(compc)})
            r = cursor.fetchone()
            ctx["company_name"] = (r[0] or "").strip() if r else ""
        except Exception:
            pass

    # Latest interview event for this application (venue lives on the event).
    ctx.update({"interview_date": "", "interview_time": "", "duration": "",
                "interview_mode": "", "location_or_link": "", "interview_round": "",
                "instructions_note": ""})
    interview_id = None
    try:
        cursor.execute("""
            SELECT INTERVIEW_ID, TO_CHAR(INTERVIEW_DATE, 'DD-MON-YYYY'),
                   INTERVIEW_TYPE, INTERVIEW_MODE, LOCATION_OR_LINK
            FROM RECRUITMENT_INTERVIEWS
            WHERE APP_ID = :id
            ORDER BY INTERVIEW_ID DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"id": app_id})
        r = cursor.fetchone()
        if r:
            interview_id = r[0]
            ctx["interview_date"] = (r[1] or "").strip()
            ctx["interview_round"] = (r[2] or "").strip()
            ctx["interview_mode"] = (r[3] or "").strip()
            ctx["location_or_link"] = (r[4] or "").strip()
    except Exception:
        pass

    # Times/remarks come from the per-interviewer assignment rows of that event.
    try:
        cursor.execute("""
            SELECT START_TIME, END_TIME, REMARKS, INTERVIEW_TYPE
            FROM INTERVIEW_ASSIGNMENTS
            WHERE APP_ID = :id AND (:iid IS NULL OR INTERVIEW_ID = :iid)
            ORDER BY ASSIGNMENT_ID DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"id": app_id, "iid": interview_id})
        r = cursor.fetchone()
        if r:
            start, end = (r[0] or "").strip(), (r[1] or "").strip()
            if start:
                ctx["interview_time"] = f"{start} - {end}" if end else start
                ctx["duration"] = _fmt_duration(start, end)
            ctx["instructions_note"] = (r[2] or "").strip()
            ctx["interview_round"] = ctx["interview_round"] or (r[3] or "").strip()
    except Exception:
        pass

    # Latest offer for this application ({{salary_offered}} / {{offer_date}}).
    ctx["salary_offered"] = ""
    ctx["offer_date"] = ""
    try:
        cursor.execute("""
            SELECT SALARY_OFFERED, TO_CHAR(OFFER_DATE, 'DD-MON-YYYY')
            FROM RECRUITMENT_OFFERS
            WHERE APP_ID = :id
            ORDER BY OFFER_ID DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"id": app_id})
        r = cursor.fetchone()
        if r:
            if r[0] is not None:
                ctx["salary_offered"] = f"PKR {float(r[0]):,.0f}"
            ctx["offer_date"] = (r[1] or "").strip()
    except Exception:
        pass

    # Recruiter = the admin saving the selection (card_no or empcode).
    ctx["recruiter_name"] = ""
    ctx["hr_contact"] = ""
    try:
        cursor.execute("""
            SELECT h.NAME, h.EMAIL, h."MOBILE#"
            FROM HR_EMP_MASTER h
            LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            WHERE h.EMPCODE = :sb OR TO_CHAR(e.CARD_NO) = :sb
            FETCH FIRST 1 ROWS ONLY
        """, {"sb": str(selected_by or "").strip()})
        r = cursor.fetchone()
        if r:
            ctx["recruiter_name"] = (r[0] or "").strip()
            ctx["hr_contact"] = (r[1] or r[2] or "").strip()
    except Exception:
        pass

    return ctx


# ------------------------------------------------------------------
# Outbox — one fully-rendered message per recipient
# ------------------------------------------------------------------

def create_notification_selections(app_id: int, selections: list, selected_by: str) -> dict:
    """Persist the dialog's choices as SEND-READY messages: for each checked
    notification, render the template with the real candidate / job / interview
    data and insert ONE ROW PER RECIPIENT into APP_NOTIFICATION_MESSAGES —
    the candidate's own email/phone on CANDIDATE rows, each panel member's on
    INTERVIEWER rows. Validates the application, that each template is active
    and matches the row's notification/recipient type, and that INTERVIEWER
    rows carry at least one empcode. All-or-nothing (single transaction)."""
    ensure_notification_tables()
    if not selections:
        return {"status": "error", "code": 400, "message": "No notifications selected"}
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM RECRUITMENT_APPLICATIONS WHERE APP_ID = :id",
                       {"id": app_id})
        if int(cursor.fetchone()[0]) == 0:
            return {"status": "error", "code": 404, "message": "Application not found"}

        base_ctx = _message_context(cursor, app_id, selected_by)
        created_by = (str(selected_by or "").strip() or "SYSTEM")[:20]

        def _insert_message(template_id, event_type, ntype, rtype, empcode,
                            person_name, email, phone, subject, body):
            out = cursor.var(int)
            cursor.execute("""
                INSERT INTO APP_NOTIFICATION_MESSAGES (
                    MESSAGE_ID, APP_ID, TEMPLATE_ID, EVENT_TYPE,
                    NOTIFICATION_TYPE, RECIPIENT_TYPE, EMPCODE, PERSON_NAME,
                    EMAIL, PHONE, SUBJECT, MESSAGE_BODY, JOB_TITLE,
                    INTERVIEW_MODE, STATUS, CREATED_BY, CREATED_ON
                ) VALUES (
                    APP_NOTIF_MESSAGES_SEQ.NEXTVAL, :app_id, :tid, :ev,
                    :nt, :rt, :emp, :pname,
                    :email, :phone, :subj, :body, :jobt,
                    :imode, 'PENDING', :cby, SYSTIMESTAMP
                ) RETURNING MESSAGE_ID INTO :out_id
            """, {"app_id": app_id, "tid": template_id, "ev": (event_type or "")[:50] or None,
                  "nt": ntype, "rt": rtype, "emp": (empcode or None),
                  "pname": (person_name or "")[:200] or None,
                  "email": (email or "")[:150] or None,
                  "phone": (phone or "")[:50] or None,
                  "subj": (subject or "")[:300] or None, "body": body,
                  "jobt": (base_ctx.get("job_title") or "")[:200] or None,
                  "imode": (base_ctx.get("interview_mode") or "")[:30] or None,
                  "cby": created_by, "out_id": out})
            return int(out.getvalue()[0])

        created = []
        for sel in selections:
            template_id = sel.get("template_id")
            ntype = (sel.get("notification_type") or "").strip().upper()
            rtype = (sel.get("recipient_type") or "").strip().upper()
            empcodes = [str(e).strip() for e in (sel.get("empcodes") or []) if str(e).strip()]
            if ntype not in ("EMAIL", "WHATSAPP") or rtype not in ("INTERVIEWER", "CANDIDATE"):
                return {"status": "error", "code": 400,
                        "message": f"Invalid notification/recipient type: {ntype}/{rtype}"}

            cursor.execute("""
                SELECT NOTIFICATION_TYPE, RECIPIENT_TYPE, EVENT_TYPE, SUBJECT, MESSAGE_BODY
                FROM NOTIFICATION_TEMPLATES
                WHERE TEMPLATE_ID = :id AND IS_ACTIVE = 'Y'
            """, {"id": template_id})
            trow = cursor.fetchone()
            if not trow:
                return {"status": "error", "code": 400,
                        "message": f"Template {template_id} not found or inactive"}
            if (trow[0] or "").upper() != ntype or (trow[1] or "").upper() != rtype:
                return {"status": "error", "code": 400,
                        "message": f"Template {template_id} is {trow[0]}/{trow[1]}, "
                                   f"not {ntype}/{rtype}"}
            if rtype == "INTERVIEWER" and not empcodes:
                return {"status": "error", "code": 400,
                        "message": "Interviewer notification needs at least one interviewer"}

            event_type = (trow[2] or "").strip()
            raw_subject = trow[3]
            raw_body = _lob(trow[4])

            if rtype == "CANDIDATE":
                ctx = {**base_ctx}
                msg_id = _insert_message(
                    template_id, event_type, ntype, rtype, None,
                    base_ctx.get("candidate_name"),
                    base_ctx.get("candidate_email"), base_ctx.get("candidate_phone"),
                    _render(raw_subject, ctx), _render(raw_body, ctx))
                created.append({"message_id": msg_id, "recipient_type": rtype,
                                "notification_type": ntype,
                                "person_name": base_ctx.get("candidate_name"),
                                "email": base_ctx.get("candidate_email"),
                                "phone": base_ctx.get("candidate_phone")})
            else:
                # One message per panel member, each personalised: their own
                # name + contact, and the OTHER members listed for context.
                ph = ", ".join(f":e{i}" for i in range(len(empcodes)))
                cursor.execute(f"""
                    SELECT EMPCODE, NAME, EMAIL,
                           COALESCE("MOBILE#", NXT_MOBILE, "PHONE#") AS PHONE
                    FROM HR_EMP_MASTER
                    WHERE EMPCODE IN ({ph})
                """, {f"e{i}": v for i, v in enumerate(empcodes)})
                info = {str(r[0]).strip(): {"name": (r[1] or "").strip(),
                                            "email": (r[2] or "").strip() or None,
                                            "phone": (r[3] or "").strip() or None}
                        for r in cursor.fetchall()}
                names = {e: (info.get(e, {}).get("name") or e) for e in empcodes}
                for emp in empcodes:
                    others = ", ".join(names[o] for o in empcodes if o != emp) or "—"
                    ctx = {**base_ctx,
                           "panel_member_name": names[emp],
                           "panel_role": "Panel Member",
                           "other_panel_members": others}
                    i = info.get(emp, {})
                    msg_id = _insert_message(
                        template_id, event_type, ntype, rtype, emp,
                        names[emp], i.get("email"), i.get("phone"),
                        _render(raw_subject, ctx), _render(raw_body, ctx))
                    created.append({"message_id": msg_id, "recipient_type": rtype,
                                    "notification_type": ntype, "empcode": emp,
                                    "person_name": names[emp],
                                    "email": i.get("email"), "phone": i.get("phone")})
        conn.commit()
        return {"status": "success", "created": created}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "code": 500, "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def list_notification_selections(app_id: int) -> list:
    """The application's outbox, newest first — every row a complete message
    (recipient name + email/phone + rendered subject/body + job/mode/status)."""
    ensure_notification_tables()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT m.MESSAGE_ID, m.APP_ID, m.TEMPLATE_ID, t.TEMPLATE_NAME,
                   m.EVENT_TYPE, m.NOTIFICATION_TYPE, m.RECIPIENT_TYPE,
                   m.EMPCODE, m.PERSON_NAME, m.EMAIL, m.PHONE,
                   m.SUBJECT, m.MESSAGE_BODY, m.JOB_TITLE, m.INTERVIEW_MODE,
                   m.STATUS, m.CREATED_BY,
                   TO_CHAR(m.CREATED_ON, 'YYYY-MM-DD HH24:MI') AS CREATED_ON
            FROM APP_NOTIFICATION_MESSAGES m
            LEFT JOIN NOTIFICATION_TEMPLATES t ON t.TEMPLATE_ID = m.TEMPLATE_ID
            WHERE m.APP_ID = :id
            ORDER BY m.MESSAGE_ID DESC
        """, {"id": app_id})
        cols = [d[0].lower() for d in cursor.description]
        items = []
        for r in cursor.fetchall():
            d = dict(zip(cols, r))
            d["message_body"] = _lob(d.get("message_body"))
            items.append(d)
        return items
    finally:
        cursor.close()
        conn.close()
