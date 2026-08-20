"""Render an employee's attendance range report to PDF bytes.

Fed by the SAME rows as GET /auth/attendance/report-range (i.e.
services.attendance_service.fetch_attendance_report_range), so the PDF and the
on-screen list can never disagree. Row shape is whatever
repositories.attendance_repository._shape_roster_row produces:
roster_date, day_name, roster_shift, in_time, out_time, w_hrs, w_mnt, status,
morning_late, leave_remarks, roster_remarks, ...
"""

from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
)

# Colours mirror the web portal's status shading.
_STATUS_BG = {
    "Absent": colors.HexColor("#FDE2E1"),
    "Late": colors.HexColor("#FDF3D1"),
    "Half Day": colors.HexColor("#FDE7CF"),
}

_COL_WIDTHS = [62, 45, 38, 42, 42, 45, 60, 181]
_HEADERS = ["Date", "Day", "Shift", "In", "Out", "Hours", "Status", "Remarks"]


def _fmt_date(value):
    """'2026-07-14' -> '14-Jul-2026'. Passes through anything unexpected."""
    if not value:
        return "-"
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").strftime("%d-%b-%Y")
    except ValueError:
        return str(value)


def _fmt_hours(rec):
    h, m = rec.get("w_hrs") or 0, rec.get("w_mnt") or 0
    return f"{int(h):02d}:{int(m):02d}" if (h or m) else "-"


def _remarks(rec):
    """Leave/roster remarks, plus an explicit late marker (late minutes are a
    DUTY_ROSTER concept the app can't compute, so the ERP flag is what we show)."""
    bits = []
    if (rec.get("morning_late") or "").strip().upper() == "Y":
        bits.append("Late in")
    if (rec.get("early_out_late") or "").strip().upper() == "Y":
        bits.append("Early out")
    for key in ("leave_remarks", "roster_remarks"):
        val = (rec.get(key) or "").strip()
        if val:
            bits.append(val)
    return ", ".join(bits) or "-"


def build_attendance_pdf(card_no, emp_name, from_date, to_date, rows) -> bytes:
    """Return the report as PDF bytes."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=14 * mm, bottomMargin=14 * mm,
        title=f"Attendance {card_no} {from_date} to {to_date}",
        author="LMS",
    )

    styles = getSampleStyleSheet()
    h_style = ParagraphStyle("h", parent=styles["Title"], fontSize=15, spaceAfter=2)
    sub_style = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9,
                               textColor=colors.HexColor("#555555"))
    cell_style = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7, leading=9)

    story = [
        Paragraph("Attendance Report", h_style),
        Paragraph(f"<b>{emp_name or card_no}</b> &nbsp;&nbsp; Card: {card_no}", sub_style),
        Paragraph(
            f"Period: {_fmt_date(from_date)} to {_fmt_date(to_date)} &nbsp;&nbsp;"
            f" Generated: {datetime.now().strftime('%d-%b-%Y %H:%M')}",
            sub_style,
        ),
        Spacer(1, 7),
    ]

    if not rows:
        story.append(Paragraph("No attendance records for this period.", styles["Normal"]))
        doc.build(story)
        return buf.getvalue()

    data = [_HEADERS]
    status_rows = []          # (row_index, status) for per-row shading
    counts = {}
    for i, rec in enumerate(rows, start=1):
        status = rec.get("status") or "-"
        counts[status] = counts.get(status, 0) + 1
        status_rows.append((i, status))
        data.append([
            _fmt_date(rec.get("roster_date")),
            (rec.get("day_name") or "-").strip()[:9],
            (rec.get("roster_shift") or "-").strip(),
            rec.get("in_time") or "-",
            rec.get("out_time") or "-",
            _fmt_hours(rec),
            status,
            Paragraph(_remarks(rec), cell_style),
        ])

    table = Table(data, colWidths=_COL_WIDTHS, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2F3E9E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("ALIGN", (1, 0), (6, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#BBBBBB")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for idx, status in status_rows:
        bg = _STATUS_BG.get(status)
        if bg:
            style.append(("BACKGROUND", (0, idx), (-1, idx), bg))
    table.setStyle(TableStyle(style))
    story.append(table)

    # Summary footer — computed from the same rows above, so it always agrees.
    story.append(Spacer(1, 9))
    order = ["Present", "Absent", "Late", "Half Day", "Off"]
    parts = [f"{name}: <b>{counts[name]}</b>" for name in order if counts.get(name)]
    parts += [f"{k}: <b>{v}</b>" for k, v in counts.items() if k not in order]
    story.append(Paragraph(
        f"Total days: <b>{len(rows)}</b> &nbsp;&nbsp;|&nbsp;&nbsp; " + " &nbsp;&nbsp; ".join(parts),
        sub_style,
    ))

    def _page_number(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#777777"))
        canvas.drawRightString(A4[0] - 15 * mm, 8 * mm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_page_number, onLaterPages=_page_number)
    return buf.getvalue()
