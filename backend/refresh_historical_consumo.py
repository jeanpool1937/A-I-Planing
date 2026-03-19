
import os
import pandas as pd
import logging
import sys
from datetime import datetime

# Añadir directorio del script y raíz al path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)
sys.path.append(os.path.abspath(os.path.join(SCRIPT_DIR, ".")))

from sync_utils import (
    cleanup_column_names, 
    parse_date
)
from modules.api_client import get_from_table, post_to_supabase, delete_from_table

# Configuration
SOURCE_FILENAME = "Consumo 2020-2025.xlsx"
BASE_PATH = r"D:\OneDrive - CORPORACIÓN ACEROS AREQUIPA SA\Documentos - PCP\General"
FILE_PATH = os.path.join(BASE_PATH, r"2. CONTROL\ESTADISTICA ANUAL - HISTORICO\Reporte de seguimiento y coberturas\Movimientos", SOURCE_FILENAME)
SYNC_START_DATE = '2025-01-01'

# Logging
LOG_FILE = os.path.join(SCRIPT_DIR, 'refresh_consumo_log.txt')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

def delete_old_records_from_file(filename_xlsx):
    """Elimina registros previos asociados a este archivo (soporta Local/Cloud via router)."""
    filename_csv = filename_xlsx.replace('.xlsx', '.csv')
    
    success = True
    for fname in [filename_xlsx, filename_csv]:
        logging.info(f"Intentando eliminar registros para source_file: {fname}...")
        params = {"source_file": f"eq.{fname}"}
        try:
            resp = delete_from_table("sap_consumo_movimientos", params=params)
            # En modo local delete_from_table no retorna response sino None si es exitoso
            # En modo nube retorna response de requests
        except Exception as e:
            logging.error(f"Error crítico eliminando {fname}: {e}")
            success = False
    return success

def refresh_data():
    logging.info("--- Iniciando refresco de Consumo Histórico ---")
    
    if not os.path.exists(FILE_PATH):
        logging.error(f"Archivo no encontrado: {FILE_PATH}")
        return

    # 1. Eliminar registros antiguos
    if not delete_old_records_from_file(SOURCE_FILENAME):
        logging.error("Falla al limpiar registros previos. Abortando para evitar duplicados.")
        return

    # 2. Procesar Archivo
    logging.info(f"Leyendo Excel: {FILE_PATH}")
    try:
        # Buscar encabezado dinámico
        df_preview = pd.read_excel(FILE_PATH, header=None, nrows=10)
        header_row_index = 0
        for i, row in df_preview.iterrows():
            row_str = " ".join([str(x) for x in row.values]).lower()
            if "material" in row_str and "centro" in row_str:
                header_row_index = i
                break
        
        df = pd.read_excel(FILE_PATH, header=header_row_index)
        logging.info(f"Leídas {len(df)} filas.")

        # Limpieza y Parseo
        df = cleanup_column_names(df)
        df['fecha_parsed'] = df['fecha'].apply(parse_date)
        df = df.dropna(subset=['fecha_parsed'])
        
        def to_iso_date(val):
            if isinstance(val, datetime):
                return val.strftime('%Y-%m-%d')
            return str(val)[:10]

        df['fecha_str'] = df['fecha_parsed'].apply(to_iso_date)
        df_filtered = df[df['fecha_str'] >= SYNC_START_DATE].copy()

        logging.info(f"Filtradas {len(df_filtered)} filas con fecha >= {SYNC_START_DATE}")

        if df_filtered.empty:
            logging.warning("No se encontraron registros tras filtrar por fecha.")
            return

        # Preparar registros para el upsert
        records = []
        for _, row in df_filtered.iterrows():
            qty = row['cantidad_final_tn']
            if pd.isna(qty): qty = 0
            
            records.append({
                'material_clave': str(row['material_clave']),
                'material_texto': str(row['material_texto']),
                'unidad_medida': str(row['unidad_medida']),
                'fecha': row['fecha_str'],
                'cl_movimiento': str(row['cl_movimiento']),
                'tipo2': str(row['tipo2']),
                'cantidad_final_tn': float(qty),
                'centro': str(row['centro']),
                'almacen': str(row['almacen']),
                'source_file': SOURCE_FILENAME
            })

        # 3. Subir vía Router
        batch_size = 1000
        total_uploaded = 0
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            post_to_supabase('sap_consumo_movimientos', batch)
            total_uploaded += len(batch)
            logging.info(f"Procesados {total_uploaded}/{len(records)}")
        
        logging.info("Refresco completo exitosamente.")

    except Exception as e:
        logging.error(f"Error durante el proceso: {e}")

if __name__ == "__main__":
    refresh_data()
