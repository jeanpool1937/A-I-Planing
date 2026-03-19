# 🐘 Guía de Uso de PostgreSQL (A+I-Planing)

Esta guía contiene los comandos y conceptos esenciales para interactuar con la base de datos del sistema.

## 1. Conexión a la Base de Datos
El sistema puede funcionar en dos modos (configurado en `backend/.env` vía `DB_MODE`):
- **Local**: Se conecta a tu PostgreSQL en `127.0.0.1` (Puerto 5433).
- **Supabase**: Se conecta a la nube.

### Conexión por Terminal (psql)
```bash
psql -U postgres -d aiplaning_local -p 5433
```

## 2. Consultas Esenciales del Proyecto

### Ver el Stock Actual (MB52)
```sql
SELECT material, descripcion, centro, unrestocks 
FROM sap_stock_mb52 
ORDER BY unrestocks DESC 
LIMIT 10;
```

### Consultar Consumo Histórico
```sql
SELECT material_clave, fecha, cantidad_final_tn 
FROM sap_consumo_movimientos 
WHERE material_clave = 'TU_CODIGO_MATERIAL'
ORDER BY fecha DESC;
```

### Ver Log de Sincronizaciones
```sql
SELECT run_date, table_name, status, rows_upserted 
FROM sync_status_log 
ORDER BY executed_at DESC 
LIMIT 5;
```

## 3. Comandos CRUD Básicos

- **SELECT**: Ver datos.
  `SELECT * FROM tabla;`
- **INSERT**: Agregar datos.
  `INSERT INTO tabla (col1, col2) VALUES ('val1', 100);`
- **UPDATE**: Modificar datos.
  `UPDATE sap_stock_mb52 SET unrestocks = 50 WHERE material = '123';`
- **DELETE**: Borrar datos (¡CUIDADO!).
  `DELETE FROM sync_status_log WHERE status = 'error';`

## 4. Mantenimiento Local (Disco D)
Si necesitas resetear el esquema local:
```bash
psql -U postgres -d aiplaning_local -p 5433 -f backend/create_local_schema.sql
```
