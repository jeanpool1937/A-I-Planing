@echo off
echo ============================================================
echo   SYNC MENSUAL - Demanda Proyectada (PO Historico)
echo   Programado para ejecutarse el dia 15 de cada mes
echo ============================================================
cd /d "%~dp0"
"C:\Users\EPALLARC\AppData\Local\Python\bin\python3.exe" monthly_sync_demanda.py
pause
