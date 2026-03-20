
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
    
    INCREMENTAL_TABLES = [
        'sap_consumo_movimientos',
        'sap_produccion',
        'ai_anomaly_alerts'
    ]
    
    data = []
    total_nuevos_movimientos = 0

    for t in tables:
        # Total histórico
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        total_count = cur.fetchone()[0]
        
        # Registros de hoy
        hoy_count = 0
        try:
            # Buscar si tiene columna created_at o creado_el
            cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{t}'")
            cols = [c[0] for c in cur.fetchall()]
            
            date_col = None
            if 'created_at' in cols: date_col = 'created_at'
            elif 'creado_el' in cols: date_col = 'creado_el'
            elif 'last_updated_at' in cols: date_col = 'last_updated_at'
            elif 'updated_at' in cols: date_col = 'updated_at'
            
            if date_col:
                cur.execute(f"SELECT COUNT(*) FROM {t} WHERE DATE({date_col}) = CURRENT_DATE")
                hoy_count = cur.fetchone()[0]
                if t in INCREMENTAL_TABLES:
                    total_nuevos_movimientos += hoy_count
        except Exception:
            conn.rollback()
            pass
            
        data.append({
            "Tabla": t, 
            "Registros Totales": total_count, 
            "Procesados Hoy": hoy_count, 
            "Tipo": "Incremental" if t in INCREMENTAL_TABLES else "Snapshot"
        })
    
    df = pd.DataFrame(data)
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Tablas Sincronizadas", len(tables))
    col2.metric("Volumen Total BD", f"{df['Registros Totales'].sum():,}")
    col3.metric("Nuevos Registros (Hoy)", f"{total_nuevos_movimientos:,}", delta="Transaccionales")
    col4.metric("Estado BD", "OFFLINE (Port 5433)", delta="Activo")
    
    st.markdown("### 📊 Integridad de Datos por Tabla")
    
    # Mostrar dos gráficos
    c1, c2 = st.columns(2)
    with c1:
        fig1 = px.bar(df, x="Tabla", y="Registros Totales", color="Registros Totales", 
                     title="Fondo Total por Tabla",
                     template="plotly_dark", color_continuous_scale="Viridis")
        st.plotly_chart(fig1, use_container_width=True)
    with c2:
        df_hoy = df[df['Procesados Hoy'] > 0]
        fig2 = px.bar(df_hoy, x="Tabla", y="Procesados Hoy", color="Tipo", 
                     title="Volumen Procesado Hoy (Incremental vs Snapshot)",
                     template="plotly_dark", color_discrete_map={"Incremental": "#FF4B4B", "Snapshot": "#4B8BFF"})
        st.plotly_chart(fig2, use_container_width=True)
    
    st.dataframe(df, use_container_width=True)
    
    # Botón mágico para refrescar base de datos (trigger script local)
    if st.button("🔄 Ejecutar Sincronización Local AHORA"):
        import subprocess
        st.info("Iniciando sincronización... Por favor, revisa la consola.")
        subprocess.Popen(['run_daily.bat'], shell=True)
    
    conn.close()
except Exception as e:
    st.error(f"⚠️ Error de conexión: {e}")
    st.info("Asegúrate de ejecutar 'iniciar_servidor_db.bat' primero.")
