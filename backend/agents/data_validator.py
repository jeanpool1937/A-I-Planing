import os
import sys
import pandas as pd
import requests
import json
import logging
from datetime import datetime

# Configuración de Rutas para ejecución desde backend/agents/
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

# Cargar variables de entorno desde la raíz
from dotenv import load_dotenv
load_dotenv(os.path.join(ROOT_DIR, '.env'))

from backend.modules.api_client import get_headers, SUPABASE_URL

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class DataValidator:
    def __init__(self):
        self.headers = get_headers()
        self.issues = []

    def log_issue(self, severity, category, description, impact):
        issue = {
            "timestamp": datetime.now().isoformat(),
            "severity": severity,
            "category": category,
            "description": description,
            "impact": impact
        }
        self.issues.append(issue)
        logging.warning(f"ISSUE DETECTED [{severity}]: {description}")

    def audit_inventory_consistency(self):
        """Cruza stocks en MB52 vs Parámetros DDMRP"""
        logging.info("Auditing Inventory Consistency...")
        try:
            # Obtener MB52
            resp_mb52 = requests.get(f"{SUPABASE_URL}/rest/v1/sap_stock_mb52?select=material,libre_utilizacion", headers=self.headers)
            # Obtener Buffers (Usando la tabla correcta sap_plan_inventario_hibrido con columnas reales)
            # adu -> adu_hibrido_final
            resp_buffers = requests.get(f"{SUPABASE_URL}/rest/v1/sap_plan_inventario_hibrido?select=sku_id,adu_hibrido_final,abc_segment", headers=self.headers)
            
            if resp_mb52.status_code != 200:
                self.log_issue("Alta", "API", f"Error MB52: {resp_mb52.status_code} - {resp_mb52.text}", "No se puede auditar el stock")
                return
            if resp_buffers.status_code != 200:
                self.log_issue("Alta", "API", f"Error Buffers: {resp_buffers.status_code} - {resp_buffers.text}", "No se puede auditar el stock")
                return

            mb52_data = {item['material']: item['libre_utilizacion'] for item in resp_mb52.json()}
            buffers_data = {item['sku_id']: item for item in resp_buffers.json()}

            for sku, stock in mb52_data.items():
                if sku in buffers_data:
                    buf = buffers_data[sku]
                    # Validar ADU negativo (usando adu_hibrido_final)
                    adu = buf.get('adu_hibrido_final', 0)
                    if adu < 0:
                        self.log_issue("Crítica", "Integridad", f"SKU {sku} tiene ADU negativo: {adu}", "Cálculos de buffer erróneos")
                    
                    if stock < 0:
                        self.log_issue("Crítica", "Dato SAP", f"SKU {sku} tiene stock negativo en MB52: {stock}", "Inconsistencia en ERP o carga")

        except Exception as e:
            self.log_issue("Alta", "Script", f"Error en audit_inventory_consistency: {str(e)}", "Falla del agente QA")

    def audit_monthly_consumption(self):
        """Verifica que los consumos mensuales sumen correctamente"""
        logging.info("Auditing Monthly Consumption...")
        # Lógica de agregación manual vs vista reportada
        pass

    def get_summary(self):
        return self.issues

if __name__ == "__main__":
    validator = DataValidator()
    validator.audit_inventory_consistency()
    print(json.dumps(validator.get_summary(), indent=2))
