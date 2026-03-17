
import os
import pandas as pd
import logging
from sync_utils import (
    sync_master_data,
    clean_articulos_column_name
)

# Configuración de logs básica para este script
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Path absoluto al Maestro de Artículos
MAESTRO_FILE_PATH = r"D:\OneDrive - CORPORACIÓN ACEROS AREQUIPA SA\Documentos - PCP\General\2. CONTROL\COBERTURAS\Maestro de Articulos.xlsx"

if __name__ == "__main__":
    print("\n--- Sincronizando Únicamente Maestro de Artículos (Lead Time) ---")
    
    if not os.path.exists(MAESTRO_FILE_PATH):
        print(f"ERROR: No se encontró el archivo en {MAESTRO_FILE_PATH}")
    else:
        sync_master_data(
            MAESTRO_FILE_PATH, 
            sheet_name='Articulos', 
            table_name='sap_maestro_articulos',
            clean_col_func=clean_articulos_column_name,
            pk_col='codigo'
        )
        print("\n--- Sincronización del Maestro Completada ---")
