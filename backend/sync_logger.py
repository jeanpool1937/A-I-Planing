"""
sync_logger.py
Helper para registrar el resultado de cada sincronización en la tabla
`sync_status_log` de Supabase o localmente.
"""
import os
import json
from datetime import datetime
from modules.api_client import post_to_supabase

def log_sync_result(
    table_name: str,
    rows_upserted: int,
    status: str = "success",
    error_msg: str = None,
):
    """
    Registra el resultado de un paso de sincronización en `sync_status_log`.
    """
    payload = {
        "run_date": datetime.now().strftime("%Y-%m-%d"),
        "table_name": table_name,
        "rows_upserted": rows_upserted,
        "status": status,
        "error_msg": error_msg,
        "executed_at": datetime.now().isoformat(),
    }
    try:
        # Usar la abstracción que ya maneja local/supabase
        post_to_supabase("sync_status_log", payload)
    except Exception as e:
        # No interrumpir el flujo principal si falla el logger
        print(f"[sync_logger] Error al escribir log: {e}")
