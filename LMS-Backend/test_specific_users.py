"""
Quick test to verify authentication for the two users mentioned:
- 3018224986 (SEC_USERNAME only - should have has_employee_features=False)
- 3458000041 (SEC_USERNAME + HR_EMP_MASTER - should have has_employee_features=True)
"""

from repositories.user_repository import authenticate_user

print("=" * 80)
print("TESTING SPECIFIC USERS")
print("=" * 80)

test_users = [
    {
        "name": "ADMIN (3018224986) - SEC_USERNAME ONLY",
        "username": "3018224986",
        "password": "oracle123",  # Update with actual password
        "should_have_employee_features": False,
    },
    {
        "name": "User (3458000041) - SEC_USERNAME + HR_EMP_MASTER",
        "username": "3458000041",
        "password": "test123",  # Update with actual password
        "should_have_employee_features": True,
    },
]

for test in test_users:
    print(f"\n[TEST] {test['name']}")
    print("-" * 80)
    
    try:
        user = authenticate_user(test["username"], test["password"])
        
        if user is None:
            print(f"❌ Authentication failed")
            continue
        
        print(f"✓ Authentication successful")
        print(f"  - card_no: {user.get('card_no')}")
        print(f"  - emp_name: {user.get('emp_name')}")
        print(f"  - hr_admin: {user.get('hr_admin')}")
        print(f"  - has_employee_features: {user.get('has_employee_features')}")
        
        # Check the expectation
        actual = user.get('has_employee_features')
        expected = test['should_have_employee_features']
        
        if actual == expected:
            print(f"  ✓ PASS: has_employee_features={actual} (correct)")
        else:
            print(f"  ✗ FAIL: has_employee_features={actual}, expected {expected}")
        
        print(f"  - allowed_companies: {user.get('allowed_companies')}")
        print(f"  - allowed_branches: {user.get('allowed_branches')}")
        
    except Exception as e:
        print(f"❌ Exception: {e}")
        import traceback
        traceback.print_exc()

print("\n" + "=" * 80)
print("TEST COMPLETE")
print("=" * 80)
