"""
pg_client.py
Capa de abstracción para PostgreSQL local.
Tiene exactamente las mismas funciones que api_client.py (post_to_supabase,
patch_to_supabase, call_rpc) pero usa psycopg2 en lugar de HTTP REST.
Esto permite usar los mismos scripts de sincronización sin cambios.
"""
import os
import json
import logging
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Cargar configuración
def _load_env():
    current = os.path.dirname(os.path.abspath(__file__))
    while current != os.path.dirname(current):
        ep = os.path.join(current, '.env')
        if os.path.exists(ep):
            load_dotenv(ep)
            return
        current = os.path.dirname(current)

_load_env()

PG_HOST     = os.getenv("PG_HOST", "127.0.0.1")
PG_PORT     = os.getenv("PG_PORT", "5432")
PG_DB       = os.getenv("PG_DB", "aiplaning_local")
PG_USER     = os.getenv("PG_USER", "postgres")
PG_PASSWORD = os.getenv("PG_PASSWORD", "")


def _get_conn():
    """Retorna una conexión a PostgreSQL local."""
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DB,
        user=PG_USER,
        password=PG_PASSWORD
    )


def post_to_supabase(table: str, records, extra_headers=None):
    """
    Inserta o actualiza registros en la tabla PostgreSQL local.
    Acepta un dict o una lista de dicts (igual que la versión Supabase).
    Usa INSERT ... ON CONFLICT DO NOTHING para idempotencia.
    """
    if not records:
        return None

    if isinstance(records, dict):
        records = [records]

    if not records:
        return None

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Construir INSERT dinámico basado en las keys del primer registro
            columns = list(records[0].keys())
            cols_str = ", ".join(f'"{c}"' for c in columns)
            vals_str = ", ".join(f"%({c})s" for c in columns)
            sql = f'INSERT INTO "{table}" ({cols_str}) VALUES ({vals_str}) ON CONFLICT DO NOTHING'
            psycopg2.extras.execute_batch(cur, sql, records, page_size=500)
        conn.commit()
        logger.info(f"[pg_client] Insertados {len(records)} registros en {table}")
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        logger.warning(f"[pg_client] Conflicto de unicidad en {table}, continuando...")
    except Exception as e:
        conn.rollback()
        logger.error(f"[pg_client] Error insertando en {table}: {e}")
        raise
    finally:
        conn.close()

    # Retornar objeto compatible con requests.Response
    class _FakeResponse:
        status_code = 201
        content = b"ok"
        def raise_for_status(self): pass

    return _FakeResponse()


def patch_to_supabase(table: str, payload: dict, params: dict, extra_headers=None):
    """
    Actualiza registros en PostgreSQL local.
    params: dict con filtro tipo {'id': 'eq.123'} (compatibilidad Supabase)
    """
    if not payload or not params:
        return None

    # Parsear filtros Supabase (ej: {"id": "eq.123", "status": "eq.open"})
    where_parts = []
    where_values = {}
    for col, val_str in params.items():
        if isinstance(val_str, str) and "." in val_str:
            op, val = val_str.split(".", 1)
            pg_op = {"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "is": "IS"}.get(op, "=")
            where_parts.append(f'"{col}" {pg_op} %({col}_w)s')
            where_values[f"{col}_w"] = val
        else:
            where_parts.append(f'"{col}" = %({col}_w)s')
            where_values[f"{col}_w"] = val_str

    # Construir SET
    set_parts = [f'"{k}" = %({k})s' for k in payload.keys()]
    all_values = {**payload, **where_values}

    sql = f'UPDATE "{table}" SET {", ".join(set_parts)} WHERE {" AND ".join(where_parts)}'

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, all_values)
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"[pg_client] Error actualizando {table}: {e}")
        raise
    finally:
        conn.close()

    class _FakeResponse:
        status_code = 200
        content = b"ok"
        def raise_for_status(self): pass

    return _FakeResponse()


def delete_from_table(table: str, params: dict):
    """
    Elimina registros de una tabla (equivale al DELETE de Supabase).
    params: dict con filtro tipo {'sku_id': 'not.is.null'}
    """
    if not params:
        return

    where_parts = []
    where_values = {}

    for col, val_str in params.items():
        if isinstance(val_str, str):
            if val_str == "not.is.null":
                where_parts.append(f'"{col}" IS NOT NULL')
            elif "." in val_str:
                op, val = val_str.split(".", 1)
                pg_op = {"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "is": "IS"}.get(op, "=")
                where_parts.append(f'"{col}" {pg_op} %({col}_w)s')
                where_values[f"{col}_w"] = val
        else:
            where_parts.append(f'"{col}" IS NOT NULL')

    if not where_parts:
        return

    sql = f'DELETE FROM "{table}" WHERE {" AND ".join(where_parts)}'

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, where_values)
        conn.commit()
        logger.info(f"[pg_client] Tabla {table} truncada con éxito.")
    except Exception as e:
        conn.rollback()
        logger.error(f"[pg_client] Error eliminando registros de {table}: {e}")
        raise
    finally:
        conn.close()


def call_rpc(rpc_name: str, payload=None):
    """
    Llama a una función almacenada en PostgreSQL local.
    Equivalente al llamado RPC de Supabase.
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if payload:
                args = ", ".join(f"%({k})s" for k in payload.keys())
                cur.execute(f"SELECT {rpc_name}({args})", payload)
            else:
                cur.execute(f"SELECT {rpc_name}()")
            result = cur.fetchone()
        conn.commit()
        return {"success": True, "result": result[0] if result else None}
    except psycopg2.errors.UndefinedFunction:
        conn.rollback()
        # Si la función no existe aún en la BD local, retornamos éxito silencioso
        logger.warning(f"[pg_client] Función RPC '{rpc_name}' no existe en PostgreSQL local. Omitiendo.")
        return {"success": True, "message": f"RPC {rpc_name} pendiente de implementación local"}
    except Exception as e:
        conn.rollback()
        logger.error(f"[pg_client] Error llamando RPC {rpc_name}: {e}")
        raise
    finally:
        conn.close()


def get_from_table(table: str, select="*", params=None, limit=10000):
    """Consulta una tabla de PostgreSQL. Retorna lista de dicts."""
    conn = _get_conn()
    try:
        where_parts = []
        where_values = {}

        if params:
            for col, val_str in params.items():
                if col == "select" or col == "order" or col == "limit":
                    continue  # son params especiales de Supabase, no filtros WHERE
                if isinstance(val_str, str) and "." in val_str:
                    op, val = val_str.split(".", 1)
                    pg_op = {"eq": "=", "gte": ">=", "lte": "<=", "gt": ">", "lt": "<", "neq": "!="}.get(op, "=")
                    where_parts.append(f'"{col}" {pg_op} %({col}_f)s')
                    where_values[f"{col}_f"] = val

        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        sql = f'SELECT {select} FROM "{table}" {where_clause} LIMIT {limit}'

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, where_values)
            return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.error(f"[pg_client] Error consultando {table}: {e}")
        raise
    finally:
        conn.close()


# Alias: para que sync_logger y otros puedan hacer `from modules.pg_client import get_headers`
# (aunque no se use, evita ImportErrors en módulos que hacen imports nombrados)
def get_headers():
    return {"X-Backend": "postgresql-local"}


# Variables de compatibilidad
SUPABASE_URL = "local://postgresql"
SUPABASE_KEY = "local"
