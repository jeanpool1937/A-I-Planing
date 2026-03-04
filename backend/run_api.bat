@echo off
echo ===================================================
echo   Iniciando API de Sincronizacion Local (PCP)
echo ===================================================
echo.
cd %~dp0
echo Ejecutando desde: %cd%
echo.
echo Para que el boton de "Sincronizar ahora" funcione, 
echo esta ventana debe permanecer abierta.
echo.
"C:\Users\EPALLARC\AppData\Local\Python\bin\python3.exe" api_server.py
pause
