"""
Motor NLP - 1 llamada a Gemini por consulta.
Prompt estructurado para forzar salida en formato JSON parseable.
"""
import os
import json
import requests
import re
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Modelos disponibles para esta API Key, en orden de preferencia
GEMINI_MODELS = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
]


class RateLimitError(Exception):
    pass


# Prompt con el esquema REAL de las tablas de Supabase
SYSTEM_PROMPT = """Eres un asistente experto en PCP (Planeación y Control de Producción) de una siderúrgica.
Tienes acceso a estas tablas PostgreSQL con sus columnas REALES:

  sap_produccion      → material (TEXT=código SKU), texto_material (TEXT=nombre), cantidad_tn (NUMERIC), fecha_contabilizacion (TIMESTAMPTZ), clase_orden (TEXT)
  sap_stock_mb52      → material (TEXT=código SKU), texto_material (TEXT=nombre), libre_utilizacion (NUMERIC=stock disponible), almacen (TEXT), grupo_articulos (TEXT)
  sap_maestro_articulos → codigo (TEXT=código SKU), descripcion_material (TEXT=nombre), jerarquia_nivel_1 (TEXT), jerarquia_nivel_2 (TEXT), grupo_articulos_descripcion (TEXT)
  sap_plan_inventario_hibrido → sku_id (TEXT=código), descripcion (TEXT=nombre), stock_actual (NUMERIC), estado_critico (BOOLEAN), punto_reorden (NUMERIC), stock_seguridad (NUMERIC), adu_hibrido_final (NUMERIC)
  sap_consumo_sku_mensual → sku_id (TEXT=código), mes (DATE), cantidad_total_tn (NUMERIC), tipo2 (TEXT), pais (TEXT)
  sap_pronostico_diario → sku_id (TEXT), fecha (DATE), tipo (TEXT), cantidad_pronosticada (NUMERIC), metodo_usado (TEXT)
  sap_reporte_maestro → sku_id (TEXT), descripcion (TEXT), stock_hoy (NUMERIC), real_fabricado (NUMERIC), real_venta_consumo (NUMERIC), stock_fin_mes (NUMERIC)
  ai_anomaly_alerts   → sku_id (TEXT), sku_name (TEXT), severity (TEXT), anomaly_score (NUMERIC), actual_value (NUMERIC), expected_value (NUMERIC), status (TEXT='open'/'reviewed')

REGLAS CRÍTICAS DE SQL:
1. SOLO SELECT. Jamás INSERT, UPDATE, DELETE, DROP, ALTER.
2. BÚSQUEDA FUZZY OBLIGATORIA: divide el nombre del artículo en palabras cortas clave y usa AND con ILIKE '%termino%' para cada una.
   Ejemplo - buscar "tee 25mm 2.5mm":
   WHERE texto_material ILIKE '%tee%' AND texto_material ILIKE '%25%' AND texto_material ILIKE '%2,5%'
   NUNCA uses el nombre completo como un solo literal ILIKE. Siempre separa por palabras.
   Nota: en SAP las medidas usan coma decimal, por ejemplo "2,5" no "2.5".
3. Para "última producción de X": 
   SELECT material, texto_material, MAX(fecha_contabilizacion) AS ultima_fecha, SUM(cantidad_tn) AS total_tn
   FROM sap_produccion WHERE <condición fuzzy en texto_material>
   GROUP BY material, texto_material ORDER BY ultima_fecha DESC LIMIT 10
4. Para "stock actual de X": tabla sap_plan_inventario_hibrido o sap_stock_mb52. Usar sap_plan_inventario_hibrido preferentemente.
5. Para "quiebres" o "estado crítico": sap_plan_inventario_hibrido WHERE estado_critico = true ORDER BY stock_actual ASC LIMIT 20.
6. Para "consumo mensual": sap_consumo_sku_mensual.
7. Siempre incluye LIMIT 20 al final (o menos si se requiere menos).

FORMATO DE RESPUESTA OBLIGATORIO — devuelve SOLO JSON válido sin markdown:
{"sql": "SELECT ... LIMIT 20", "answer": "Explicación en español del resultado"}

Si no tienes información disponible:
{"sql": "", "answer": "No encontré información sobre eso en el sistema."}"""


def call_gemini(user_question: str) -> dict:
    """Una sola llamada a Gemini. Devuelve {'sql': str, 'answer': str}."""
    prompt = f"{SYSTEM_PROMPT}\n\nPregunta del usuario: {user_question}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.05,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json"  # Fuerza JSON en modelos que lo soportan
        }
    }

    last_error = None
    for model in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        # Para modelos que no soportan responseMimeType, usar payload sin ese campo
        current_payload = payload.copy()
        try:
            resp = requests.post(url, json=current_payload, timeout=25)
            if resp.status_code == 429:
                last_error = "429_rate_limit"
                logger.warning(f"Rate limit en {model}, probando siguiente...")
                continue
            if resp.status_code == 400:
                # Posible error por responseMimeType no soportado, reintentar sin él
                fallback_payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.05, "maxOutputTokens": 1024}
                }
                resp = requests.post(url, json=fallback_payload, timeout=25)
            resp.raise_for_status()
            raw_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            logger.info(f"Respuesta Gemini ({model}): {raw_text[:200]}")
            return _parse_response(raw_text)
        except requests.exceptions.Timeout:
            last_error = "timeout"
            logger.warning(f"Timeout en {model}")
            continue
        except Exception as e:
            last_error = str(e)
            logger.warning(f"Error en {model}: {e}")
            continue

    if last_error == "429_rate_limit":
        raise RateLimitError()
    raise Exception(f"Gemini no disponible: {last_error}")


