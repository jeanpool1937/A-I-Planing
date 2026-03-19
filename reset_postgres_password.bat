@echo off
setlocal EnableDelayedExpansion

:: Script para restablecer la contraseña de PostgreSQL 16
:: Este script solicita privilegios de Administrador automáticamente.

:: ---------------------------------------------------------
:: 1. AUTO-ELEVACIÓN (Solicitar Administrador)
:: ---------------------------------------------------------
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Solicitando permisos de Administrador...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: ---------------------------------------------------------
:: 2. CONFIGURACIÓN DE RUTAS
:: ---------------------------------------------------------
SET PGPATH=C:\Program Files\PostgreSQL\16
SET DATADIR=%PGPATH%\data
SET BIN=%PGPATH%\bin

title Restablecer Contrasena PostgreSQL 16

echo.
echo =======================================================
echo   PROCESO DE RESTABLECIMIENTO DE CONTRASENA (ADMIN)
echo =======================================================
echo.

if not exist "!DATADIR!\pg_hba.conf" (
    echo [ERROR] No se encontro pg_hba.conf en: !DATADIR!
    echo Por favor, verifica tu instalacion de PostgreSQL 16.
    pause
    exit /b
)

:: ---------------------------------------------------------
:: 3. RESPALDO Y MODIFICACIÓN
:: ---------------------------------------------------------
echo [1/5] Creando copia de seguridad: pg_hba.conf.backup
copy /y "!DATADIR!\pg_hba.conf" "!DATADIR!\pg_hba.conf.backup" || (echo Fallo el respaldo. & pause & exit /b)

echo [2/5] Configurando acceso temporal 'trust'...
copy /y "!DATADIR!\pg_hba.conf" "!DATADIR!\pg_hba.conf.temp" >nul
(
echo # ACCESO TEMPORAL PARA RESET
echo local   all             all                                     trust
echo host    all             all             127.0.0.1/32            trust
echo host    all             all             ::1/128                 trust
) > "!DATADIR!\pg_hba.conf"

:: ---------------------------------------------------------
:: 4. REINICIO DE SERVICIO Y CAMBIO DE CLAVE
:: ---------------------------------------------------------
echo [3/5] Reiniciando servicio postgresql-x64-16...
net stop postgresql-x64-16
net start postgresql-x64-16

echo [4/5] Aplicando nueva clave: Postgres2024!
timeout /t 5 /nobreak >nul
"!BIN!\psql.exe" -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'Postgres2024!';" -h 127.0.0.1 || (echo Fallo el cambio de clave. & pause)

:: ---------------------------------------------------------
:: 5. RESTAURACIÓN DE SEGURIDAD
:: ---------------------------------------------------------
echo [5/5] Restaurando configuracion original de seguridad...
copy /y "!DATADIR!\pg_hba.conf.backup" "!DATADIR!\pg_hba.conf" >nul
net stop postgresql-x64-16
net start postgresql-x64-16

echo.
echo =======================================================
echo   ¡EXITO! Contrasena actualizada a: Postgres2024!
echo =======================================================
echo.
pause
