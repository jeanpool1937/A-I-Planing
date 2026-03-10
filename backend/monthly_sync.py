
import os
import sys

# Asegurar importación desde el directorio del script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_utils import (
    sync_file, 
    sync_production_file, 
    sync_master_data,
    clean_articulos_column_name
)
from agents.report_master_persistor import run_report_persistence
from agents.forecast_engine import run_forecast

# Regional/Temporary cleaning functions as they are not in global modules
def clean_generic_column(col_name):
    return str(col_name).strip().lower().replace(' ', '_').replace('.', '').replace('(', '').replace(')', '')

# Aliases to satisfy the monthly_sync calls
clean_procesos_column_name = clean_generic_column
clean_centro_column_name = clean_generic_column
clean_almacenes_column_name = clean_generic_column

# Absolute path to the Excel files (in OneDrive)
CONSUMO_FILE_PATH = r"d:/OneDrive - CORPORACIÓN ACEROS AREQUIPA SA/PCP - General/2. CONTROL/ESTADISTICA ANUAL - HISTORICO/Reporte de seguimiento y coberturas/Movimientos/Consumo 2020-2025.xlsx"
PRODUCCION_FILE_PATH = r"d:/OneDrive - CORPORACIÓN ACEROS AREQUIPA SA/PCP - General/2. CONTROL/ESTADISTICA ANUAL - HISTORICO/Reporte de seguimiento y coberturas/Produccion/Reporte de Producción 2020-2025.xlsx"
MAESTRO_FILE_PATH = r"d:/OneDrive - CORPORACIÓN ACEROS AREQUIPA SA/PCP - General/2. CONTROL/COBERTURAS/Maestro de Articulos.xlsx"

if __name__ == "__main__":
    print("=== Iniciando Sincronización Mensual (Histórica) ===")
    
    print("\n--- Syncing Consumo Mensual ---")
    sync_file(CONSUMO_FILE_PATH, is_historical=True)
    
    print("\n--- Syncing Produccion Mensual ---")
    sync_production_file(PRODUCCION_FILE_PATH)

    print("\n--- Syncing Maestro Articulos ---")
    sync_master_data(
        MAESTRO_FILE_PATH, 
        sheet_name='Articulos', 
        table_name='sap_maestro_articulos',
        clean_col_func=clean_articulos_column_name,
        pk_col='codigo'
    )

    print("\n--- Syncing Clase Proceso ---")
    sync_master_data(
        MAESTRO_FILE_PATH, 
        sheet_name='Procesos', 
        table_name='sap_clase_proceso',
        clean_col_func=clean_procesos_column_name,
        pk_col='clase_proceso'
    )

    print("\n--- Syncing Centro Pais ---")
    sync_master_data(
        MAESTRO_FILE_PATH, 
        sheet_name='Centro', 
        table_name='sap_centro_pais',
        clean_col_func=clean_centro_column_name,
        pk_col='centro_id',
        usecols='A:C'
    )

    print("\n--- Syncing Almacenes Comerciales ---")
    sync_master_data(
        MAESTRO_FILE_PATH, 
        sheet_name='Centro', 
        table_name='sap_almacenes_comerciales',
        clean_col_func=clean_almacenes_column_name,
        pk_col='centro',
        usecols='E:H'
    )

    print("\n--- Refrescando Reporte Maestro de Proyección ---")
    try:
        run_report_persistence()
        print("  [OK] Reporte Maestro completado.")
    except Exception as e:
        print(f"  [ERROR] Error al refrescar reporte: {e}")

    print("\n--- Generando Pronósticos Híbridos (90 días) ---")
    try:
        forecast_count = run_forecast()
        print(f"  [OK] Pronósticos generados: {forecast_count} registros.")
    except Exception as e:
        print(f"  [ERROR] Error al generar pronósticos: {e}")

    print("\n=== Sincronización Mensual Completada ===")