def _parse_response(text: str) -> dict:
    """
    Parsea la respuesta de Gemini. Espera JSON puro, pero tiene múltiples fallbacks.
    """
    # Limpiar posibles bloques de código markdown
    clean = re.sub(r'```(?:json)?\n?', '', text).strip().rstrip('`').strip()

    # Intento 1: JSON directo
    try:
        data = json.loads(clean)
        if isinstance(data, dict) and "sql" in data:
            return {"sql": data.get("sql", ""), "answer": data.get("answer", "")}
    except (json.JSONDecodeError, ValueError):
        pass

    # Intento 2: Buscar en texto - extraer SQL y RESPUESTA/answer por separado
    sql = ""
    answer = ""

    # Buscar SQL en cualquier línea que empiece con SELECT o tenga "sql":
    sql_match = re.search(r'"sql"\s*:\s*"((?:[^"\\]|\\.)*)"', clean, re.IGNORECASE | re.DOTALL)
    if sql_match:
        sql = sql_match.group(1).replace('\\n', ' ').strip()

    answer_match = re.search(r'"answer"\s*:\s*"((?:[^"\\]|\\.)*)"', clean, re.IGNORECASE | re.DOTALL)
    if answer_match:
        answer = answer_match.group(1).strip()

    # Intento 3: Si aún no tenemos SQL, buscar SELECT directamente
    if not sql:
        sel_match = re.search(r'(SELECT\s+.+?)(?:\n|$)', clean, re.IGNORECASE | re.DOTALL)
        if sel_match:
            sql = re.sub(r'\s+', ' ', sel_match.group(1)).strip()

    # Intento 4: Si no hay answer, tomar todo el texto que NO sea SQL
    if not answer:
        non_sql_lines = []
        for line in clean.splitlines():
            line_stripped = line.strip()
            if (not line_stripped.upper().startswith("SELECT") and
                    not line_stripped.startswith('"sql"') and
                    not line_stripped.startswith('"answer"') and
                    len(line_stripped) > 5):
                non_sql_lines.append(line_stripped.strip('"').strip(',').strip('{').strip('}'))
        answer = ' '.join(non_sql_lines)[:400].strip()

    if not answer:
        answer = "Consulta procesada."

    return {"sql": sql, "answer": answer}


def validate_sql(sql: str) -> bool:
    """Permite solo SELECT."""
    forbidden = r"\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER|GRANT|REVOKE|CREATE)\b"
    if re.search(forbidden, sql.upper()):
        return False
    clean = sql.strip()
    return clean.upper().startswith("SELECT")


def execute_sql(sql: str) -> list:
    """Ejecuta SQL en Supabase vía la función RPC execute_sql."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/execute_sql"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json={"query_text": sql}, headers=headers, timeout=15)
        logger.info(f"Supabase RPC status: {resp.status_code}")
        if resp.status_code == 200:
            result = resp.json()
            # execute_sql devuelve un JSON como string o lista
            if isinstance(result, list):
                return result
            if isinstance(result, str):
                try:
                    parsed = json.loads(result)
                    return parsed if isinstance(parsed, list) else []
                except Exception:
                    return []
            return []
        else:
            logger.warning(f"RPC execute_sql error {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"RPC execute_sql falló: {e}")
    return []


async def process_cognitive_query(question: str) -> Dict[str, Any]:
    """Flujo principal: pregunta → Gemini (SQL + respuesta en 1 llamada) → datos → resultado."""
    if not GEMINI_API_KEY:
        return {
            "answer": "⚠️ Configura GEMINI_API_KEY en backend/.env para activar el asistente.",
            "sql": None,
            "success": False
        }

    try:
        parsed = call_gemini(question)
        sql = (parsed.get("sql") or "").strip()
        answer = (parsed.get("answer") or "Procesado.").strip()

        # Seguridad: validar SQL si viene
        if sql and not validate_sql(sql):
            return {"answer": "Por seguridad, esa consulta no está permitida.", "sql": sql, "success": False}

        # Ejecutar SQL y obtener datos
        data = []
        if sql and "no_disponible" not in sql:
            data = execute_sql(sql)

        # Si el SQL se ejecutó pero no hay datos, ajustar la respuesta
        if sql and not data and "no encontr" not in answer.lower():
            answer += " (No se encontraron registros para esos criterios de búsqueda.)"

        return {
            "answer": answer,
            "sql": sql or None,
            "data": data[:100],
            "success": True
        }

    except RateLimitError:
        return {
            "answer": "⏳ Límite de velocidad alcanzado (15 consultas/min en Free Tier). Espera un momento e intenta de nuevo.",
            "sql": None,
            "success": False
        }
    except Exception as e:
        logger.error(f"Error en query cognitiva: {e}")
        return {"answer": f"Error interno: {str(e)[:200]}", "sql": None, "success": False}
