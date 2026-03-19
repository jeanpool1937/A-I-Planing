
import logging
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os

# Añadir directorio raíz al path para importar módulos locales
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from modules.api_client import get_from_table, post_to_supabase

# Configuración de Logging
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, 'inventory_engine_log.txt')
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)

def run_hybrid_planning_engine():
    logging.info("--- Iniciando Motor de Planificación Híbrida (Modo Universal) ---")
    
    # 1. Obtener Maestro de Artículos (SKUs y Lead Times)
    sku_master = fetch_sku_master()
    if not sku_master:
        logging.error("No se pudo obtener el maestro de artículos.")
        return

    # 2. Obtener Mapeo de Centros a Países
    centro_pais_map = fetch_centro_pais_map()

    # 3. Obtener Stock Actual (MB52) por País
    stock_data = fetch_current_stock_by_country(centro_pais_map)

    # 4. Obtener Historial de Movimientos (Últimos 12 meses para FEI y ADU) con País
    movements = fetch_historical_movements_with_country(centro_pais_map, days=365)
    if movements.empty:
        logging.error("No hay movimientos suficientes para el cálculo.")
        return

    # 5. Procesamiento por (SKU, País)
    plan_records = []
    
    # Identificar todas las combinaciones SKU-País activas en movimientos o stock
    active_combinations = movements[['material_clave', 'pais']].drop_duplicates()
    
    for _, row in active_combinations.iterrows():
        sku_id = row['material_clave']
        pais = row['pais']
        
        master_info = sku_master.get(sku_id)
        if not master_info: continue

        sku_country_movs = movements[(movements['material_clave'] == sku_id) & (movements['pais'] == pais)]
        
        # A. ADU Mensual 6M (Estabilidad)
        adu_6m = calculate_adu_6m(sku_id, pais) 

        # B. ADU Diario L30D (Reactividad)
        adu_l30d = calculate_adu_l30d(sku_country_movs)

        # C. ADU Híbrido Final (Ponderado)
        adu_hibrido = (adu_6m * 0.4) + (adu_l30d * 0.6)

        # D. Desviación Estándar (90 días)
        std_dev = calculate_std_dev_90d(sku_country_movs)

        # E. Factor Fin de Mes (FEI)
        fei = calculate_seasonality_factor(sku_country_movs)

        # F. Parámetros de Inventario
        lt = float(master_info.get('lead_time') or 7)
        z_score = 1.65 # 95% Nivel de Servicio
        
        ss = z_score * std_dev * (lt ** 0.5)
        
        # ROP Dinámico
        today_day = datetime.now().day
        if today_day > 22:
            rop = (adu_hibrido * lt * fei) + ss
        else:
            rop = (adu_hibrido * lt) + ss

        current_stock = stock_data.get((sku_id, pais), 0)
        
        plan_records.append({
            "sku_id": sku_id,
            "pais": pais,
            "descripcion": master_info.get('descripcion_material'),
            "familia": master_info.get('jerarquia_nivel_2'),
            "adu_mensual_6m": float(adu_6m),
            "adu_diario_l30d": float(adu_l30d),
            "adu_hibrido_final": float(adu_hibrido),
            "desv_std_diaria": float(std_dev),
            "factor_fin_mes": float(fei),
            "stock_seguridad": float(ss),
            "punto_reorden": float(rop),
            "stock_actual": float(current_stock),
            "estado_critico": bool(current_stock < ss),
            "updated_at": datetime.now().isoformat()
        })

    # 6. Upsert usando router central
    if plan_records:
        logging.info(f"Guardando {len(plan_records)} registros de planificación...")
        post_to_supabase('sap_plan_inventario_hibrido', plan_records)
    
    logging.info(f"--- Motor finalizado. {len(plan_records)} combinaciones SKU-País procesadas. ---")

def fetch_sku_master():
    data = get_from_table('sap_maestro_articulos', select="codigo,descripcion_material,jerarquia_nivel_2,lead_time", limit=10000)
    if data:
        return {item['codigo']: item for item in data}
    return {}

