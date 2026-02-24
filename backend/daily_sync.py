
import os
from sync_utils import sync_file, sync_production_file, sync_stock_mb52, sync_programa_produccion
from agents.report_master_persistor import run_report_persistence

# Absolute path to the Excel files (in OneDrive)
BASE_PATH = r"D:\OneDrive - CORPORACIÓN ACEROS AREQUIPA SA\PCP - General"
CONSUMO_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\ESTADISTICA ANUAL - HISTORICO\Reporte de seguimiento y coberturas\Movimientos\ConsumoMes.xlsx")
PRODUCCION_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\ESTADISTICA ANUAL - HISTORICO\Reporte de seguimiento y coberturas\Produccion\ProduccionMes.xlsx")
MB52_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\COBERTURAS\MB52.XLSX")
PROGRAMA_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\COBERTURAS\Planes 2025.xlsm")

# NOTA: La demanda proyectada (PO Histórico.xlsx) se sincroniza MENSUALMENTE
# a mediados de mes, NO en el sync diario. Ver tarea separada para monthly_sync.

if __name__ == "__main__":
    print("--- Syncing Consumo Diario ---")
    sync_file(CONSUMO_FILE_PATH, is_historical=False)
    
    print("\n--- Syncing Produccion Diario ---")
    sync_production_file(PRODUCCION_FILE_PATH)

    print("\n--- Syncing Programa Produccion (Planes 2025) ---")
    sync_programa_produccion(PROGRAMA_FILE_PATH)

    print("\n--- Syncing Stock MB52 ---")
    sync_stock_mb52(MB52_FILE_PATH)

    print("\n--- Refrescando Reporte Maestro de Proyección ---")
    try:
        run_report_persistence()
    except Exception as e:
        print(f"Error al refrescar reporte: {e}")
