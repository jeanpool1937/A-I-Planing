import os
import requests
import certifi
from dotenv import load_dotenv

load_dotenv('d:/Base de datos/A+I-Planing/backend/.env')
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

def test_rpc_connection():
    url = f"{SUPABASE_URL}/rest/v1/rpc/refresh_inventory_hybrid_plan"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    print(f"Probando RPC en {url}...")
    try:
        # Intentar con certifi
        resp = requests.post(url, headers=headers, json={}, verify=certifi.where())
    except requests.exceptions.SSLError:
        print("Fallo SSL con certifi, intentando fallback verify=False...")
        resp = requests.post(url, headers=headers, json={}, verify=False)
    
    if resp.status_code in (200, 204, 201):
        print(f"  [ÉXITO] RPC ejecutado. Status: {resp.status_code}")
    else:
        print(f"  [ERROR] RPC falló. Status: {resp.status_code}, Msg: {resp.text}")

if __name__ == "__main__":
    test_rpc_connection()
