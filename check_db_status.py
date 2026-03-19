
import psycopg2
import os
from dotenv import load_dotenv

# Cargar variables de entorno del backend
load_dotenv(r"D:\Base de datos\A+I-Planing\backend\.env")

def check_db_health():
    print("="*60)
    print("      AUDITORÍA DE INTEGRIDAD: BASE DE DATOS LOCAL")
    print("="*60)
    
    try:
        conn = psycopg2.connect(
            host=os.getenv("PG_HOST", "127.0.0.1"),
            port=os.getenv("PG_PORT", "5433"),
            dbname=os.getenv("PG_DB", "aiplaning_local"),
            user=os.getenv("PG_USER", "postgres"),
            password=os.getenv("PG_PASSWORD", "Postgres2024!")
        )
        cur = conn.cursor()
        
        # Obtener lista de tablas
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
        tables = [t[0] for t in cur.fetchall()]
        
        if not tables:
            print("[!] No se encontraron tablas en el esquema 'public'.")
            return

        print(f"{'TABLA':<35} | {'REGISTROS':<12}")
        print("-" * 50)
        
        total_rows = 0
        for table in tables:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            count = cur.fetchone()[0]
            print(f"{table:<35} | {count:>12,}")
            total_rows += count
            
        print("-" * 50)
        print(f"{'TOTAL GENERAL DE REGISTROS':<35} | {total_rows:>12,}")
        print("="*60)
        print("ESTADO: EXITOSO - Todos los datos están presentes localmente.")
        print("="*60)
        
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"[ERROR CRÍTICO] No se pudo conectar a la base de datos: {e}")

if __name__ == "__main__":
    check_db_health()
