
import streamlit as st
import pandas as pd
import psycopg2
import os
from dotenv import load_dotenv
import plotly.express as px

# Configuración de página con estética premium
st.set_page_config(
    page_title="A+I Planing - Control Panel",
    page_icon="🤖",
    layout="wide",
)

# Cargar variables de entorno
load_dotenv(".env")

def get_connection():
    return psycopg2.connect(
        host=os.getenv("PG_HOST", "127.0.0.1"),
        port=os.getenv("PG_PORT", "5433"),
        dbname=os.getenv("PG_DB", "aiplaning_local"),
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", "Postgres2024!")
    )

st.title("🚀 A+I Planing - Local DB Dashboard")
st.markdown("---")

try:
    conn = get_connection()
    cur = conn.cursor()
    
    # Métricas principales
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
    tables = [t[0] for t in cur.fetchall()]
    
    data = []
    for t in tables:
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        data.append({"Tabla": t, "Registros": cur.fetchone()[0]})
    
    df = pd.DataFrame(data)
    
    col1, col2, col3 = st.columns(3)
    col1.metric("Tablas Sincronizadas", len(tables))
    col2.metric("Total Registros", f"{df['Registros'].sum():,}")
    col3.metric("Estado", "OFFLINE (Puerto 5433)", delta="Conectado")
    
    st.markdown("### 📊 Integridad de Datos por Tabla")
    fig = px.bar(df, x="Tabla", y="Registros", color="Registros", 
                 title="Conteo de Registros por Componente",
                 template="plotly_dark", color_continuous_scale="Viridis")
    st.plotly_chart(fig, use_container_width=True)
    
    st.dataframe(df, use_container_width=True)
    
    conn.close()
except Exception as e:
    st.error(f"⚠️ Error de conexión: {e}")
    st.info("Asegúrate de ejecutar 'iniciar_servidor_db.bat' primero.")
