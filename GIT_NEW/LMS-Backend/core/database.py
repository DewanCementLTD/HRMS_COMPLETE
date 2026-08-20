import oracledb
from core.config import settings

def get_connection():
    connection = oracledb.connect(
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        dsn=settings.DB_DSN
    )
    return connection