
import os
import sys
from sync_logger import log_sync_result

# Asegurar importación desde el directorio del script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_utils import sync_file, sync_production_file, sync_stock_mb52, sync_programa_produccion
from agents.report_master_persistor import run_report_persistence
from agents.forecast_engine import run_forecast
from agents.anomaly_detector import run_anomaly_audit

# Absolute path to the Excel files (in OneDrive)
BASE_PATH = r"D:\OneDrive - CORPORACIÓN ACEROS AREQUIPA SA\PCP - General"
CONSUMO_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\ESTADISTICA ANUAL - HISTORICO\Reporte de seguimiento y coberturas\Movimientos\ConsumoMes.xlsx")
PRODUCCION_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\ESTADISTICA ANUAL - HISTORICO\Reporte de seguimiento y coberturas\Produccion\ProduccionMes.xlsx")
MB52_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\COBERTURAS\MB52.XLSX")
PROGRAMA_FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\COBERTURAS\Planes 2025.xlsm")

# NOTA: La demanda proyectada (PO Histórico.xlsx) se sincroniza MENSUALMENTE
# a mediados de mes, NO en el sync diario. Ver tarea separada para monthly_sync.

def run_step(label: str, table_name: str, fn, *args):
    """Ejecuta un paso de sincronización y registra el resultado."""
    print(f"\n--- {label} ---")
    try:
        result = fn(*args)
        # Las funciones de sync_utils no retornan el conteo directamente,
        # así que lo consultamos desde el log de sincronización.
        # Por ahora registramos filas=0 como "éxito sin conteo exacto".
        # TODO: refactorizar sync_utils para retornar el conteo de filas.
        rows = result if isinstance(result, int) else 0
        log_sync_result(table_name=table_name, rows_upserted=rows, status="success")
        print(f"  ✓ {label} completado. Filas: {rows}")
    except Exception as e:
        print(f"  ✗ Error en {label}: {e}")
        log_sync_result(table_name=table_name, rows_upserted=0, status="error", error_msg=str(e)[:500])


if __name__ == "__main__":
    print("=== Iniciando Sincronización Diaria ===")

    run_step("Syncing Consumo Diario",         "sap_consumo_movimientos",  sync_file,              CONSUMO_FILE_PATH, False)
    run_step("Syncing Produccion Diario",      "sap_produccion",           sync_production_file,   PRODUCCION_FILE_PATH)
    run_step("Syncing Programa Produccion",    "sap_programa_produccion",  sync_programa_produccion, PROGRAMA_FILE_PATH)
    run_step("Syncing Stock MB52",             "sap_stock_mb52",           sync_stock_mb52,        MB52_FILE_PATH)

    print("\n--- Refrescando Reporte Maestro de Proyección ---")
    try:
        run_report_persistence()
        log_sync_result(table_name="sap_reporte_maestro", rows_upserted=0, status="success")
        print("  ✓ Reporte Maestro completado.")
    except Exception as e:
        print(f"  ✗ Error al refrescar reporte: {e}")
        log_sync_result(table_name="sap_reporte_maestro", rows_upserted=0, status="error", error_msg=str(e)[:500])

    print("\n--- Generando Pronósticos Híbridos (90 días) ---")
    try:
        forecast_count = run_forecast()
        log_sync_result(table_name="sap_pronostico_diario", rows_upserted=forecast_count or 0, status="success")
        print(f"  ✓ Pronósticos generados: {forecast_count} registros.")
    except Exception as e:
        print(f"  ✗ Error al generar pronósticos: {e}")
        log_sync_result(table_name="sap_pronostico_diario", rows_upserted=0, status="error", error_msg=str(e)[:500])

    print("\n--- Auditoría de IA: Detección de Anomalías ---")
    try:
        anomaly_count = run_anomaly_audit()
        log_sync_result(table_name="ai_anomaly_alerts", rows_upserted=anomaly_count or 0, status="success")
        print(f"  ✓ Auditoría completada: {anomaly_count} anomalías detectadas.")
    except Exception as e:
        print(f"  ✗ Error en auditoría de IA: {e}")
        log_sync_result(table_name="ai_anomaly_alerts", rows_upserted=0, status="error", error_msg=str(e)[:500])

    print("\n=== Sincronización Diaria Completada ===")
