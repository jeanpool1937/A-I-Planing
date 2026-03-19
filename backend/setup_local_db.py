"""
setup_local_db.py
Script de inicialización para la base de datos PostgreSQL local.
Crea la base de datos 'aiplaning_local' y aplica el esquema completo.

Uso: py setup_local_db.py
Requiere que PostgreSQL 16 esté corriendo y que PG_PASSWORD esté en .env
"""
import os
import sys
import subprocess

# Añadir ruta del backend para importar módulos
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

PG_HOST     = os.getenv("PG_HOST", "127.0.0.1")
PG_PORT     = os.getenv("PG_PORT", "5432")
PG_USER     = os.getenv("PG_USER", "postgres")
PG_PASSWORD = os.getenv("PG_PASSWORD", "")
PG_DB       = os.getenv("PG_DB", "aiplaning_local")

PSQL = r"C:\Program Files\PostgreSQL\16\bin\psql.exe"
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), "create_local_schema.sql")


def run_psql(dbname, sql=None, sql_file=None):
    env = os.environ.copy()
    env["PGPASSWORD"] = PG_PASSWORD

    cmd = [PSQL, "-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", dbname]
    if sql:
        cmd += ["-c", sql]
    elif sql_file:
        cmd += ["-f", sql_file]

    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0 and "already exists" not in result.stderr:
        print(f"  STDERR: {result.stderr[:400]}")
    return result.returncode


def main():
    print("=" * 55)
    print("  INICIALIZACIÓN DE BASE DE DATOS LOCAL - A+I-Planing")
    print("=" * 55)

    # 1. Crear la base de datos (si no existe)
    print(f"\n[1/3] Creando base de datos '{PG_DB}'...")
    rc = run_psql("postgres", sql=f"CREATE DATABASE {PG_DB};")
    if rc == 0:
        print(f"  [OK] Base de datos '{PG_DB}' creada.")
    else:
        print(f"  [INFO] La base de datos '{PG_DB}' ya existe (normal si ya la creaste antes).")

    # 2. Aplicar el esquema de tablas
    print(f"\n[2/3] Aplicando esquema de tablas desde '{SCHEMA_FILE}'...")
    if not os.path.exists(SCHEMA_FILE):
        print(f"  [ERROR] No se encontró el archivo: {SCHEMA_FILE}")
        sys.exit(1)

    rc = run_psql(PG_DB, sql_file=SCHEMA_FILE)
    if rc == 0:
        print("  [OK] Esquema aplicado correctamente.")
    else:
        print("  [ERROR] Hubo un problema al aplicar el esquema. Revisa los mensajes de arriba.")

    # 3. Verificar conectividad con Python (psycopg2)
    print(f"\n[3/3] Verificando conexión Python → PostgreSQL...")
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=PG_HOST, port=PG_PORT, dbname=PG_DB,
            user=PG_USER, password=PG_PASSWORD
        )
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
            count = cur.fetchone()[0]
        conn.close()
        print(f"  [OK] Conexión exitosa. {count} tablas encontradas en la BD.")
    except Exception as e:
        print(f"  [ERROR] No se pudo conectar: {e}")
        print("  Verifica que PG_PASSWORD en .env sea correcto.")
        sys.exit(1)

    print("\n" + "=" * 55)
    print("  ¡Base de datos local lista!")
    print(f"  Para activar el modo local cambia en .env:")
    print(f"  DB_MODE=local")
    print("=" * 55)


if __name__ == "__main__":
    main()
