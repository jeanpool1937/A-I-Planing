import os
import requests
import pandas as pd
import numpy as np
import logging
from datetime import datetime, date
import calendar
import sys

# Añadir directorio raíz al path para importar módulos locales
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.api_client import get_headers, SUPABASE_URL, post_to_supabase

# Configuración de Logging
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, 'report_persistor_log.txt')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)

def fetch_all_paginated(table, params={}):
    all_data = []
    start, batch_size = 0, 1000
    while True:
        headers = get_headers()
        headers["Range"] = f"{start}-{start + batch_size - 1}"
        # Construir URL con parámetros
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        try:
            resp = requests.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            if not data:
                break
            all_data.extend(data)
            if len(data) < batch_size:
                break
            start += batch_size
        except Exception as e:
            logging.error(f"Error fetching {table}: {e}")
            break
    return pd.DataFrame(all_data)

def run_report_persistence():
    logging.info("--- Iniciando persistencia de Reporte Maestro ---")
    
    try:
        # 1. Configuración de Fechas
        now = datetime.now()
        current_month_str = now.strftime('%Y-%m-01')
        
        # Próximo mes
        if now.month == 12:
            next_month = date(now.year + 1, 1, 1)
        else:
            next_month = date(now.year, now.month + 1, 1)
        next_month_str = next_month.strftime('%Y-%m-01')
        
        days_in_month = calendar.monthrange(now.year, now.month)[1]
        remaining_days = max(0, days_in_month - now.day)
        
        logging.info(f"Reporte para {now.strftime('%Y-%m')}. Días restantes en mes: {remaining_days}")

        # 2. Fetch Data de Supabase
        logging.info("Descargando datos de Supabase...")
        df_maestro = fetch_all_paginated('sap_maestro_articulos', {'select': 'codigo,descripcion_material'})
        df_hibrido = fetch_all_paginated('sap_plan_inventario_hibrido', {'select': 'sku_id,adu_hibrido_final,factor_fin_mes,stock_actual'})
        
        df_demanda = fetch_all_paginated('sap_demanda_proyectada', {
            'select': 'sku_id,mes,cantidad',
            'mes': f'in.({current_month_str},{next_month_str})'
        })
        
        df_movs = fetch_all_paginated('sap_consumo_movimientos', {
            'select': 'material_clave,cantidad_final_tn,tipo2',
            'fecha': f'gte.{current_month_str}'
        })
        
        df_prod_real = fetch_all_paginated('sap_produccion', {
            'select': 'material,cantidad_tn',
            'fecha_contabilizacion': f'gte.{current_month_str}'
        })
        
        df_programa = fetch_all_paginated('sap_programa_produccion', {
            'select': 'sku_produccion,cantidad_programada',
            'fecha': f'gte.{current_month_str}'
        })

        if df_maestro.empty:
            logging.error("No se pudo obtener el maestro de artículos.")
            return

        # 3. Procesamiento y Limpieza
        logging.info("Procesando cálculos dinámicos...")

        def clean_sku(val):
            if pd.isna(val): return ""
            return str(val).split('.')[0].lstrip('0')

        # Normalizar IDs
        df_maestro['codigo'] = df_maestro['codigo'].apply(clean_sku)
        if not df_hibrido.empty: df_hibrido['sku_id'] = df_hibrido['sku_id'].apply(clean_sku)
        if not df_demanda.empty: df_demanda['sku_id'] = df_demanda['sku_id'].apply(clean_sku)
        if not df_movs.empty: df_movs['material_clave'] = df_movs['material_clave'].apply(clean_sku)
        if not df_prod_real.empty: df_prod_real['material'] = df_prod_real['material'].apply(clean_sku)
        if not df_programa.empty: df_programa['sku_produccion'] = df_programa['sku_produccion'].apply(clean_sku)

        # Agregaciones
        valid_types = ['VENTA', 'CONSUMO', 'TRASPASO']
        if not df_movs.empty:
            df_movs_filtered = df_movs[df_movs['tipo2'].str.contains('|'.join(valid_types), case=False, na=False)]
            real_venta = df_movs_filtered.groupby('material_clave')['cantidad_final_tn'].sum().reset_index()
        else:
            real_venta = pd.DataFrame(columns=['material_clave', 'cantidad_final_tn'])
        
        real_fab = df_prod_real.groupby('material')['cantidad_tn'].sum().reset_index() if not df_prod_real.empty else pd.DataFrame(columns=['material', 'cantidad_tn'])
        prog_fab = df_programa.groupby('sku_produccion')['cantidad_programada'].sum().reset_index() if not df_programa.empty else pd.DataFrame(columns=['sku_produccion', 'cantidad_programada'])

        po_actual = df_demanda[df_demanda['mes'] == current_month_str].groupby('sku_id')['cantidad'].sum().reset_index() if not df_demanda.empty else pd.DataFrame(columns=['sku_id', 'cantidad'])
        po_prox = df_demanda[df_demanda['mes'] == next_month_str].groupby('sku_id')['cantidad'].sum().reset_index() if not df_demanda.empty else pd.DataFrame(columns=['sku_id', 'cantidad'])

        # Merge Final del Reporte
        report = df_maestro.merge(df_hibrido, left_on='codigo', right_on='sku_id', how='left')
        report = report.merge(po_actual, left_on='codigo', right_on='sku_id', how='left', suffixes=('', '_po_act'))
        report = report.merge(po_prox, left_on='codigo', right_on='sku_id', how='left', suffixes=('', '_po_prox'))
        report = report.merge(real_venta, left_on='codigo', right_on='material_clave', how='left')
        report = report.merge(real_fab, left_on='codigo', right_on='material', how='left')
        report = report.merge(prog_fab, left_on='codigo', right_on='sku_produccion', how='left')

        # Llenar ceros y valores por defecto
        cols_to_zero = ['adu_hibrido_final', 'cantidad', 'cantidad_po_prox', 'cantidad_final_tn', 'cantidad_tn', 'cantidad_programada', 'stock_actual']
        for c in cols_to_zero:
            if c in report.columns:
                report[c] = report[c].fillna(0)
        if 'factor_fin_mes' in report.columns:
            report['factor_fin_mes'] = report['factor_fin_mes'].fillna(1.0)
        else:
            report['factor_fin_mes'] = 1.0

        # Cálculos de Negocio (Replicando lógica Frontend)
        report['po_mes_actual'] = report['cantidad'] if 'cantidad' in report.columns else 0
        report['stock_inicio_mes'] = report['stock_actual'] - report['cantidad_tn'] + report['cantidad_final_tn']
        report['coverage_initial'] = np.where(report['po_mes_actual'] > 0, report['stock_inicio_mes'] / report['po_mes_actual'], 0)
        report['projected_venta_consumo'] = report['adu_hibrido_final'] * remaining_days * report['factor_fin_mes']
        report['projected_fabricado'] = (report['cantidad_programada'] - report['cantidad_tn']).clip(lower=0)
        report['stock_fin_mes'] = report['stock_actual'] + report['projected_fabricado'] - report['projected_venta_consumo']
        report['po_prox_mes'] = report['cantidad_po_prox'] if 'cantidad_po_prox' in report.columns else 0
        report['coverage_final'] = np.where(report['po_prox_mes'] > 0, report['stock_fin_mes'] / report['po_prox_mes'], 0)
        report['coverage_actual'] = np.where(report['po_mes_actual'] > 0, report['stock_actual'] / report['po_mes_actual'], 0)

        # Preparación para Inserción
        final_df = report[[
            'codigo', 'descripcion_material', 'po_mes_actual', 'coverage_initial', 
            'stock_inicio_mes', 'cantidad_final_tn', 'cantidad_tn', 'stock_actual',
            'coverage_actual', 'projected_venta_consumo', 'projected_fabricado', 
            'stock_fin_mes', 'po_prox_mes', 'coverage_final'
        ]].rename(columns={
            'codigo': 'sku_id',
            'descripcion_material': 'descripcion',
            'cantidad_final_tn': 'real_venta_consumo',
            'cantidad_tn': 'real_fabricado',
            'stock_actual': 'stock_hoy'
        })

        # Sanitizar valores antes de subir (JSON no acepta NaN/Inf)
        final_df = final_df.replace([np.inf, -np.inf], 0).fillna(0)
        final_df['updated_at'] = datetime.now().isoformat()

        # 4. Actualización en Supabase (Truncate + Insert)
        logging.info("Limpiando tabla sap_reporte_maestro...")
        headers = get_headers()
        url_del = f"{SUPABASE_URL}/rest/v1/sap_reporte_maestro"
        requests.delete(url_del, headers=headers, params={"sku_id": "neq.0"})
        
        logging.info("Insertando nuevos datos consolidado...")
        records = final_df.to_dict(orient='records')
        batch_size = 500
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            post_to_supabase('sap_reporte_maestro', batch)
            logging.info(f"Subido batch {i//batch_size + 1} ({min(i+batch_size, len(records))}/{len(records)})")

        logging.info("--- Persistencia completada exitosamente ---")

    except Exception as e:
        logging.error(f"Falla crítica en run_report_persistence: {e}", exc_info=True)

if __name__ == "__main__":
    run_report_persistence()
