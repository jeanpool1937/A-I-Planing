import os
import pandas as pd
import logging
import requests
import certifi
import json
import numpy as np
from datetime import datetime
from modules.api_client import get_headers, post_to_supabase, get_from_table, delete_from_table, SUPABASE_URL
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
    min_date_str = min_date.strftime('%Y-%m-%d') if isinstance(min_date, datetime) else str(min_date).split(' ')[0]
    all_signatures = set()
    
    # Usar get_from_table (abstracción local/nube)
    try:
        data = get_from_table(
            "sap_consumo_movimientos", 
            select="material_clave,fecha,cl_movimiento,centro,almacen,cantidad_final_tn",
            params={"fecha": f"gte.{min_date_str}"}
        )
        for r in data: 
            all_signatures.add(generate_signature(r))
    except Exception as e:
        logging.error(f"Error fetching existing signatures: {e}")
        
    return all_signatures

def fetch_existing_production_signatures(min_date: str):
    logging.info(f"Fetching existing production records since {min_date}...")
    min_date_str = min_date.strftime('%Y-%m-%d') if isinstance(min_date, datetime) else str(min_date).split(' ')[0]
    all_signatures = set()
    
    try:
        data = get_from_table(
            "sap_produccion",
            select="orden,fecha_contabilizacion,material",
            params={"fecha_contabilizacion": f"gte.{min_date_str}"}
        )
        for r in data: 
            all_signatures.add(generate_production_signature(r))
    except Exception as e:
        logging.error(f"Error fetching production signatures: {e}")
        
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
            data = get_from_table("sap_centro_pais", select="centro_id,pais")
            centro_pais_map = {str(item['centro_id']): item['pais'] for item in data}
        except Exception as e:
            logging.warning(f"Could not fetch centro_pais map: {e}")
            centro_pais_map = {}
        
        new_rows = []
        for _, row in df.iterrows():
            record = row.to_dict()
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
        logging.error(f"Error in sync_file: {e}")

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
        logging.error(f"Error in sync_production_file: {e}")

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
                if k == 'material':
                    val_str = str(v).strip()
                    if val_str.endswith('.0'): val_str = val_str[:-2]
                    cleaned[k] = val_str
                    continue
                if k in numeric_fields:
                    try:
                        val = float(v)
                        if pd.isna(val): val = 0.0
                    except (ValueError, TypeError):
                        val = 0.0
                    cleaned[k] = val
                else:
                    cleaned[k] = None if pd.isna(v) else v
            records.append(cleaned)

        logging.info(f"Prepared {len(records)} records for sap_stock_mb52.")
        
        if records:
            all_keys = set().union(*(d.keys() for d in records))
            for r in records:
                for k in all_keys:
                    if k not in r: r[k] = None

        if not dry_run:
            # Reemplazar requests.delete por delete_from_table
            delete_from_table("sap_stock_mb52", {"material": "not.is.null"})
            logging.info("Truncated sap_stock_mb52 successfully.")
            
            batch_size = 1000
            for i in range(0, len(records), batch_size):
                batch = records[i:i+batch_size]
                post_to_supabase("sap_stock_mb52", batch)
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
        if usecols: read_kwargs['usecols'] = usecols
        df = pd.read_excel(file_path, **read_kwargs)
        df = df.loc[:, ~df.columns.duplicated()]
        df.columns = [clean_col_func(c) for c in df.columns]
        
        if pk_col in df.columns:
            df = df.dropna(subset=[pk_col])
        else:
            logging.error(f"PK column {pk_col} not found.")
            return

        records = []
        for _, row in df.iterrows():
            r = row.to_dict()
            cleaned = {}
            for k, v in r.items():
                if pd.isna(v): 
                    cleaned[k] = None
                else:
                    if k == 'codigo' or k == 'material':
                        val = str(v).strip()
                        if val.endswith('.0'): val = val[:-2]
                        cleaned[k] = val
                    else:
                        cleaned[k] = v
            # Default country
            if 'pais' not in cleaned or not cleaned['pais']:
                cleaned['pais'] = 'Colombia' if str(cleaned.get('codigo', '')).startswith('4') else 'Peru'
            records.append(cleaned)

        # Usar delete_from_table
        delete_from_table(table_name, {pk_col: "not.is.null"})
        
        batch_size = 500
        for i in range(0, len(records), batch_size):
            post_to_supabase(table_name, records[i:i+batch_size])
        logging.info(f"Sync completed for {table_name}. Total: {len(records)}")
    except Exception as e:
        logging.error(f"Error in sync_master_data: {e}")

