import os
import pandas as pd
import logging
import requests
import json
import numpy as np
from datetime import datetime
from modules.api_client import get_headers, post_to_supabase, SUPABASE_URL
from modules.transformers import *
from modules.validators import generate_signature, generate_production_signature

# Configure logging
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, 'sync_log.txt')
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

def fetch_existing_signatures(min_date: str):
    logging.info(f"Fetching existing records since {min_date}...")
    url = f"{SUPABASE_URL}/rest/v1/sap_consumo_movimientos"
    min_date_str = min_date.strftime('%Y-%m-%d') if isinstance(min_date, datetime) else str(min_date).split(' ')[0]
    all_signatures = set()
    start, batch_size = 0, 1000
    while True:
        headers = get_headers()
        headers["Range"] = f"{start}-{start + batch_size - 1}"
        params = {
            "select": "material_clave,fecha,cl_movimiento,centro,almacen,cantidad_final_tn", 
            "fecha": f"gte.{min_date_str}"
        }
        resp = requests.get(url, headers=headers, params=params)
        if resp.status_code != 200: 
            raise Exception(f"API Error {resp.status_code}: {resp.text}")
        data = resp.json()
        if not data: 
            break
        for r in data: 
            all_signatures.add(generate_signature(r))
        if len(data) < batch_size: 
            break
        start += batch_size
    return all_signatures

def fetch_existing_production_signatures(min_date: str):
    logging.info(f"Fetching existing production records since {min_date}...")
    url = f"{SUPABASE_URL}/rest/v1/sap_produccion"
    min_date_str = min_date.strftime('%Y-%m-%d') if isinstance(min_date, datetime) else str(min_date).split(' ')[0]
    all_signatures = set()
    start, batch_size = 0, 1000
    while True:
        headers = get_headers()
        headers["Range"] = f"{start}-{start + batch_size - 1}"
        params = {
            "select": "orden,fecha_contabilizacion,material", 
            "fecha_contabilizacion": f"gte.{min_date_str}"
        }
        resp = requests.get(url, headers=headers, params=params)
        if resp.status_code != 200: 
            raise Exception(f"API Error {resp.status_code}: {resp.text}")
        data = resp.json()
        if not data: 
            break
        for r in data: 
            all_signatures.add(generate_production_signature(r))
        if len(data) < batch_size: 
            break
        start += batch_size
    return all_signatures

def sync_file(file_path: str, is_historical: bool = False, dry_run: bool = False):
    logging.info(f"--- Starting Sync: {file_path} ---")
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return

    try:
        df = pd.read_excel(file_path, header=1)
        df = cleanup_column_names(df)
        df['fecha'] = df['fecha'].apply(parse_date)
        df = df.dropna(subset=['fecha'])
        
        if df.empty:
            logging.info("No valid records found in file.")
            return

        existing_signatures = fetch_existing_signatures(df['fecha'].min())
        
        # Mapping de países
        try:
            cp_resp = requests.get(f"{SUPABASE_URL}/rest/v1/sap_centro_pais?select=centro_id,pais", headers=get_headers())
            centro_pais_map = {str(item['centro_id']): item['pais'] for item in cp_resp.json()} if cp_resp.status_code == 200 else {}
        except Exception as e:
            logging.warning(f"Could not fetch centro_pais map: {e}")
            centro_pais_map = {}
        
        new_rows = []
        for _, row in df.iterrows():
            record = row.to_dict()
            # record['pais'] = centro_pais_map.get(str(record.get('centro')), 'Peru') # Column not in DB
            # Normalize numeric fields and dates
            for k, v in record.items():
                if pd.isna(v): 
                    record[k] = None
                elif hasattr(v, 'strftime'):
                    record[k] = v.strftime('%Y-%m-%d')
            
            if generate_signature(record) not in existing_signatures:
                new_rows.append(record)
        
        if new_rows and not dry_run:
            batch_size = 1000
            for i in range(0, len(new_rows), batch_size):
                batch = new_rows[i:i+batch_size]
                post_to_supabase("sap_consumo_movimientos", batch)
                logging.info(f"Uploaded batch {i} - {i+len(batch)}")
            logging.info(f"Finished. Total uploaded: {len(new_rows)}")
        else:
            logging.info("No new rows to upload.")
            
    except Exception as e: 
        err_msg = str(e)
        if hasattr(e, 'response') and e.response is not None:
            err_msg += f" Response: {e.response.text}"
        logging.error(f"Error in sync_file: {err_msg}")

