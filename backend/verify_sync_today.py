import os
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv('d:/Base de datos/A+I-Planing/backend/.env')
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

today = datetime.now().strftime("%Y-%m-%d")
url = f"{SUPABASE_URL}/rest/v1/sync_status_log"
params = {
    "run_date": f"eq.{today}",
    "table_name": "eq.ai_anomaly_alerts",
    "order": "executed_at.desc",
    "limit": 1
}

response = requests.get(url, headers=headers, params=params, verify=False)
if response.status_code == 200:
    logs = response.json()
    if logs:
        log = logs[0]
        print(f"Estado de {log['table_name']}: {log['status']}")
        print(f"Filas: {log['rows_upserted']}")
        print(f"Hora: {log['executed_at']}")
        if log['error_msg']:
            print(f"Error: {log['error_msg']}")
    else:
        print("No se encontró registro para hoy.")
else:
    print(f"Error API: {response.status_code}")
