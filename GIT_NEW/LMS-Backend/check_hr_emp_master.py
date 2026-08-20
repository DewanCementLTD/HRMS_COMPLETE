import oracledb

connection = oracledb.connect(user='hrms', password='oracle123', dsn='127.0.0.1:1521/orcl')
cursor = connection.cursor()

# Check if HR_EMP_MASTER exists
cursor.execute("SELECT table_name FROM user_tables WHERE table_name='HR_EMP_MASTER'")
result = cursor.fetchone()

if result:
    print('TABLE FOUND: HR_EMP_MASTER')
    print('=' * 70)
    print()
    
    # Get columns
    cursor.execute("SELECT column_name, data_type, nullable FROM user_tab_columns WHERE table_name='HR_EMP_MASTER' ORDER BY column_id")
    columns = cursor.fetchall()
    print(f'Total Columns: {len(columns)}')
    print()
    for col in columns:
        col_name, data_type, nullable = col
        null_str = 'NULL' if nullable == 'Y' else 'NOT NULL'
        print(f'  {col_name:30} {data_type:20} ({null_str})')
    print()
    
    # Get sample data
    cursor.execute('SELECT COUNT(*) FROM HR_EMP_MASTER')
    count = cursor.fetchone()[0]
    print(f'Total Records: {count}')
    print()
    
    # Get specific columns we care about
    print('Sample Data (with TRACK_LOCATION columns):')
    print('=' * 70)
    cursor.execute('SELECT * FROM HR_EMP_MASTER WHERE ROWNUM <= 5')
    desc = cursor.description
    rows = cursor.fetchall()
    
    # Print column headers
    headers = [col[0] for col in desc]
    print('Columns:', headers)
    print()
    
    for row in rows:
        print(row)
        print()
else:
    print('HR_EMP_MASTER NOT FOUND')
    print()
    print('Checking for similar tables...')
    cursor.execute("SELECT table_name FROM user_tables WHERE table_name LIKE '%EMP%' ORDER BY table_name")
    tables = cursor.fetchall()
    for table in tables:
        print(f'  - {table[0]}')

connection.close()
