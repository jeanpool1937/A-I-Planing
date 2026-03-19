from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import subprocess
import os
import sys

# Asegurar importaciones desde el directorio del script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(title="PCP Cognitive API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
SYNC_SCRIPT = os.path.join(BACKEND_DIR, "daily_sync.py")
PYTHON_EXE = sys.executable

sync_in_progress = False


class QueryRequest(BaseModel):
    question: str


class AnomalyAction(BaseModel):
    alert_id: str
    status: str
    notes: Optional[str] = None


def run_sync_process():
    global sync_in_progress
    try:
        print(f"Iniciando sincronización: {SYNC_SCRIPT}")
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        result = subprocess.run(
            [PYTHON_EXE, SYNC_SCRIPT],
            cwd=BACKEND_DIR,
            capture_output=True,
            text=True,
            env=env
        )
        print("Sincronización finalizada.")
        print("Salida:", result.stdout)
        if result.stderr:
            print("Errores:", result.stderr)
    except Exception as e:
        print(f"Error ejecutando sincronización: {e}")
    finally:
        sync_in_progress = False


@app.post("/run-sync")
async def run_sync(background_tasks: BackgroundTasks):
    global sync_in_progress
    if sync_in_progress:
        return {"status": "busy", "message": "Sincronización ya está en curso"}
    sync_in_progress = True
    background_tasks.add_task(run_sync_process)
    return {"status": "started", "message": "Sincronización iniciada en segundo plano"}


@app.get("/status")
async def get_status():
    return {"sync_in_progress": sync_in_progress}


@app.post("/cognitive/query")
async def cognitive_query(request: QueryRequest):
    """Procesa una pregunta en lenguaje natural y retorna una respuesta."""
    from cognitive.nlp_engine import process_cognitive_query
    result = await process_cognitive_query(request.question)
    return result


@app.get("/cognitive/anomalies")
async def get_anomalies(limit: int = 50):
    from modules.api_client import get_from_table
    try:
        data = get_from_table(
            "ai_anomaly_alerts", 
            select="*", 
            limit=limit, 
            order="detected_at.desc"
        )
        return data
    except Exception:
        return []


@app.post("/cognitive/anomalies/action")
async def anomaly_action(action: AnomalyAction):
    """Actualiza el estado de una alerta de anomalía."""
    from modules.api_client import patch_to_supabase
    payload = {"status": action.status, "review_notes": action.notes}
    filters = {"id": f"eq.{action.alert_id}"}
    try:
        resp = patch_to_supabase("ai_anomaly_alerts", payload, params=filters)
        return {"success": resp.status_code in (200, 204)}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
