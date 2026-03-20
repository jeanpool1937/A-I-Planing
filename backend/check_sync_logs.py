import psycopg2
import os
from dotenv import load_dotenv

load_dotenv(r"D:\Base de datos\A+I-Planing\backend\.env")

conn = psycopg2.connect(
    host=os.getenv("PG_HOST", "127.0.0.1"),
    port=os.getenv("PG_PORT", "5433"),
    dbname=os.getenv("PG_DB", "aiplaning_local"),
    user=os.getenv("PG_USER", "postgres"),
    password=os.getenv("PG_PASSWORD", "Postgres2024!")
)
cur = conn.cursor()
cur.execute("SELECT executed_at, run_date, status, table_name, rows_upserted FROM sync_status_log ORDER BY executed_at DESC LIMIT 10")
rows = cur.fetchall()
for row in rows:
    print(f"[{row[0]}] {row[1]} | {row[2]} | {row[3]} | {row[4]} registros")
cur.close()
conn.close()
