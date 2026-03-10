"""
forecast_engine.py
Motor de Pronósticos Híbrido para el Sistema Integrado de PCP.
Genera pronósticos diarios a 90 días por SKU combinando datos históricos
con planes comerciales/producción, seleccionando automáticamente el método
según la segmentación ABC/XYZ.

Ejecución: py -3 backend/agents/forecast_engine.py
"""

import os
import sys
import math
import logging
import requests
import numpy as np
import pandas as pd
from datetime import datetime, date, timedelta
import calendar

# --- Path setup ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
sys.path.insert(0, BACKEND_DIR)

from modules.api_client import get_headers, SUPABASE_URL, post_to_supabase
from sync_logger import log_sync_result

# --- Logging ---
LOG_FILE = os.path.join(SCRIPT_DIR, 'forecast_engine_log.txt')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)

# =============================================================================
# CONFIGURACIÓN DE SEGMENTOS ABC/XYZ
# =============================================================================
# (abc, xyz): (peso_plan, peso_historico, metodo_historico)
SEGMENT_CONFIG = {
    ('A', 'X'): (0.6, 0.4, 'WMA'),
    ('A', 'Y'): (0.4, 0.6, 'SES'),
    ('A', 'Z'): (0.3, 0.7, 'CROSTON'),
    ('B', 'X'): (0.5, 0.5, 'WMA'),
    ('B', 'Y'): (0.4, 0.6, 'SES'),
    ('B', 'Z'): (0.3, 0.7, 'CROSTON'),
    ('C', 'X'): (0.7, 0.3, 'WMA'),
    ('C', 'Y'): (0.7, 0.3, 'WMA'),
    ('C', 'Z'): (0.7, 0.3, 'CROSTON'),
}

# Valores por defecto si el segmento no está mapeado
DEFAULT_SEGMENT = (0.5, 0.5, 'WMA')

HORIZON_DAYS = 90
SES_ALPHA = 0.2
WMA_WEIGHTS = [3, 2, 1]  # Último mes, penúltimo, antepenúltimo
BATCH_SIZE = 500


