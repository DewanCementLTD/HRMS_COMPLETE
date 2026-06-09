"""
Diagnostic script to test SEC_USERCMPN and SEC_USERBRCH queries directly
"""

from core.database import get_connection

print("=" * 80)
print("DIAGNOSING COMPANY/BRANCH QUERIES")
print("=" * 80)

conn = get_connection()
cur = conn.cursor()

try:
    # Test 1: Check if data exists in SEC_USERCMPN
    print("\n[TEST 1] Checking SEC_USERCMPN table")
    print("-" * 80)
    cur.execute("SELECT USRID, COMPC FROM SEC_USERCMPN ORDER BY USRID, COMPC")
    rows = cur.fetchall()
    print(f"Total rows in SEC_USERCMPN: {len(rows)}")
    for row in rows:
        print(f"  USRID={row[0]}, COMPC={row[1]}")
    
    # Test 2: Check if data exists in SEC_USERBRCH
    print("\n[TEST 2] Checking SEC_USERBRCH table")
    print("-" * 80)
    cur.execute("SELECT USRID, BRNCH FROM SEC_USERBRCH ORDER BY USRID, BRNCH")
    rows = cur.fetchall()
    print(f"Total rows in SEC_USERBRCH: {len(rows)}")
    for row in rows:
        print(f"  USRID={row[0]}, BRNCH={row[1]}")
    
    # Test 3: Query with numeric USRID=2
    print("\n[TEST 3] SEC_USERCMPN WHERE USRID = 2 (numeric)")
    print("-" * 80)
    cur.execute("SELECT USRID, COMPC FROM SEC_USERCMPN WHERE USRID = 2")
    rows = cur.fetchall()
    print(f"Result: {len(rows)} rows")
    for row in rows:
        print(f"  USRID={row[0]}, COMPC={row[1]}")
    
    # Test 4: Query with numeric USRID=2 for branches
    print("\n[TEST 4] SEC_USERBRCH WHERE USRID = 2 (numeric)")
    print("-" * 80)
    cur.execute("SELECT USRID, BRNCH FROM SEC_USERBRCH WHERE USRID = 2")
    rows = cur.fetchall()
    print(f"Result: {len(rows)} rows")
    for row in rows:
        print(f"  USRID={row[0]}, BRNCH={row[1]}")
    
    # Test 5: Full query with JOINs for company
    print("\n[TEST 5] Full SEC_USERCMPN query with COMPANY_INFO JOIN")
    print("-" * 80)
    cur.execute("""
        SELECT sc.USRID, sc.COMPC, NVL(ci.DESCR, TO_CHAR(sc.COMPC))
        FROM SEC_USERCMPN sc
        LEFT JOIN COMPANY_INFO ci ON ci.COMPC = sc.COMPC
        WHERE sc.USRID = 2
        ORDER BY sc.COMPC
    """)
    rows = cur.fetchall()
    print(f"Result: {len(rows)} rows")
    for row in rows:
        print(f"  USRID={row[0]}, COMPC={row[1]}, NAME={row[2]}")
    
    # Test 6: Full query with JOINs for branch
    print("\n[TEST 6] Full SEC_USERBRCH query with COM_LOCATION JOIN")
    print("-" * 80)
    cur.execute("""
        SELECT sb.USRID, sb.BRNCH, NVL(cl.DESCR, TO_CHAR(sb.BRNCH))
        FROM SEC_USERBRCH sb
        LEFT JOIN COM_LOCATION cl ON TO_CHAR(cl.LCODE) = TO_CHAR(sb.BRNCH)
        WHERE sb.USRID = 2
        ORDER BY sb.BRNCH
    """)
    rows = cur.fetchall()
    print(f"Result: {len(rows)} rows")
    for row in rows:
        print(f"  USRID={row[0]}, BRNCH={row[1]}, NAME={row[2]}")
    
    # Test 7: Check if COM_LOCATION table has data
    print("\n[TEST 7] Checking COM_LOCATION table for LCODE=2")
    print("-" * 80)
    cur.execute("SELECT LCODE, DESCR FROM COM_LOCATION WHERE TO_CHAR(LCODE) = '2'")
    rows = cur.fetchall()
    print(f"Result: {len(rows)} rows")
    for row in rows:
        print(f"  LCODE={row[0]}, DESCR={row[1]}")
    
    # Test 8: Check if COMPANY_INFO table has data
    print("\n[TEST 8] Checking COMPANY_INFO table for COMPC=1")
    print("-" * 80)
    cur.execute("SELECT COMPC, DESCR FROM COMPANY_INFO WHERE COMPC = 1")
    rows = cur.fetchall()
    print(f"Result: {len(rows)} rows")
    for row in rows:
        print(f"  COMPC={row[0]}, DESCR={row[1]}")

finally:
    cur.close()
    conn.close()

print("\n" + "=" * 80)
print("DIAGNOSTIC COMPLETE")
print("=" * 80)
