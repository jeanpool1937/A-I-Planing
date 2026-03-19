
import psycopg2
import os
import json
from dotenv import load_dotenv

load_dotenv(r"D:\Base de datos\A+I-Planing\backend\.env")

def get_counts():
    try:
        conn = psycopg2.connect(
            host=os.getenv("PG_HOST", "127.0.0.1"),
            port=os.getenv("PG_PORT", "5433"),
            dbname=os.getenv("PG_DB", "aiplaning_local"),
            user=os.getenv("PG_USER", "postgres"),
            password=os.getenv("PG_PASSWORD", "Postgres2024!")
        )
        cur = conn.cursor()
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
        tables = [t[0] for t in cur.fetchall()]
        counts = {}
        for t in tables:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            counts[t] = cur.fetchone()[0]
        print(json.dumps(counts, indent=4))
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_counts()
