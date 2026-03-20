@echo off
title Servidor PCP - Datos 100%% Locales
echo ========================================================
echo   INICIANDO SERVIDOR DE DATOS LOCALES (TÚNEL SEGURO)
echo ========================================================
echo.

:: 1. Verificar si el entorno virtual o python está listo
where python >nul 2>nul
if %%ERRORLEVEL%% neq 0 (
    echo [ERROR] No se encontró Python en el PATH.
    pause
    exit /b
)

:: 2. Asegurar que las dependencias están instaladas
echo [1/3] Verificando dependencias (FastAPI, Uvicorn, Psycopg2)...
python -m pip install fastapi uvicorn psycopg2-binary python-dotenv requests certifi >nul 2>nul

:: 3. Iniciar el Servidor de API en segundo plano
echo [2/3] Iniciando Servidor API en el puerto 8000...
start /b python api_server.py

:: 4. Instrucciones para el Túnel
echo.
echo [3/3] EL SERVIDOR ESTÁ CORRIENDO LOCALMENTE.
echo.
echo IMPORTANTE: Para que la web (GitHub Pages) lo vea, abre OTRA terminal y corre:
echo.
echo    npx localtunnel --port 8000
echo.
echo Una vez que tengas la URL (ej: https://pretty-cats-run.loca.lt),
echo cópiala y pégala cuando el sistema te lo pida.
echo.
echo ========================================================
echo Manten esta ventana abierta mientras uses la aplicacion.
echo ========================================================
pause
