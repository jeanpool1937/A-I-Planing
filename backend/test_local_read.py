import os
import sys
from modules.api_client import get_from_table

def test_local_fetch():
    print("--- PRUEBA DE CONECTIVIDAD LOCAL ---")
    print(f"Modo actual: {os.getenv('DB_MODE')}")
    
    try:
        # Intentar traer los centros (suelen ser pocos registros)
        data = get_from_table("sap_centro_pais", limit=5)
        print(f"[OK] Se obtuvieron {len(data)} registros de 'sap_centro_pais' localmente.")
        for row in data:
            print(f" - Centro: {row.get('centro_id')} | Pais: {row.get('pais')}")
            
        print("\n[SUCCESS] El backend está leyendo correctamente de PostgreSQL Local (Port 5433).")
    except Exception as e:
        print(f"[ERROR] Falló la lectura local: {e}")

if __name__ == "__main__":
    test_local_fetch()
