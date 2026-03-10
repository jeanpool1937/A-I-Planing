import os
import requests
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

def post_to_supabase(endpoint, payload):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    response = requests.post(url, headers=get_headers(), json=payload)
    response.raise_for_status()
    return response

def patch_to_supabase(endpoint, payload, params):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    response = requests.patch(url, headers=get_headers(), json=payload, params=params)
    response.raise_for_status()
    return response

def call_rpc(rpc_name, payload=None):
    url = f"{SUPABASE_URL}/rest/v1/rpc/{rpc_name}"
    response = requests.post(url, headers=get_headers(), json=payload or {})
    response.raise_for_status()
    return response.json()