def safe_float(val, default=0.0):
    """Convierte a float seguro, reemplazando NaN/Inf/None por el default."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


# =============================================================================
# FUNCIONES DE DESCARGA DE DATOS
# =============================================================================

def fetch_all_paginated(table, params=None, select='*'):
    """Descarga todos los registros de una tabla con paginación automática."""
    if params is None:
        params = {}
    params['select'] = select
    all_data = []
    start, batch_size = 0, 1000
    while True:
        headers = get_headers()
        headers["Range"] = f"{start}-{start + batch_size - 1}"
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
            logging.error(f"Error descargando {table}: {e}")
            break
    return pd.DataFrame(all_data) if all_data else pd.DataFrame()


def fetch_source_data():
    """Descarga todas las fuentes de datos necesarias para el pronóstico."""
    logging.info("Descargando datos fuente de Supabase...")

    now = datetime.now()
    today_str = now.strftime('%Y-%m-01')

    # 1. Consumo mensual histórico (últimos 12 meses)
    twelve_months_ago = (now - timedelta(days=365)).strftime('%Y-%m-01')
    df_consumo_mensual = fetch_all_paginated(
        'sap_consumo_sku_mensual',
        {'mes': f'gte.{twelve_months_ago}'},
        'sku_id,mes,tipo2,cantidad_total_tn'
    )
    logging.info(f"  Consumo mensual: {len(df_consumo_mensual)} registros")

    # 2. Consumo diario resumen (últimos 90 días para WMA reactiva/SES) con limpieza de IA
    ninety_days_ago = (now - timedelta(days=90)).strftime('%Y-%m-%d')
    df_consumo_diario = fetch_all_paginated(
        'sap_consumo_diario_clean',
        {'fecha': f'gte.{ninety_days_ago}'},
        'sku_id,fecha,cantidad_limpia'
    )
    logging.info(f"  Consumo diario (limpio): {len(df_consumo_diario)} registros")

    # 3. Producción real (últimos 180 días)
    six_months_ago = (now - timedelta(days=180)).strftime('%Y-%m-%d')
    df_produccion = fetch_all_paginated(
        'sap_produccion',
        {'fecha_contabilizacion': f'gte.{six_months_ago}'},
        'material,cantidad_tn,fecha_contabilizacion'
    )
    logging.info(f"  Producción real: {len(df_produccion)} registros")

    # 4. Demanda proyectada (plan comercial, meses actuales y futuros)
    df_demanda = fetch_all_paginated(
        'sap_demanda_proyectada',
        {'mes': f'gte.{today_str}'},
        'sku_id,mes,cantidad'
    )
    logging.info(f"  Demanda proyectada: {len(df_demanda)} registros")

    # 5. Programa de producción (mes vigente)
    first_day = now.replace(day=1).strftime('%Y-%m-%d')
    last_day_num = calendar.monthrange(now.year, now.month)[1]
    last_day = now.replace(day=last_day_num).strftime('%Y-%m-%d')
    df_programa = fetch_all_paginated(
        'sap_programa_produccion',
        {'fecha': f'gte.{first_day}', 'fecha': f'lte.{last_day}'},
        'fecha,sku_produccion,sku_consumo,cantidad_programada'
    )
    # Re-fetch con rango correcto (PostgREST no soporta doble param igual)
    prog_params = {'select': 'fecha,sku_produccion,sku_consumo,cantidad_programada'}
    prog_url = f"{SUPABASE_URL}/rest/v1/sap_programa_produccion?fecha=gte.{first_day}&fecha=lte.{last_day}"
    try:
        resp = requests.get(prog_url, headers=get_headers())
        resp.raise_for_status()
        df_programa = pd.DataFrame(resp.json()) if resp.json() else pd.DataFrame()
    except Exception as e:
        logging.warning(f"Error descargando programa: {e}")
        df_programa = pd.DataFrame()
    logging.info(f"  Programa producción: {len(df_programa)} registros")

    # 6. Segmentación ABC/XYZ y factor estacionalidad
    df_segmentos = fetch_all_paginated(
        'sap_plan_inventario_hibrido',
        {},
        'sku_id,abc_segment,xyz_segment,factor_fin_mes,adu_hibrido_final'
    )
    logging.info(f"  Segmentos ABC/XYZ: {len(df_segmentos)} registros")

    return {
        'consumo_mensual': df_consumo_mensual,
        'consumo_diario': df_consumo_diario,
        'produccion': df_produccion,
        'demanda': df_demanda,
        'programa': df_programa,
        'segmentos': df_segmentos,
    }


# =============================================================================
# MÉTODOS DE PRONÓSTICO
# =============================================================================

def calculate_wma(monthly_values):
    """
    Media Móvil Ponderada (Weighted Moving Average).
    Recibe una lista de valores mensuales ordenados cronológicamente.
    Usa pesos 3:2:1 (más reciente = más peso) sobre los últimos 3 meses.
    Retorna ADU diario.
    """
    if not monthly_values or len(monthly_values) == 0:
        return 0.0

    # Tomar los últimos 3 meses (o los que haya)
    recent = monthly_values[-3:]
    weights = WMA_WEIGHTS[:len(recent)]
    # Invertir para que el último valor tenga el peso más alto
    weights = weights[:len(recent)]

    weighted_sum = sum(v * w for v, w in zip(reversed(recent), weights))
    total_weight = sum(weights)

    if total_weight == 0:
        return 0.0

    # Promedio mensual ponderado → diario (÷ 30)
    monthly_avg = weighted_sum / total_weight
    return monthly_avg / 30.0


def calculate_ses(daily_values, alpha=SES_ALPHA):
    """
    Suavización Exponencial Simple (Simple Exponential Smoothing).
    Recibe una lista de valores diarios ordenados cronológicamente.
    Retorna el pronóstico suavizado (valor diario).
    """
    if not daily_values or len(daily_values) == 0:
        return 0.0

    # Inicializar con el primer valor
    forecast = daily_values[0]
    for actual in daily_values[1:]:
        forecast = alpha * actual + (1 - alpha) * forecast

    return max(0.0, forecast)


def calculate_croston(daily_values):
    """
    Método de Croston para demanda intermitente.
    Separa tamaño de demanda de frecuencia de aparición.
    Retorna pronóstico diario.
    """
    if not daily_values or len(daily_values) == 0:
        return 0.0

    # Separar en demandas no-cero y sus intervalos
    demands = []
    intervals = []
    last_demand_idx = None

    for i, val in enumerate(daily_values):
        if val > 0:
            demands.append(val)
            if last_demand_idx is not None:
                intervals.append(i - last_demand_idx)
            last_demand_idx = i

    if not demands or not intervals:
        # Fallback: promedio simple si no hay suficiente patrón
        total = sum(daily_values)
        return total / len(daily_values) if len(daily_values) > 0 else 0.0

    # Suavización exponencial para tamaño e intervalo
    alpha = 0.15
    avg_demand = demands[0]
    avg_interval = intervals[0] if intervals else 1

    for d in demands[1:]:
        avg_demand = alpha * d + (1 - alpha) * avg_demand
    for i_val in intervals[1:]:
        avg_interval = alpha * i_val + (1 - alpha) * avg_interval

    if avg_interval <= 0:
        return 0.0

    return max(0.0, avg_demand / avg_interval)


def calculate_plan_daily(plan_monthly_qty, target_month_date, seasonality_factor=1.0):
    """
    Convierte plan comercial mensual a demanda diaria.
    plan_monthly_qty: cantidad total planificada para el mes (tn)
    target_month_date: date del primer día del mes
    seasonality_factor: factor FEI (factor_fin_mes del plan híbrido)
    Retorna ADU diario ajustado por estacionalidad.
    """
    if plan_monthly_qty <= 0:
        return 0.0

    year = target_month_date.year
    month = target_month_date.month

    # Calcular días hábiles del mes (lun-sáb, aproximación: 26 días/mes)
    days_in_month = calendar.monthrange(year, month)[1]
    # Usar días hábiles aproximados (excluir domingos)
    business_days = 0
    for d in range(1, days_in_month + 1):
        dt = date(year, month, d)
        if dt.weekday() != 6:  # != domingo
            business_days += 1

    if business_days == 0:
        business_days = days_in_month  # Fallback

    daily_plan = (plan_monthly_qty / business_days) * seasonality_factor
    return max(0.0, daily_plan)


# =============================================================================
# SELECTOR DE MÉTODO POR SEGMENTO
# =============================================================================

def get_segment_config(abc, xyz):
    """Retorna (peso_plan, peso_historico, metodo) según segmento ABC/XYZ."""
    abc_clean = str(abc).strip().upper() if abc else ''
    xyz_clean = str(xyz).strip().upper() if xyz else ''

    # Búsqueda exacta
    key = (abc_clean, xyz_clean)
    if key in SEGMENT_CONFIG:
        return SEGMENT_CONFIG[key]

    # Búsqueda por ABC solo (para C-* y SP-*)
    for (a, x), config in SEGMENT_CONFIG.items():
        if a == abc_clean and x == xyz_clean:
            return config

    # Si es C o SP sin XYZ definido
    if abc_clean in ('C', 'SP', ''):
        return (0.7, 0.3, 'WMA')

    return DEFAULT_SEGMENT


def calculate_historical_adu(method, monthly_values, daily_values):
    """Calcula ADU histórico usando el método indicado."""
    if method == 'WMA':
        return calculate_wma(monthly_values)
    elif method == 'SES':
        return calculate_ses(daily_values)
    elif method == 'CROSTON':
        return calculate_croston(daily_values)
    else:
        return calculate_wma(monthly_values)


# =============================================================================
# GENERADOR PRINCIPAL DE PRONÓSTICOS
# =============================================================================

def generate_forecasts(data):
    """
    Genera pronósticos diarios para todos los SKUs.
    Retorna una lista de registros listos para insertar en sap_pronostico_diario.
    """
    logging.info("Generando pronósticos...")

    now = datetime.now()
    today = now.date()
    horizon_end = today + timedelta(days=HORIZON_DAYS)

    # --- Pre-procesar datos ---
    # Segmentos como dict: sku_id → {abc, xyz, factor, adu_actual}
    seg_map = {}
    if not data['segmentos'].empty:
        for _, row in data['segmentos'].iterrows():
            sku = str(row.get('sku_id', '')).strip()
            if sku:
                seg_map[sku] = {
                    'abc': row.get('abc_segment'),
                    'xyz': row.get('xyz_segment'),
                    'factor': float(row.get('factor_fin_mes', 1.0) or 1.0),
                    'adu_actual': float(row.get('adu_hibrido_final', 0) or 0),
                }

    # Consumo mensual agrupado: sku_id → {tipo → [(mes, qty), ...]}
    consumo_mensual_map = {}
    if not data['consumo_mensual'].empty:
        for _, row in data['consumo_mensual'].iterrows():
            sku = str(row.get('sku_id', '')).strip()
            tipo = str(row.get('tipo2', '')).lower().strip()
            mes = str(row.get('mes', ''))
            qty = safe_float(row.get('cantidad_total_tn', 0))
            if sku and tipo in ('consumo', 'venta'):
                if sku not in consumo_mensual_map:
                    consumo_mensual_map[sku] = {}
                if tipo not in consumo_mensual_map[sku]:
                    consumo_mensual_map[sku][tipo] = []
                consumo_mensual_map[sku][tipo].append((mes, qty))

    # Ordenar cronológicamente
    for sku in consumo_mensual_map:
        for tipo in consumo_mensual_map[sku]:
            consumo_mensual_map[sku][tipo].sort(key=lambda x: x[0])

    # Consumo diario: sku_id → [qty ordenado por fecha]
    consumo_diario_map = {}
    if not data['consumo_diario'].empty:
        sorted_df = data['consumo_diario'].sort_values('fecha')
        for _, row in sorted_df.iterrows():
            sku = str(row.get('sku_id', '')).strip()
            qty = safe_float(row.get('cantidad_limpia', 0))
            if sku:
                if sku not in consumo_diario_map:
                    consumo_diario_map[sku] = []
                consumo_diario_map[sku].append(qty)

    # Producción mensual agrupada para histórico
    produccion_mensual_map = {}
    if not data['produccion'].empty:
        df_p = data['produccion'].copy()
        df_p['material'] = df_p['material'].astype(str).str.strip()
        df_p['fecha_contabilizacion'] = pd.to_datetime(df_p['fecha_contabilizacion'], utc=True)
        df_p['month_key'] = df_p['fecha_contabilizacion'].dt.tz_localize(None).dt.to_period('M')
        grouped = df_p.groupby(['material', 'month_key'])['cantidad_tn'].sum().reset_index()
        for _, row in grouped.iterrows():
            sku = str(row['material'])
            qty = safe_float(row['cantidad_tn'])
            if sku not in produccion_mensual_map:
                produccion_mensual_map[sku] = []
            produccion_mensual_map[sku].append(qty)

    # Demanda (plan comercial): sku_id → [(mes_date, qty), ...]
    demanda_map = {}
    if not data['demanda'].empty:
        for _, row in data['demanda'].iterrows():
            sku = str(row.get('sku_id', '')).strip()
            mes_str = str(row.get('mes', ''))
            qty = safe_float(row.get('cantidad', 0))
            if sku and qty > 0:
                try:
                    mes_date = datetime.strptime(mes_str[:10], '%Y-%m-%d').date()
                except ValueError:
                    continue
                if sku not in demanda_map:
                    demanda_map[sku] = []
                demanda_map[sku].append((mes_date, qty))

    # Programa producción (mes vigente): sku → {fecha → qty} para producción y consumo
    programa_prod_map = {}  # sku_produccion → [(fecha, qty)]
    programa_cons_map = {}  # sku_consumo → [(fecha, qty)]
    if not data['programa'].empty:
        for _, row in data['programa'].iterrows():
            fecha_str = str(row.get('fecha', ''))
            sku_prod = str(row.get('sku_produccion', '')).strip()
            sku_cons = str(row.get('sku_consumo', '')).strip()
            qty = safe_float(row.get('cantidad_programada', 0))

            if sku_prod and sku_prod != '0' and qty > 0:
                if sku_prod not in programa_prod_map:
                    programa_prod_map[sku_prod] = []
                programa_prod_map[sku_prod].append((fecha_str, qty))

            if sku_cons and sku_cons != '0' and qty > 0:
                if sku_cons not in programa_cons_map:
                    programa_cons_map[sku_cons] = []
                programa_cons_map[sku_cons].append((fecha_str, qty))

    # --- Recopilar todos los SKUs candidatos ---
    all_skus = set()
    all_skus.update(consumo_mensual_map.keys())
    all_skus.update(demanda_map.keys())
    all_skus.update(programa_prod_map.keys())
    all_skus.update(programa_cons_map.keys())
    all_skus.update(produccion_mensual_map.keys())
    # Filtrar SKUs vacíos
    all_skus = {s for s in all_skus if s and s != 'nan'}

    logging.info(f"  SKUs candidatos: {len(all_skus)}")

    # --- Generar pronósticos por SKU ---
    forecast_records = []
    stats = {'WMA': 0, 'SES': 0, 'CROSTON': 0, 'PLAN_DIRECTO': 0, 'PROGRAMA': 0, 'HIBRIDO': 0}

    for sku in all_skus:
        seg = seg_map.get(sku, {'abc': None, 'xyz': None, 'factor': 1.0, 'adu_actual': 0})
        abc = seg['abc']
        xyz = seg['xyz']
        factor = seg['factor']
        peso_plan, peso_hist, method = get_segment_config(abc, xyz)

        # --- PRONÓSTICO DE CONSUMO ---
        hist_consumo = consumo_mensual_map.get(sku, {}).get('consumo', [])
        hist_consumo_vals = [v for _, v in hist_consumo]
        diario_consumo = consumo_diario_map.get(sku, [])
        programa_consumo = programa_cons_map.get(sku, [])

        adu_hist_consumo = calculate_historical_adu(method, hist_consumo_vals, diario_consumo)
        has_hist_consumo = adu_hist_consumo > 0

        # Plan como consumo del programa de producción
        has_programa_consumo = len(programa_consumo) > 0

        if has_hist_consumo or has_programa_consumo:
            for day_offset in range(HORIZON_DAYS):
                target_date = today + timedelta(days=day_offset)
                target_str = target_date.strftime('%Y-%m-%d')

                # ¿Hay programa de producción para esta fecha?
                prog_qty = sum(q for f, q in programa_consumo if f == target_str)
                if prog_qty > 0:
                    # Programa directo para el mes vigente
                    forecast_records.append(_make_record(
                        sku, target_date, 'consumo', prog_qty,
                        'PROGRAMA', 'programa', 0, 0, abc, xyz
                    ))
                    stats['PROGRAMA'] += 1
                elif has_hist_consumo:
                    # Pronóstico basado en histórico (no hay plan de consumo más allá del programa)
                    forecast_records.append(_make_record(
                        sku, target_date, 'consumo', adu_hist_consumo,
                        method, 'historico', 0, 1.0, abc, xyz
                    ))
                    stats[method] += 1

        # --- PRONÓSTICO DE VENTA ---
        hist_venta = consumo_mensual_map.get(sku, {}).get('venta', [])
        hist_venta_vals = [v for _, v in hist_venta]
        plan_venta = demanda_map.get(sku, [])

        adu_hist_venta = calculate_historical_adu(method, hist_venta_vals, diario_consumo)
        has_hist_venta = adu_hist_venta > 0
        has_plan_venta = len(plan_venta) > 0

        if has_hist_venta or has_plan_venta:
            for day_offset in range(HORIZON_DAYS):
                target_date = today + timedelta(days=day_offset)
                target_month_start = target_date.replace(day=1)

                # Buscar plan mensual para este mes
                plan_qty = sum(q for m, q in plan_venta if m == target_month_start)
                adu_plan = calculate_plan_daily(plan_qty, target_month_start, factor) if plan_qty > 0 else 0

                # Determinar pesos reales
                if has_hist_venta and has_plan_venta and adu_plan > 0:
                    # Mezcla híbrida
                    final_adu = (adu_plan * peso_plan) + (adu_hist_venta * peso_hist)
                    metodo = f'{method}+PLAN'
                    fuente = 'hibrido'
                    w_plan = peso_plan
                    w_hist = peso_hist
                    stats['HIBRIDO'] += 1
                elif has_plan_venta and adu_plan > 0:
                    # Solo plan (sin histórico)
                    final_adu = adu_plan
                    metodo = 'PLAN_DIRECTO'
                    fuente = 'plan'
                    w_plan = 1.0
                    w_hist = 0.0
                    stats['PLAN_DIRECTO'] += 1
                else:
                    # Solo histórico (sin plan)
                    final_adu = adu_hist_venta
                    metodo = method
                    fuente = 'historico'
                    w_plan = 0.0
                    w_hist = 1.0
                    stats[method] += 1

                if final_adu > 0:
                    forecast_records.append(_make_record(
                        sku, target_date, 'venta', final_adu,
                        metodo, fuente, w_plan, w_hist, abc, xyz
                    ))

        # --- PRONÓSTICO DE PRODUCCIÓN ---
        programa_produccion = programa_prod_map.get(sku, [])
        hist_prod_vals = produccion_mensual_map.get(sku, [])

        adu_hist_prod = calculate_wma(hist_prod_vals) if hist_prod_vals else 0
        has_hist_prod = adu_hist_prod > 0
        has_programa_prod = len(programa_produccion) > 0

        if has_hist_prod or has_programa_prod:
            for day_offset in range(HORIZON_DAYS):
                target_date = today + timedelta(days=day_offset)
                target_str = target_date.strftime('%Y-%m-%d')

                # ¿Hay programa de producción para esta fecha?
                prog_qty = sum(q for f, q in programa_produccion if f == target_str)
                if prog_qty > 0:
                    forecast_records.append(_make_record(
                        sku, target_date, 'produccion', prog_qty,
                        'PROGRAMA', 'programa', 0, 0, abc, xyz
                    ))
                    stats['PROGRAMA'] += 1
                elif has_hist_prod:
                    forecast_records.append(_make_record(
                        sku, target_date, 'produccion', adu_hist_prod,
                        'WMA', 'historico', 0, 1.0, abc, xyz
                    ))
                    stats['WMA'] += 1

    logging.info(f"  Total registros generados: {len(forecast_records)}")
    logging.info(f"  Distribución por método: {stats}")

    return forecast_records


def _make_record(sku_id, fecha, tipo, cantidad, metodo, fuente, w_plan, w_hist, abc, xyz):
    """Crea un diccionario de registro listo para inserción."""
    return {
        'sku_id': sku_id,
        'fecha': fecha.strftime('%Y-%m-%d') if isinstance(fecha, date) else str(fecha),
        'tipo': tipo,
        'cantidad_pronosticada': round(safe_float(cantidad), 6),
        'metodo_usado': metodo,
        'fuente': fuente,
        'peso_plan': round(safe_float(w_plan), 2),
        'peso_historico': round(safe_float(w_hist), 2),
        'abc_segment': str(abc) if abc and str(abc) != 'None' else None,
        'xyz_segment': str(xyz) if xyz and str(xyz) != 'None' else None,
        'updated_at': datetime.now().isoformat(),
    }


# =============================================================================
# PERSISTENCIA EN SUPABASE
# =============================================================================

def persist_forecasts(records):
    """Trunca la tabla sap_pronostico_diario e inserta los nuevos pronósticos."""
    if not records:
        logging.warning("No hay registros para persistir.")
        return 0

    logging.info(f"Persistiendo {len(records)} pronósticos en Supabase...")

    # 1. Truncar tabla existente
    try:
        headers = get_headers()
        del_url = f"{SUPABASE_URL}/rest/v1/sap_pronostico_diario"
        resp = requests.delete(del_url, headers=headers, params={"sku_id": "not.is.null"})
        if resp.status_code not in (200, 204):
            logging.warning(f"Truncate retornó {resp.status_code}: {resp.text[:200]}")
        else:
            logging.info("  Tabla truncada exitosamente.")
    except Exception as e:
        logging.error(f"Error truncando tabla: {e}")

    # 2. Insertar por lotes
    total_inserted = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        # Sanitizar batch: reemplazar cualquier NaN/Inf residual
        for rec in batch:
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    rec[k] = 0.0
        try:
            post_to_supabase('sap_pronostico_diario', batch)
            total_inserted += len(batch)
            if (i // BATCH_SIZE) % 10 == 0:
                logging.info(f"  Insertado batch {i // BATCH_SIZE + 1} ({total_inserted}/{len(records)})")
        except Exception as e:
            err_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                err_msg += f" Response: {e.response.text[:300]}"
            logging.error(f"Error insertando batch {i}: {err_msg}")

    logging.info(f"  Persistencia completada: {total_inserted}/{len(records)} registros.")
    return total_inserted


# =============================================================================
# PUNTO DE ENTRADA
# =============================================================================

def run_forecast():
    """Función principal: descarga datos, genera pronósticos y persiste."""
    logging.info("=" * 60)
    logging.info("  MOTOR DE PRONÓSTICOS HÍBRIDO — Inicio")
    logging.info("=" * 60)

    start_time = datetime.now()

    try:
        # 1. Descargar datos fuente
        data = fetch_source_data()

        # 2. Generar pronósticos
        records = generate_forecasts(data)

        # 3. Persistir en Supabase
        total = persist_forecasts(records)

        # 4. Registrar en sync_status_log
        elapsed = (datetime.now() - start_time).total_seconds()
        log_sync_result(
            table_name="sap_pronostico_diario",
            rows_upserted=total,
            status="success"
        )

        logging.info(f"  Tiempo total: {elapsed:.1f} segundos")
        logging.info("=" * 60)
        logging.info("  MOTOR DE PRONÓSTICOS — Completado exitosamente")
        logging.info("=" * 60)
        return total

    except Exception as e:
        logging.error(f"Error crítico en run_forecast: {e}", exc_info=True)
        log_sync_result(
            table_name="sap_pronostico_diario",
            rows_upserted=0,
            status="error",
            error_msg=str(e)[:500]
        )
        raise


if __name__ == "__main__":
    run_forecast()
