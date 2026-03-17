import os
import requests
import certifi
from dotenv import load_dotenv

# Cargar configuración básica
load_dotenv('d:/Base de datos/A+I-Planing/backend/.env')
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

def force_truncate(table):
    print(f"Forzando truncado de {table}...")
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    # Intentar varias formas de borrar si una falla
    attempts = [
        {"sku_id": "not.is.null"},
        {"material": "not.is.null"},
        {"id": "not.is.null"},
        {"fecha": "gte.2000-01-01"}
    ]
    
    for param in attempts:
        try:
            # Primero intentar con certifi
            resp = requests.delete(url, headers=headers, params=param, verify=certifi.where())
        except requests.exceptions.SSLError:
            # Fallback seguro
            resp = requests.delete(url, headers=headers, params=param, verify=False)
        
        if resp.status_code in (200, 204):
            print(f"  [OK] Tabla {table} truncada con éxito usando {param}")
            return True
    
    print(f"  [ERROR] No se pudo truncar {table}. Status: {resp.status_code}, Msg: {resp.text}")
    return False

if __name__ == "__main__":
    force_truncate("sap_pronostico_diario")
    force_truncate("ai_anomaly_alerts")
