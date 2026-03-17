import os
import requests
from dotenv import load_dotenv

load_dotenv('d:/Base de datos/A+I-Planing/backend/.env')
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

url = f"{SUPABASE_URL}/rest/v1/sync_status_log?table_name=eq.ai_anomaly_alerts&order=executed_at.desc&limit=1"

try:
    response = requests.get(url, headers=headers, verify=False) # Skip SSL verification to debug
    if response.status_code == 200:
        logs = response.json()
        if logs:
            log = logs[0]
            print(f"Estado: {log['status']}")
            print(f"Error: {log['error_msg']}")
            print(f"Fecha: {log['executed_at']}")
        else:
            print("No se encontraron registros para ai_anomaly_alerts")
    else:
        print(f"Error API: {response.status_code} - {response.text}")
except Exception as e:
    print(f"Error de conexión: {e}")
