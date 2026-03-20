from fastapi import FastAPI, BackgroundTasks, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Any, Dict, List
import subprocess
import os
import sys
import json

# Asegurar importaciones desde el directorio del script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Importar cliente de base de datos local
from modules.api_client import get_from_table, post_to_supabase, patch_to_supabase, call_rpc

app = FastAPI(title="PCP Cognitive API & Supabase Mock")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Range"]
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

# --- CAPA DE COMPATIBILIDAD SUPABASE (REST API MOCK) ---

@app.get("/rest/v1/{table}")
async def supabase_get_mock(table: str, request: Request):
    """Mimetiza el comportamiento de la API REST de Supabase para lecturas."""
    params = dict(request.query_params)
    select = params.pop("select", "*")
    limit = int(params.pop("limit", 1000))
    
    # El resto de params se tratan como filtros (eq., gte., etc.)
    try:
        data = get_from_table(table, select=select, params=params, limit=limit)
        return data
    except Exception as e:
        print(f"Error en Mock GET {table}: {e}")
        return JSONResponse(status_code=400, content={"error": str(e)})

@app.post("/rest/v1/{table}")
async def supabase_post_mock(table: str, request: Request):
    """Mimetiza las inserciones de Supabase."""
    payload = await request.json()
    try:
        post_to_supabase(table, payload)
        return JSONResponse(status_code=201, content={"status": "created"})
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

@app.patch("/rest/v1/{table}")
async def supabase_patch_mock(table: str, request: Request):
    """Mimetiza las actualizaciones de Supabase."""
    payload = await request.json()
    params = dict(request.query_params)
    try:
        patch_to_supabase(table, payload, params=params)
        return JSONResponse(status_code=200, content={"status": "updated"})
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

@app.post("/rest/v1/rpc/{rpc_name}")
async def supabase_rpc_mock(rpc_name: str, request: Request):
    """Mimetiza llamadas RPC de Supabase."""
    try:
        payload = await request.json()
    except:
        payload = {}
    
    try:
        result = call_rpc(rpc_name, payload)
        # Supabase RPC suele retornar el valor directamente
        if isinstance(result, dict) and "result" in result:
            return result["result"]
        return result
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

# --- ENDPOINTS ORIGINALES ---

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
    from cognitive.nlp_engine import process_cognitive_query
    result = await process_cognitive_query(request.question)
    return result

if __name__ == "__main__":
    import uvicorn
    # Escuchar en todas las interfaces para permitir el túnel
    uvicorn.run(app, host="0.0.0.0", port=8000)