def sync_production_file(file_path: str, dry_run: bool = False):
    logging.info(f"--- Starting Production Sync: {file_path} ---")
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return

    try:
        df = pd.read_excel(file_path, header=3)
        # Rename columns
        df.columns = [clean_production_column_name(c) or c for c in df.columns]
        
        if 'fecha_contabilizacion' not in df.columns:
            logging.error("Column 'fecha_contabilizacion' not found after cleaning.")
            return

        df['fecha_contabilizacion'] = df['fecha_contabilizacion'].apply(parse_date)
        df = df.dropna(subset=['fecha_contabilizacion'])
        
        if df.empty:
            logging.info("No valid records found.")
            return

        existing_signatures = fetch_existing_production_signatures(df['fecha_contabilizacion'].min())
        
        new_rows = []
        for _, row in df.iterrows():
            record = row.to_dict()
            # Clean record
            cleaned_record = {}
            for k, v in record.items():
                if str(k).startswith('Unnamed'): continue
                if pd.isna(v): 
                    cleaned_record[k] = None
                elif hasattr(v, 'strftime'):
                    cleaned_record[k] = v.strftime('%Y-%m-%d %H:%M:%S') if 'creado' in k.lower() else v.strftime('%Y-%m-%d')
                else:
                    cleaned_record[k] = v
            
            # Ensure mapped columns logic if needed (Assuming standard columns match DB)
            
            if generate_production_signature(cleaned_record) not in existing_signatures:
                new_rows.append(cleaned_record)

        if new_rows and not dry_run:
            batch_size = 1000
            for i in range(0, len(new_rows), batch_size):
                batch = new_rows[i:i+batch_size]
                post_to_supabase("sap_produccion", batch)
                logging.info(f"Uploaded production batch {i}")
            logging.info(f"Finished Production sync. Total: {len(new_rows)}")
        else:
            logging.info("No new production rows.")

    except Exception as e:
        err_msg = str(e)
        if hasattr(e, 'response') and e.response is not None:
            err_msg += f" Response: {e.response.text}"
        logging.error(f"Error in sync_production_file: {err_msg}")

def sync_stock_mb52(file_path: str, dry_run: bool = False):
    logging.info(f"--- Starting Stock MB52 Sync: {file_path} ---")
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return

    try:
        df = pd.read_excel(file_path)
        # Rename columns
        df.columns = [clean_mb52_column_name(c) for c in df.columns]
        
        allowed_columns = {
            'material', 'texto_material', 'centro', 'almacen', 
            'tipo_material', 'unidad_medida', 'grupo_articulos', 
            'libre_utilizacion', 'transito_traslado', 'inspeccion_calidad', 
            'stock_no_libre', 'bloqueado', 'stock_en_transito'
        }
        numeric_fields = {
            'libre_utilizacion', 'transito_traslado', 'inspeccion_calidad', 
            'stock_no_libre', 'bloqueado', 'stock_en_transito'
        }

        records = []
        for _, row in df.iterrows():
            r = row.to_dict()
            cleaned = {}
            for k, v in r.items():
                if k not in allowed_columns: continue
                
                # Special handling for material ID (remove .0 suffix if present)
                if k == 'material':
                    val_str = str(v).strip()
                    if val_str.endswith('.0'): val_str = val_str[:-2]
                    cleaned[k] = val_str
                    continue

                # Numeric coercion
                if k in numeric_fields:
                    try:
                        val = float(v)
                        if pd.isna(val): val = 0.0
                    except (ValueError, TypeError):
                        val = 0.0
                    cleaned[k] = val
                else:
                    if pd.isna(v): 
                        cleaned[k] = None
                    else:
                        cleaned[k] = v
            records.append(cleaned)

        logging.info(f"Prepared {len(records)} records for sap_stock_mb52.")
        
        # Normalize records keys to satisfy PostgREST PGRST102
        if records:
            all_keys = set().union(*(d.keys() for d in records))
            for r in records:
                for k in all_keys:
                    if k not in r:
                        r[k] = None

        if not dry_run:
            # Truncate logic: Delete all rows
            del_url = f"{SUPABASE_URL}/rest/v1/sap_stock_mb52"
            requests.delete(del_url, headers=get_headers(), params={"id": "gt.0"})
            logging.info("Truncated sap_stock_mb52 successfully.")
            
            batch_size = 1000
            for i in range(0, len(records), batch_size):
                batch = records[i:i+batch_size]
                try:
                    post_to_supabase("sap_stock_mb52", batch)
                except Exception as e:
                    err_msg = str(e)
                    if hasattr(e, 'response') and e.response is not None:
                        err_msg += f" Response: {e.response.text}"
                    logging.error(f"Error uploading MB52 batch {i}: {err_msg}")
            logging.info(f"Finished MB52 sync. Total uploaded: {len(records)}")

    except Exception as e:
        logging.error(f"Error in sync_stock_mb52: {e}")


