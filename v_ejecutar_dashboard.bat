@echo off
title A+I Planing - Dashboard de Datos
echo ===================================================
echo   INICIANDO DASHBOARD INTERACTIVO (STREAMLIT)
echo ===================================================

set PYTHON=C:\Users\EPALLARC\AppData\Local\Python\pythoncore-3.14-64\python.exe
set STREAMLIT=C:\Users\EPALLARC\AppData\Local\Python\pythoncore-3.14-64\Scripts\streamlit.exe

echo [i] Preparando entorno de visualizacion...
cd /d "%~dp0backend"
"%STREAMLIT%" run dashboard.py --server.port 8501 --server.headless true

echo.
echo ===================================================
echo   SI EL NAVEGADOR NO SE ABRE AUTOMATICAMENTE:
echo   VE A: http://localhost:8501
echo ===================================================
pause
