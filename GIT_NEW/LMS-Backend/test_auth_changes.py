"""
Test script to verify authentication changes.

Test scenarios:
1. SEC_USERNAME user in HR_EMP_MASTER - Should be HR admin with employee features
2. SEC_USERNAME user NOT in HR_EMP_MASTER - Should be HR admin without employee features
3. HR_EMP_MASTER user - Should NOT be HR admin, but have employee features
"""

import sys
from repositories.user_repository import authenticate_user

print("=" * 80)
print("AUTHENTICATION CHANGES TEST")
print("=" * 80)

# Test data - adjust these with actual test users from your database
test_cases = [
    {
        "name": "SEC_USERNAME user (exists in HR_EMP_MASTER)",
        "username": "9123456789",  # Replace with actual SEC_USERNAME mobile
        "password": "test123",  # Replace with actual password
        "expected": {
            "hr_admin": "Y",
            "has_employee_features": True,
            "has_company_rights": True,
        }
    },
    {
        "name": "SEC_USERNAME user (NOT in HR_EMP_MASTER)",
        "username": "9000000000",  # Replace with actual SEC_USERNAME not in HR_EMP_MASTER
        "password": "test123",  # Replace with actual password
        "expected": {
            "hr_admin": "Y",
            "has_employee_features": False,
            "has_company_rights": True,
        }
    },
    {
        "name": "HR_EMP_MASTER user",
        "username": "100001.1",  # Replace with actual employee card_no
        "password": "test123",  # Replace with actual password
        "expected": {
            "hr_admin": "N",
            "has_employee_features": True,
            "has_company_rights": False,
        }
    },
]

for i, test in enumerate(test_cases, 1):
    print(f"\n[TEST {i}] {test['name']}")
    print("-" * 80)
    
    try:
        user = authenticate_user(test["username"], test["password"])
        
        if user is None:
            print(f"❌ FAILED: Login returned None")
            continue
        
        print(f"✓ Login successful")
        print(f"  - card_no: {user.get('card_no')}")
        print(f"  - emp_name: {user.get('emp_name')}")
        print(f"  - hr_admin: {user.get('hr_admin')} (expected: {test['expected']['hr_admin']})")
        print(f"  - has_employee_features: {user.get('has_employee_features')} (expected: {test['expected']['has_employee_features']})")
        
        has_company = len(user.get('allowed_companies', [])) > 0
        print(f"  - has_company_rights: {has_company} (expected: {test['expected']['has_company_rights']})")
        
        has_branch = len(user.get('allowed_branches', [])) > 0
        print(f"  - has_branch_rights: {has_branch}")
        
        if user.get('allowed_companies'):
            print(f"  - companies: {user.get('allowed_companies')}")
        if user.get('allowed_branches'):
            print(f"  - branches: {user.get('allowed_branches')}")
        
        # Verify expectations
        checks = [
            ("hr_admin", user.get('hr_admin'), test['expected']['hr_admin']),
            ("has_employee_features", user.get('has_employee_features'), test['expected']['has_employee_features']),
            ("has_company_rights", has_company, test['expected']['has_company_rights']),
        ]
        
        all_pass = True
        for check_name, actual, expected in checks:
            if actual == expected:
                print(f"  ✓ {check_name}: PASS")
            else:
                print(f"  ✗ {check_name}: FAIL (got {actual}, expected {expected})")
                all_pass = False
        
        if all_pass:
            print(f"\n✓ TEST {i} PASSED")
        else:
            print(f"\n✗ TEST {i} FAILED")
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()

print("\n" + "=" * 80)
print("TEST COMPLETE")
print("=" * 80)
print("""
KEY CHANGES IMPLEMENTED:
1. SEC_USERNAME users:
   - Always have hr_admin=Y (only they are HR admins)
   - Get name from SEC_USERNAME.DESCR
   - Get company/branch rights from SEC_USERCMPN and SEC_USERBRCH
   - has_employee_features=True only if they exist in HR_EMP_MASTER

2. HR_EMP_MASTER users:
   - Always have hr_admin=N (never HR admins)
   - NO company/branch rights (empty lists)
   - has_employee_features=True

3. Frontend should:
   - Show HR modules only if hr_admin=True
   - Show employee modules based on has_employee_features flag
   - Use allowed_companies and allowed_branches for access control
""")
