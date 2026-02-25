import pandas as pd

def cleanup_column_names(df):
    column_mapping = {
        'Material - Clave': 'material_clave',
        'Material - Texto': 'material_texto',
        'Nueva Unidad Medida': 'unidad_medida',
        'Cl.movimiento': 'cl_movimiento',
        'Tipo2': 'tipo2',
        'Cantidad final tn': 'cantidad_final_tn',
        'Centro': 'centro',
        'Almacen': 'almacen'
    }
    date_col = next((col for col in df.columns if 'natural' in col.lower() or 'mes' in col.lower()), None)
    if date_col: column_mapping[date_col] = 'fecha'
    return df.rename(columns=column_mapping)

def parse_date(date_val):
    if pd.isna(date_val): return None
    str_val = str(date_val).strip()
    try:
        if '.' in str_val and len(str_val.split('.')) == 2:
            p = str_val.split('.')
            return f"{p[1]}-{p[0]}-01"
        if '/' in str_val:
            p = str_val.split('/')
            if len(p) == 3: return f"{p[2]}-{p[1]}-{p[0]}"
        if '-' in str_val and len(str_val.split('-')) == 3:
            return str_val.split(' ')[0]
    except: return None
    return None

def normalize_value(val):
    if pd.isna(val) or val is None or str(val).strip() == "": return ""
    s_val = str(val).strip()
    try:
        f_val = float(s_val)
        if f_val.is_integer(): return str(int(f_val))
        return f"{f_val:.6f}".rstrip('0').rstrip('.')
    except: return s_val

def clean_production_column_name(col_name):
    mapping = {
        "Fecha de contabilización": "fecha_contabilizacion",
        "Clase de orden - Clave": "clase_orden",
        "Orden - Clave": "orden",
        "Material - Clave": "material",
        "Material - Texto de longitud media": "texto_material",
        "Nueva Unid Med": "unidad_medida",
        "Prod tn.": "cantidad_tn",
        "Creado el": "creado_el"
    }
    if col_name in mapping: return mapping[col_name]
    col_lower = str(col_name).lower()
    if "fecha" in col_lower and "contabiliza" in col_lower: return "fecha_contabilizacion"
    if "clase" in col_lower and "orden" in col_lower: return "clase_orden"
    if "orden" in col_lower and "clave" in col_lower: return "orden"
    if "material" in col_lower and "clave" in col_lower: return "material"
    if "texto" in col_lower: return "texto_material"
    if "nueva" in col_lower and "med" in col_lower: return "unidad_medida"
    if "prod" in col_lower and "tn" in col_lower: return "cantidad_tn"
    if "creado" in col_lower: return "creado_el"
    return None

def clean_articulos_column_name(col_name):
    c = str(col_name).strip()
    if 'digo' in c or 'Cdigo' in c: return 'codigo'
    if 'Material' in c and 'media' in c: return 'descripcion_material'
    if 'Nivel 1' in c: return 'jerarquia_nivel_1'
    if 'Grupo de art' in c and 'breve' in c: return 'grupo_articulos_descripcion'
    if 'ABC' in c: return 'abc'
    if 'Clase' in c: return 'clase'
    if 'Lead' in c: return 'lead_time'
    if 'Stock' in c and ('Segur' in c or 'SS' in c): return 'stock_seguridad'

    return c.lower().replace(' ', '_').replace('.', '').replace('(', '').replace(')', '')

def clean_mb52_column_name(col_name):
    c = str(col_name).strip()
    mapping = {
        'Material': 'material',
        'Centro': 'centro',
        'Libre utilizac': 'libre_utilizacion',
        'Bloqueado': 'bloqueado'
    }
    if c in mapping: return mapping[c]
    if 'Texto breve' in c: return 'texto_material'
    if 'lmac' in c: return 'almacen'
    if 'Unid' in c or 'UMB' in c: return 'unidad_medida'
    # Handle accents and variations for 'Libre utilización'
    if 'ibre' in c and 'tiliz' in c: return 'libre_utilizacion'
    if 'Bloqueado' in c: return 'bloqueado'
    if 'nspecc' in c: return 'inspeccion_calidad'
    if 'Tr' in c and 'sito' in c: return 'stock_en_transito'
    return c.lower().replace(' ', '_').replace('.', '').replace('/', '_')

def clean_programa_produccion_column(col_name):
    c = str(col_name).strip().upper()
    if 'FECHA' in c: return 'fecha'
    if 'ORDEN' in c and 'PROCESO' in c: return 'orden_proceso'
    if 'SKU' in c and 'CONSUMO' not in c: return 'sku_produccion'
    if 'DESCRIPCION' in c: return 'sku_consumo'
    if 'PROGRAMADO' in c: return 'cantidad_programada'
    return c.lower().replace(' ', '_')
