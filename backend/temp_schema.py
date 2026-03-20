import psycopg2

conn = psycopg2.connect('postgresql://postgres:Postgres2024!@127.0.0.1:5433/aiplaning_local')
cur = conn.cursor()
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='sap_stock_mb52'")
print([c[0] for c in cur.fetchall()])
cur.close()
conn.close()
