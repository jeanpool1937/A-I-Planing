@echo off
echo ============================================
echo   Motor de Pronosticos Hibrido - PCP
echo ============================================
cd /d "%~dp0"
py -3 agents/forecast_engine.py
echo.
echo === Ejecucion completada ===
pause
