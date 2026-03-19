"""
router_client.py  (antes api_client.py)
Router inteligente: usa PostgreSQL local o Supabase según DB_MODE en .env

DB_MODE=local   → usa pg_client.py (PostgreSQL en esta PC)
DB_MODE=supabase → usa la API REST de Supabase (comportamiento original)
Por defecto si DB_MODE no está definido: supabase (retrocompatibilidad)
"""
import os
import requests
import certifi
from dotenv import load_dotenv

def _load_env():
    current = os.path.dirname(os.path.abspath(__file__))
    while current != os.path.dirname(current):
        ep = os.path.join(current, '.env')
        if os.path.exists(ep):
            load_dotenv(ep, override=False)
            return
        current = os.path.dirname(current)

_load_env()

# ─── Detectar modo de base de datos ───────────────────────────────────────────
DB_MODE = os.getenv("DB_MODE", "supabase").lower()   # "local" o "supabase"

if DB_MODE == "local":
    # Importar módulo local y re-exportar todo con los mismos nombres
    from modules.pg_client import (
        post_to_supabase,
        patch_to_supabase,
        call_rpc,
        get_headers,
        delete_from_table,
        get_from_table,
        SUPABASE_URL,
        SUPABASE_KEY,
    )
else:
    # ─── Modo original: Supabase REST API ────────────────────────────────────
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

    def _safe_request(method, url, headers, **kwargs):
        """Realiza una petición HTTP con fallback ante errores SSL/Proxy."""
        try:
            return method(url, headers=headers, verify=certifi.where(), **kwargs)
        except (requests.exceptions.SSLError,
                requests.exceptions.ConnectionError,
                requests.exceptions.ProxyError):
            return method(url, headers=headers, verify=False, **kwargs)

    def post_to_supabase(endpoint, payload, extra_headers=None):
        url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
        headers = get_headers()
        if extra_headers:
            headers.update(extra_headers)
        response = _safe_request(requests.post, url, headers, json=payload)
        response.raise_for_status()
        return response

    def patch_to_supabase(endpoint, payload, params, extra_headers=None):
        url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
        headers = get_headers()
        if extra_headers:
            headers.update(extra_headers)
        response = _safe_request(requests.patch, url, headers, json=payload, params=params)
        response.raise_for_status()
        return response

    def delete_from_table(table, params):
        """Elimina filas vía API REST de Supabase."""
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        headers = get_headers()
        response = _safe_request(requests.delete, url, headers, params=params)
        return response

    def get_from_table(table, select="*", params=None, limit=10000):
        """Consulta una tabla vía API REST de Supabase."""
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        headers = get_headers()
        q = {"select": select, "limit": limit}
        if params:
            q.update(params)
        response = _safe_request(requests.get, url, headers, params=q)
        response.raise_for_status()
        return response.json()

    def call_rpc(rpc_name, payload=None):
        url = f"{SUPABASE_URL}/rest/v1/rpc/{rpc_name}"
        headers = get_headers()
        headers.pop("Prefer", None)
        response = _safe_request(requests.post, url, headers, json=payload or {})
        response.raise_for_status()
        if not response.content:
            return {"success": True, "message": "RPC executed (minimal response)"}
        return response.json()
