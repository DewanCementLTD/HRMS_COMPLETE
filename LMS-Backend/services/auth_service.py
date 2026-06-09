from repositories.user_repository import (
    authenticate_user,
    get_user_by_login,
    get_dashboard,
    get_leave_balances,
    get_user_profile,
    apply_leave,
    get_leave_status,
    update_password,
    get_user_rights,
)
from core.dependencies import get_employee_flags


# =====================================
# LOGIN
# =====================================

def login_user(username: str, password: str):
    user = authenticate_user(username, password)

    if not user:
        print(f"[LOGIN] Authentication failed for: '{username}'")
        return None

    if user.get("card_no"):
        try:
            flags = get_employee_flags(user["card_no"])
            user["face_registered"] = flags.get("face_registered", "N")
            if not user.get("emp_name"):
                user["emp_name"] = flags.get("emp_name", "")
            if not user.get("empcode"):
                user["empcode"] = flags.get("empcode", "")
        except Exception as e:
            print(f"[LOGIN] get_employee_flags failed (non-fatal): {e}")

    print(f"[LOGIN] OK — card_no={user.get('card_no')}, hr={user.get('hr_admin')}, "
          f"companies={user.get('allowed_companies')}, branches={user.get('allowed_branches')}")
    return user


# =====================================
# DASHBOARD
# =====================================

def fetch_dashboard(card_no: str):
    return get_dashboard(card_no)


# =====================================
# LEAVE BALANCES
# =====================================

def fetch_leave_balances(card_no: str):
    return get_leave_balances(card_no)


# =====================================
# PROFILE
# =====================================

def fetch_profile(card_no: str):
    return get_user_profile(card_no)


# =====================================
# APPLY LEAVE
# =====================================

def apply_leave_service(card_no: str,
                        leave_type_id: int,
                        from_date: str,
                        to_date: str,
                        reason: str,
                        compc: int,
                        brnch: int,
                        emp_name: str):

    return apply_leave(
        card_no,
        leave_type_id,
        from_date,
        to_date,
        reason,
        compc,
        brnch,
        emp_name
    )


# =====================================
# LEAVE STATUS
# =====================================

def fetch_leave_status(card_no: str):
    return get_leave_status(card_no)


# =====================================
# CHANGE PASSWORD
# =====================================

def change_password(card_no: str,
                    old_password: str,
                    new_password: str):

    user = get_user_by_login(card_no)

    if not user:
        return False

    # Plain text comparison
    stored = (user.get("user_paswd") or "").strip()
    if stored and old_password.strip() != stored:
        return False

    return update_password(card_no, new_password)
