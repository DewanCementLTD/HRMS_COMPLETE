import oracledb
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

try:
    # Connect to Oracle database
    connection = oracledb.connect(
        user='hrms',
        password='oracle123',
        dsn='127.0.0.1:1521/orcl'
    )
    print('✓ Database connection successful!')
    print()
    
    cursor = connection.cursor()
    
    # Get all tables owned by the user
    cursor.execute("""
        SELECT table_name 
        FROM user_tables 
        ORDER BY table_name
    """)
    
    tables = cursor.fetchall()
    print(f'Total Tables: {len(tables)}')
    print('=' * 70)
    
    for table in tables:
        table_name = table[0]
        print(f'\n📋 TABLE: {table_name}')
        print('-' * 70)
        
        # Get columns
        cursor.execute(f"""
            SELECT column_name, data_type, nullable
            FROM user_tab_columns
            WHERE table_name = '{table_name}'
            ORDER BY column_id
        """)
        
        columns = cursor.fetchall()
        print(f'  Columns: {len(columns)}')
        for col in columns:
            col_name, data_type, nullable = col
            null_str = 'NULL' if nullable == 'Y' else 'NOT NULL'
            print(f'    • {col_name}: {data_type} ({null_str})')
        
        # Get row count
        cursor.execute(f'SELECT COUNT(*) FROM {table_name}')
        row_count = cursor.fetchone()[0]
        print(f'  Records: {row_count}')
    
    connection.close()
    print('\n' + '=' * 70)
    print('✓ Database check completed successfully!')
    
except Exception as e:
    print(f'❌ Error: {str(e)}')
