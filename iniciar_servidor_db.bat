@echo off
title A+I Planing - Servidor PostgreSQL Local
echo ===================================================
echo   INICIANDO SERVIDOR DATOS LOCAL (PUERTO 5433)
echo ===================================================

set PG_BIN="C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe"
set PG_DATA="D:\Base de datos\A+I-Planing\pg_local_data"

:: Verificar si existe postmaster.pid (posible cierre previo incorrecto)
if exist %PG_DATA%\postmaster.pid (
    echo [!] Detectado archivo de bloqueo residual. Limpiando...
    del /f %PG_DATA%\postmaster.pid
)

echo [i] Levantando servicio en port 5433...
%PG_BIN% -D %PG_DATA% -o "-p 5433" start

echo.
echo ===================================================
echo   SERVIDOR LISTO. YA PUEDES REFRESCAR PGADMIN.
echo ===================================================
pause
