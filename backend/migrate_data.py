"""
migrate_data.py
Copia todos los registros de Supabase a la base de datos PostgreSQL local.
"""
import os
import sys

# Añadir ruta del backend
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modules.api_client import get_from_table, post_to_supabase
from dotenv import load_dotenv

load_dotenv()

import modules.pg_client as pg
import requests
import certifi

TABLES_TO_MIGRATE = [
    "sap_centro_pais",
    "sap_consumo_movimientos",
    "sap_produccion",
    "sap_stock_mb52",
    "sap_programa_produccion",
    "sap_demanda_proyectada",
    "sap_consumo_sku_mensual",
    "sap_consumo_diario_clean",
    "sap_plan_inventario_hibrido",
    "sap_pronostico_diario",
    "sap_reporte_maestro",
    "ai_anomaly_alerts",
    "sync_status_log",
    "sap_maestro_articulos",
    "sap_clase_proceso",
    "sap_almacenes_comerciales"
]

def get_from_cloud(table, limit=30000):
    """Lee directamente de la API REST de Supabase ignorando DB_MODE."""
    url = f"{os.getenv('SUPABASE_URL')}/rest/v1/{table}"
    key = os.getenv('SUPABASE_KEY')
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    params = {"select": "*", "limit": limit}
    try:
        resp = requests.get(url, headers=headers, params=params, verify=certifi.where())
    except requests.exceptions.SSLError:
        resp = requests.get(url, headers=headers, params=params, verify=False)
    
    resp.raise_for_status()
    return resp.json()

def migrate():
    print("=" * 55)
    print("  MIGRACIÓN DE DATOS (MÉTODO ROBUSTO): NUBE -> LOCAL")
    print("=" * 55)

    for table in TABLES_TO_MIGRATE:
        print(f"\nMigrando tabla: {table}...")
        try:
            # 1. Leer de Supabase directamente
            data = get_from_cloud(table, limit=50000)
            if not data:
                print(f"  [INFO] Tabla vacía en Supabase. Omitiendo.")
                continue

            print(f"  [DEBUG] Obtenidos {len(data)} registros de la nube.")

            # 2. Escribir en Local usando pg_client directamente
            pg.post_to_supabase(table, data)
            print(f"  [OK] {len(data)} registros migrados a local.")

        except Exception as e:
            print(f"  [ERROR] Error migrando {table}: {e}")

    print("\n" + "=" * 55)
    print("  ¡Migración de datos completada!")
    print("=" * 55)

if __name__ == "__main__":
    migrate()
