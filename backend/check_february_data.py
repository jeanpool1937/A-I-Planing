import os
from dotenv import load_dotenv
from supabase import create_client

# Cargar variables de entorno
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: No se encontraron las credenciales de Supabase en el archivo .env")
    exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Consultar datos en sap_consumo_diario entre 25/02/2025 y 28/02/2025
try:
    response = supabase.table("sap_consumo_diario").select("*").gte("fecha", "2025-02-25").lte("fecha", "2025-02-28").execute()
    data = response.data
    print(f"Total de registros encontrados: {len(data)}")
    
    # Agrupar por fecha
    fechas_count = {}
    for row in data:
        fecha = row.get("fecha")
        fechas_count[fecha] = fechas_count.get(fecha, 0) + 1
        
    for fecha in sorted(fechas_count.keys()):
        print(f"Fecha {fecha}: {fechas_count[fecha]} registros")
        
except Exception as e:
    print(f"Error al consultar: {e}")
