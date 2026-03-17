"""
sync_logger.py
Helper para registrar el resultado de cada sincronización en la tabla
`sync_status_log` de Supabase. Importar en daily_sync.py y monthly_sync.py.
"""
import os
import json
import requests
import certifi
from datetime import datetime

# Reutiliza la config del proyecto
try:
    from modules.api_client import get_headers, SUPABASE_URL
except ImportError:
    # Fallback si se ejecuta desde otro directorio
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

    def get_headers():
        return {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }


def log_sync_result(
    table_name: str,
    rows_upserted: int,
    status: str = "success",
    error_msg: str = None,
):
    """
    Registra el resultado de un paso de sincronización en `sync_status_log`.

    Args:
        table_name:     Nombre de la tabla de Supabase que fue actualizada.
        rows_upserted:  Número de filas insertadas/actualizadas.
        status:         'success' o 'error'.
        error_msg:      Mensaje de error opcional.
    """
    url = f"{SUPABASE_URL}/rest/v1/sync_status_log"
    payload = {
        "run_date": datetime.now().strftime("%Y-%m-%d"),
        "table_name": table_name,
        "rows_upserted": rows_upserted,
        "status": status,
        "error_msg": error_msg,
        "executed_at": datetime.now().isoformat(),
    }
    try:
        headers = get_headers()
        # Prefer: return=minimal para no recibir el registro completo
        headers["Prefer"] = "return=minimal"
        try:
            resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=10, verify=certifi.where())
        except requests.exceptions.SSLError:
            resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=10, verify=False)
            
        if resp.status_code not in (200, 201):
            print(f"[sync_logger] Advertencia: no se pudo registrar log ({resp.status_code}): {resp.text[:120]}")
    except Exception as e:
        # No interrumpir el flujo principal si falla el logger
        print(f"[sync_logger] Error al escribir log: {e}")