def fetch_centro_pais_map():
    data = get_from_table('sap_centro_pais', select="centro_id,pais", limit=500)
    if data:
        return {str(item['centro_id']): item['pais'] for item in data}
    return {}

def fetch_current_stock_by_country(centro_pais_map):
    data = get_from_table('sap_stock_mb52', select="material,centro,libre_utilizacion", limit=20000)
    stock_map = {}
    if data:
        for item in data:
            m = item['material']
            centro = str(item['centro'])
            pais = centro_pais_map.get(centro, 'Desconocido')
            val = float(item['libre_utilizacion'] or 0)
            key = (m, pais)
            stock_map[key] = stock_map.get(key, 0) + val
    return stock_map

def fetch_historical_movements_with_country(centro_pais_map, days=365):
    start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    # Nota: PostgREST (Supabase) usa ilike para strings, pg_client también lo soporta.
    data = get_from_table(
        'sap_consumo_movimientos', 
        select="material_clave,fecha,cantidad_final_tn,centro",
        params={
            "fecha": f"gte.{start_date}",
            "tipo2": "ilike.*Venta*"
        },
        limit=50000
    )
    if data:
        df = pd.DataFrame(data)
        if not df.empty:
            df['pais'] = df['centro'].astype(str).map(lambda x: centro_pais_map.get(x, 'Desconocido'))
        return df
    return pd.DataFrame()

def calculate_adu_6m(sku_id, pais):
    data = get_from_table(
        'sap_consumo_sku_mensual',
        params={
            "sku_id": f"eq.{sku_id}", 
            "pais": f"eq.{pais}"
        },
        select="cantidad_total_tn",
        order="mes.desc",
        limit=6
    )
    if data:
        vals = [float(x['cantidad_total_tn']) for x in data]
        return (sum(vals) / 6) / 30 if vals else 0
    return 0

def calculate_adu_l30d(df_sku_country):
    if df_sku_country.empty: return 0
    cutoff = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
    today = datetime.now().strftime('%Y-%m-%d')
    mask = (df_sku_country['fecha'] >= cutoff) & (df_sku_country['fecha'] < today)
    recent = df_sku_country[mask]
    return float(recent['cantidad_final_tn'].abs().sum() / 30)

def calculate_std_dev_90d(df_sku_country):
    if df_sku_country.empty: return 0
    df_sku_country = df_sku_country.copy()
    df_sku_country['fecha_dt'] = pd.to_datetime(df_sku_country['fecha'])
    cutoff_dt = datetime.now() - timedelta(days=90)
    cutoff_str = cutoff_dt.strftime('%Y-%m-%d')
    
    daily = df_sku_country[df_sku_country['fecha'] >= cutoff_str].groupby('fecha_dt')['cantidad_final_tn'].sum().abs()
    if daily.empty: return 0
    
    idx = pd.date_range(start=cutoff_str, end=datetime.now().strftime('%Y-%m-%d'), freq='D')
    daily = daily.reindex(idx, fill_value=0)
    return float(daily.std())

def calculate_seasonality_factor(df_sku_country):
    if df_sku_country.empty: return 1.0
    df_sku_country = df_sku_country.copy()
    df_sku_country['fecha_dt'] = pd.to_datetime(df_sku_country['fecha'])
    df_sku_country['day'] = df_sku_country['fecha_dt'].dt.day
    
    eom_mask = (df_sku_country['day'] >= 23)
    eom_sales = df_sku_country[eom_mask]['cantidad_final_tn'].abs().mean()
    normal_sales = df_sku_country[~eom_mask]['cantidad_final_tn'].abs().mean()
    
    if pd.isna(normal_sales) or normal_sales == 0 or pd.isna(eom_sales): return 1.0
    factor = eom_sales / normal_sales
    return max(1.0, float(factor))

if __name__ == "__main__":
    run_hybrid_planning_engine()
