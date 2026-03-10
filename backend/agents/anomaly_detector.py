import os
import requests
import logging
import json
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")


def _supabase_get(table: str, select: str = "*", limit: int = 15000, params: dict = None) -> list:
    """Consulta una tabla de Supabase via API REST usando requests."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=none",
    }
    query_params = {"select": select, "limit": limit, "order": "fecha_contabilizacion.desc"}
    if params:
        query_params.update(params)
    
    response = requests.get(url, headers=headers, params=query_params, timeout=30)
    response.raise_for_status()
    return response.json()


def _supabase_insert(table: str, data: list) -> bool:
    """Inserta registros en Supabase via API REST."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    response = requests.post(url, headers=headers, json=data, timeout=30)
    return response.status_code in (200, 201)


class AnomalyDetector:
    def __init__(self, contamination=0.02):
        self.model = IsolationForest(contamination=contamination, random_state=42)

    def run_audit(self) -> int:
        """Ejecuta el proceso completo de auditoría. Retorna el número de anomalías."""
        try:
            logger.info("Cargando datos de sap_produccion para auditoría...")
            records = _supabase_get(
                "sap_produccion",
                select="material,texto_material,cantidad_tn,fecha_contabilizacion",
                limit=20000
            )

            if not records:
                logger.warning("No hay datos para analizar.")
                return 0

            df = pd.DataFrame(records)
            df['cantidad'] = pd.to_numeric(df['cantidad_tn'], errors='coerce').fillna(0).abs()

            # Feature Engineering
            df['mean_sku'] = df.groupby('material')['cantidad'].transform('mean')
            df['std_sku'] = df.groupby('material')['cantidad'].transform('std').fillna(0)
            df['z_score'] = (df['cantidad'] - df['mean_sku']) / (df['std_sku'] + 1e-9)

            features = df[['cantidad', 'z_score']].fillna(0)

            logger.info(f"Entrenando Isolation Forest sobre {len(df)} registros...")
            preds = self.model.fit_predict(features)
            scores = self.model.decision_function(features)

            df['anomaly_score'] = scores
            df['is_anomaly'] = preds

            anomalies = df[df['is_anomaly'] == -1].copy()

            if anomalies.empty:
                logger.info("Sin anomalías detectadas.")
                return 0

            logger.info(f"Detectadas {len(anomalies)} anomalías. Guardando en Supabase...")

            def get_severity(score):
                if score < -0.15: return 'critical'
                if score < -0.05: return 'moderate'
                return 'low'

            alerts = []
            for _, row in anomalies.head(200).iterrows():  # Máximo 200 por ejecución
                alerts.append({
                    "sku_id": str(row.get('material', 'UNKNOWN')),
                    "sku_name": str(row.get('texto_material', ''))[:100],
                    "movement_type": "produccion",
                    "anomaly_score": round(float(row['anomaly_score']), 4),
                    "severity": get_severity(row['anomaly_score']),
                    "expected_value": round(float(row['mean_sku']), 2),
                    "actual_value": round(float(row['cantidad']), 2),
                    "deviation_pct": round(abs(float(row['cantidad']) - float(row['mean_sku'])) / (float(row['mean_sku']) + 1e-9) * 100, 2),
                    "status": "open"
                })

            if alerts:
                _supabase_insert("ai_anomaly_alerts", alerts)

            return len(alerts)

        except Exception as e:
            logger.error(f"Error en AnomalyDetector.run_audit: {e}")
            raise


def run_anomaly_audit() -> int:
    detector = AnomalyDetector()
    return detector.run_audit()


if __name__ == "__main__":
    count = run_anomaly_audit()
    print(f"Auditoría completada. Anomalías registradas: {count}")
