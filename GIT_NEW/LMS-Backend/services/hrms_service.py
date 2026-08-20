"""HRMS service — business logic for employee management and HR dashboard."""

from repositories.hrms_repository import (
    create_employee,
    get_employee_by_empcode,
    update_employee,
    search_employees_hrms,
    list_employees_hrms,
    get_hr_dashboard_stats,
    get_hr_analytics,
    get_bulk_attendance_summary,
    get_bulk_attendance_details,
)


def register_employee(data: dict) -> dict:
    return create_employee(data)


def get_employee(empcode: str) -> dict | None:
    return get_employee_by_empcode(empcode)


def edit_employee(empcode: str, data: dict) -> dict:
    filtered = {k: v for k, v in data.items() if v is not None}
    if not filtered:
        return {"status": "error", "message": "No fields to update"}
    return update_employee(empcode, filtered)


def search_employees(query: str, allowed_companies=None, allowed_branches=None) -> list:
    return search_employees_hrms(query, allowed_companies, allowed_branches)


def list_employees(status: str = None, allowed_companies=None, allowed_branches=None) -> list:
    return list_employees_hrms(status, allowed_companies, allowed_branches)


def get_dashboard(qdate: str = None, compc=None, brnch=None) -> dict:
    return get_hr_dashboard_stats(qdate, compc=compc, brnch=brnch)


def get_analytics(qdate: str = None, compc=None, brnch=None) -> dict:
    return get_hr_analytics(qdate, compc=compc, brnch=brnch)


def get_bulk_attendance(
    from_date: str,
    to_date: str,
    allowed_companies=None,
    allowed_branches=None,
) -> list:
    return get_bulk_attendance_summary(from_date, to_date, allowed_companies, allowed_branches)


def get_attendance_details(
    from_date: str,
    to_date: str,
    allowed_companies=None,
    allowed_branches=None,
) -> list:
    return get_bulk_attendance_details(from_date, to_date, allowed_companies, allowed_branches)