def sync_master_data(file_path, sheet_name, table_name, clean_col_func, pk_col, usecols=None):
    logging.info(f"--- Starting Sync for {table_name} from {sheet_name} ---")
    
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return

    try:
        read_kwargs = {'sheet_name': sheet_name}
        if usecols:
            read_kwargs['usecols'] = usecols
            
        df = pd.read_excel(file_path, **read_kwargs)
        
        # Eliminar columnas duplicadas
        df = df.loc[:, ~df.columns.duplicated()]
        
        # Renombrar columnas
        df.columns = [clean_col_func(c) for c in df.columns]
        
        # Filtrar filas sin PK
        if pk_col in df.columns:
            df = df.dropna(subset=[pk_col])
        else:
            logging.error(f"PK column {pk_col} not found. Cols: {df.columns.tolist()}")
            return

        # Limpiar datos
        records = []
        for _, row in df.iterrows():
            r = row.to_dict()
            cleaned = {}
            for k, v in r.items():
                if pd.isna(v): 
                    cleaned[k] = None
                else:
                    # Normalizar IDs de material (quitar .0)
                    if k == 'codigo' or k == 'material':
                        val = str(v).strip()
                        if val.endswith('.0'): val = val[:-2]
                        cleaned[k] = val
                    else:
                        cleaned[k] = v
            
            # Lógica de País: Si no viene en el Excel, intentar deducir o poner default
            # Pero en este sistema, el país es vital. Si el código empieza por '4', suele ser Colombia para BACO.
            if 'pais' not in cleaned or not cleaned['pais']:
                if str(cleaned.get('codigo', '')).startswith('4'):
                    cleaned['pais'] = 'Colombia'
                else:
                    cleaned['pais'] = 'Peru'
            
            records.append(cleaned)

        if not dry_run:
            # Upsert logic (insert or update)
            # Para el maestro solemos truncar y recargar si es pequeño, 
            # pero aquí usaremos una estrategia de limpieza previa para evitar duplicados si la PK cambia
            del_url = f"{SUPABASE_URL}/rest/v1/{table_name}"
            # Truncado opcional o Upsert. El usuario suele preferir ver datos frescos.
            requests.delete(del_url, headers=get_headers(), params={"id": "gt.0"})
            
            batch_size = 500
            for i in range(0, len(records), batch_size):
                batch = records[i:i+batch_size]
                post_to_supabase(table_name, batch)
            logging.info(f"Sync completed for {table_name}. Total: {len(records)}")

    except Exception as e:
        logging.error(f"Error in sync_master_data: {e}")

def sync_programa_produccion(file_path: str, dry_run: bool = False):
    logging.info(f"--- Starting Programa Produccion Sync: {file_path} ---")
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return

    try:
        # Based on previous task description for Planes 2025.xlsm
        # Read 'BASE DATOS', cols A-F
        df = pd.read_excel(file_path, sheet_name='BASE DATOS', usecols="A:F")
        df.columns = [clean_programa_produccion_column(c) for c in df.columns]
        
        # Cleaning: Remove where sku_produccion is null or cantidad_programada is 0
        if 'sku_produccion' in df.columns:
            df = df.dropna(subset=['sku_produccion'])
        
        if 'cantidad_programada' in df.columns:
            df = df[df['cantidad_programada'] != 0]

        records = []
        from datetime import time as dt_time # Import specifically for check
        today_str = datetime.now().strftime('%Y-%m-%d')

        for _, row in df.iterrows():
            r = row.to_dict()
            cleaned = {}
            for k, v in r.items():
                if pd.isna(v): 
                    cleaned[k] = 0 if 'cantidad' in str(k) else ""
                else:
                    # Fix datetime/time serialization
                    if isinstance(v, (pd.Timestamp, datetime)):
                        cleaned[k] = v.strftime('%Y-%m-%d')
                    elif isinstance(v, dt_time):
                        cleaned[k] = None 
                    else:
                        cleaned[k] = v
            # Fallback for fecha if missing/invalid
            if 'fecha' not in cleaned or not cleaned['fecha']:
                cleaned['fecha'] = today_str
            
            records.append(cleaned)

        logging.info(f"Prepared {len(records)} records for sap_programa_produccion.")

        if not dry_run:
            del_url = f"{SUPABASE_URL}/rest/v1/sap_programa_produccion"
            requests.delete(del_url, headers=get_headers(), params={"id": "gt.0"})
            logging.info("Truncated sap_programa_produccion successfully.")
            
            batch_size = 1000
            for i in range(0, len(records), batch_size):
                batch = records[i:i+batch_size]
                try:
                    post_to_supabase("sap_programa_produccion", batch)
                except Exception as e:
                    err_msg = str(e)
                    if hasattr(e, 'response') and e.response is not None:
                        err_msg += f" Response: {e.response.text}"
                    logging.error(f"Error uploading Program batch {i}: {err_msg}")
            logging.info(f"Finished Programa Produccion sync. Total: {len(records)}")

    except Exception as e:
        logging.error(f"Error in sync_programa_produccion: {e}")

