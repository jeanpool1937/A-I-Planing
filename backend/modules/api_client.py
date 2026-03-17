import os
import requests
import certifi
from dotenv import load_dotenv

# Función robusta para cargar .env buscando en directorios superiores
def load_env_robust():
    current_path = os.path.dirname(os.path.abspath(__file__))
    while current_path != os.path.dirname(current_path): # Hasta llegar a la raíz
        env_path = os.path.join(current_path, '.env')
        if os.path.exists(env_path):
            load_dotenv(env_path)
            # logging.info(f"Archivo .env cargado desde: {env_path}")
            return True
        current_path = os.path.dirname(current_path)
    return False

load_env_robust()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

def get_headers():
    if not SUPABASE_KEY:
        raise ValueError("SUPABASE_KEY no encontrada en las variables de entorno.")
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal" 
    }

def post_to_supabase(endpoint, payload, extra_headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = get_headers()
    if extra_headers:
        headers.update(extra_headers)
    try:
        response = requests.post(url, headers=headers, json=payload, verify=certifi.where())
    except (requests.exceptions.SSLError, requests.exceptions.ConnectionError, requests.exceptions.ProxyError):
        response = requests.post(url, headers=headers, json=payload, verify=False)
    response.raise_for_status()
    return response

def patch_to_supabase(endpoint, payload, params, extra_headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = get_headers()
    if extra_headers:
        headers.update(extra_headers)
    try:
        response = requests.patch(url, headers=headers, json=payload, params=params, verify=certifi.where())
    except (requests.exceptions.SSLError, requests.exceptions.ConnectionError, requests.exceptions.ProxyError):
        response = requests.patch(url, headers=headers, json=payload, params=params, verify=False)
    response.raise_for_status()
    return response

def call_rpc(rpc_name, payload=None):
    url = f"{SUPABASE_URL}/rest/v1/rpc/{rpc_name}"
    headers = get_headers()
    # Para RPCs, preferimos recibir la respuesta completa/JSON
    if "Prefer" in headers:
        del headers["Prefer"]
    
    try:
        response = requests.post(url, headers=headers, json=payload or {}, verify=certifi.where())
    except (requests.exceptions.SSLError, requests.exceptions.ConnectionError, requests.exceptions.ProxyError):
        response = requests.post(url, headers=headers, json=payload or {}, verify=False)
    response.raise_for_status()
    # Si la respuesta está vacía (Prefer: return=minimal), retornamos un dict de éxito genérico
    if not response.content:
        return {"success": True, "message": "RPC executed successfully (minimal response)"}
    return response.json()

