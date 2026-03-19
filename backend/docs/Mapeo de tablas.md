# 📊 Sincronización SAP → Local / Supabase (Híbrido)

Guía de referencia para el flujo de datos automatizado entre archivos Excel (SAP) y la base de datos (PostgreSQL Local o Supabase).

**Modo de Operación Actual:** Configurado en `.env` vía `DB_MODE` (local/supabase).
**Directorio del Proyecto:** `D:\Base de datos\A+I-Planing\backend\`

---

## 🗂️ Mapa de Tablas y Fuentes de Datos

### Sincronización Diaria (`daily_sync.py`)

| Tabla | Archivo Excel | Hoja | Estrategia |
|---|---|---|---|
| `sap_consumo_movimientos` | `.../Movimientos/ConsumoMes.xlsx` | (auto) | Deduplicación |
| `sap_produccion` | `.../Produccion/ProduccionMes.xlsx` | (auto) | Deduplicación |
| `sap_stock_mb52` | `.../COBERTURAS/MB52.XLSX` | Sheet1 | **Truncate + Replace** |
| `sap_programa_produccion` | `.../COBERTURAS/Planes 2025.xlsm` | BASE DATOS | **Truncate + Replace** |

### Sincronización Mensual (`monthly_sync.py`)

| Tabla | Archivo Excel | Hoja | Estrategia |
|---|---|---|---|
| `sap_consumo_movimientos` | `.../Movimientos/Consumo 2020-2025.xlsx` | (auto) | Deduplicación |
| `sap_produccion` | `.../Produccion/Reporte de Prod. 2020-2025.xlsx` | (auto) | Deduplicación |
| `sap_maestro_articulos` | `.../COBERTURAS/Maestro de Articulos.xlsx` | Articulos | Upsert (PK: `codigo`) |
| `sap_clase_proceso` | `.../COBERTURAS/Maestro de Articulos.xlsx` | Procesos | Upsert (PK: `clase_proceso`) |
| `sap_centro_pais` | `.../COBERTURAS/Maestro de Articulos.xlsx` | Centro | Upsert (PK: `centro_id`) |
| `sap_almacenes_comerciales` | `.../COBERTURAS/Maestro de Articulos.xlsx` | Centro | Upsert (PK: `centro`, `id`) |

### Sincronización de Demanda (`monthly_sync_demanda.py`)

| Tabla | Archivo Excel | Hoja | Estrategia |
|---|---|---|---|
| `sap_demanda_proyectada` | `.../PO Histórico.xlsx` | (auto) | **Truncate + Replace** |

---

## 📁 Estructura del Backend Centralizado

- `modules/api_client.py`: Router inteligente (Local vs Nube).
- `modules/pg_client.py`: Driver para PostgreSQL 16 (Puerto 5433).
- `agents/inventory_engine.py`: Motor de cálculo SS, ROP y ABC/XYZ.
- `agents/forecast_engine.py`: Motor de pronósticos híbridos (90 días).
- `agents/report_master_persistor.py`: Consolidación del Reporte Maestro.
- `daily_sync.py`: Orquestador diario.
- `monthly_sync.py`: Orquestador masivo/maestro.
- `refresh_historical_consumo.py`: Herramienta para recarga total de históricos.

---

## ⏰ Tareas Programadas Recomendadas
Para total autonomía, las tareas de Windows deben apuntar a la carpeta del repositorio:
1. `run_daily.bat`
2. `run_monthly.bat`
3. `run_monthly_demanda.bat`
4. `run_forecast.bat`
