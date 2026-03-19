@echo off
title A+I Planing - Lanzador Maestro del Sistema (PCP)
echo ===================================================
echo   INICIANDO TODO EL ECOSISTEMA PCP (OFFLINE)
echo ===================================================

:: 1. Iniciar Base de Datos Local en segundo plano
echo [1/3] Levantando Servidor PostgreSQL (Puerto 5433)...
start /min cmd /c "iniciar_servidor_db.bat"
timeout /t 5 /nobreak > nul

:: 2. Iniciar Backend API en ventana separada (MINIMIZADA)
echo [2/3] Levantando Backend FastAPI...
start /min "Backend - PCP API" cmd /c "cd backend && C:\Users\EPALLARC\AppData\Local\Python\bin\python3.exe api_server.py"

:: 3. Iniciar Frontend Vite en ventana separada (MINIMIZADA)
echo [3/3] Levantando Frontend React/Vite...
start /min "Frontend - PCP Web" cmd /c "cd frontend_extracted && npm run dev"

echo.
echo ===================================================
echo      SISTEMA INICIADO - TODO ESTA EN SEGUNDO PLANO
echo ===================================================
echo.
echo Las ventanas se han iniciado minimizadas para no estorbar.
echo Puedes verlas en la barra de tareas si necesitas ver logs.
echo.
echo Para entrar al sistema:
echo 1. WEB PRINCIPAL: http://localhost:3000
echo 2. DASHBOARD:     http://localhost:8501
echo.
pause