def sync_programa_produccion(file_path: str, dry_run: bool = False):
    logging.info(f"--- Starting Programa Produccion Sync: {file_path} ---")
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return

    try:
        df = pd.read_excel(file_path, sheet_name='BASE DATOS', usecols="A:F")
        df.columns = [clean_programa_produccion_column(c) for c in df.columns]
        if 'sku_produccion' in df.columns:
            df = df.dropna(subset=['sku_produccion'])
        if 'cantidad_programada' in df.columns:
            df = df[df['cantidad_programada'] != 0]

        records = []
        from datetime import time as dt_time
        today_str = datetime.now().strftime('%Y-%m-%d')

        for _, row in df.iterrows():
            r = row.to_dict()
            cleaned = {}
            for k, v in r.items():
                if pd.isna(v): 
                    cleaned[k] = 0 if 'cantidad' in str(k) else ""
                else:
                    if isinstance(v, (pd.Timestamp, datetime)):
                        cleaned[k] = v.strftime('%Y-%m-%d')
                    elif isinstance(v, dt_time):
                        cleaned[k] = None 
                    else:
                        cleaned[k] = v
            if 'fecha' not in cleaned or not cleaned['fecha']:
                cleaned['fecha'] = today_str
            records.append(cleaned)

        if not dry_run:
            delete_from_table("sap_programa_produccion", {"sku_produccion": "not.is.null"})
            batch_size = 1000
            for i in range(0, len(records), batch_size):
                post_to_supabase("sap_programa_produccion", records[i:i+batch_size])
            logging.info(f"Finished Programa Produccion sync. Total: {len(records)}")
    except Exception as e:
        logging.error(f"Error in sync_programa_produccion: {e}")

def sync_demanda_proyectada(file_path: str, dry_run: bool = False):
    logging.info(f"--- Starting Demanda Proyectada Sync: {file_path} ---")
    if not os.path.exists(file_path):
        logging.error(f"File not found: {file_path}")
        return

    try:
        df = pd.read_excel(file_path)
        df.columns = [clean_demanda_column(c) for c in df.columns]
        if 'sku_id' not in df.columns or 'mes' not in df.columns or 'cantidad' not in df.columns:
            logging.error(f"Required columns missing.")
            return

        df['mes'] = pd.to_datetime(df['mes'], errors='coerce')
        df = df.dropna(subset=['mes'])
        
        records = []
        for _, row in df.iterrows():
            r = row.to_dict()
            cleaned = {
                'sku_id': str(r['sku_id']).split('.')[0].lstrip('0'),
                'mes': r['mes'].strftime('%Y-%m-%d'),
                'cantidad': float(r['cantidad']) if not pd.isna(r['cantidad']) else 0.0
            }
            records.append(cleaned)

        if not dry_run:
            delete_from_table("sap_demanda_proyectada", {"sku_id": "not.is.null"})
            batch_size = 1000
            for i in range(0, len(records), batch_size):
                post_to_supabase("sap_demanda_proyectada", records[i:i+batch_size])
            logging.info(f"Finished Demanda Proyectada sync. Total: {len(records)}")
    except Exception as e:
        logging.error(f"Error in sync_demanda_proyectada: {e}")

