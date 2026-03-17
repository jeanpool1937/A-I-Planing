
import os
import sys
import logging

# Configure logging to both file and stdout
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, 'sync_demanda_log.txt')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)

sys.path.insert(0, SCRIPT_DIR)
from sync_utils import sync_demanda_proyectada

# Ruta al archivo PO Histórico en OneDrive
BASE_PATH = r"D:\OneDrive - CORPORACIÓN ACEROS AREQUIPA SA\Documentos - PCP\General"
DEMANDA_FILE = os.path.join(BASE_PATH, r"2. CONTROL\ESTADISTICA ANUAL - HISTORICO\Reporte de seguimiento y coberturas\PO Histórico.xlsx")

if __name__ == "__main__":
    print("=" * 60)
    print("  SYNC MENSUAL - Demanda Proyectada (PO Histórico)")
    print("=" * 60)
    print(f"Archivo: {DEMANDA_FILE}")
    print()
    
    if not os.path.exists(DEMANDA_FILE):
        print(f"ERROR: No se encontró el archivo: {DEMANDA_FILE}")
        print("Verifica que el archivo exista y que OneDrive esté sincronizado.")
        sys.exit(1)
    
    sync_demanda_proyectada(DEMANDA_FILE)
    
    print()
    print("=" * 60)
    print("  Sync mensual completado.")
    print(f"  Log guardado en: {LOG_FILE}")
    print("=" * 60)
