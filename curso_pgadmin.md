# 🎓 Curso Rápido: pgAdmin 4 y Configuración de Base de Datos

Este manual te guiará por las funciones principales de **pgAdmin 4** y cómo configurar la base de datos del proyecto **A+I-Planing**.

---

## 1. ¿Qué es pgAdmin 4?
Es la herramienta gráfica líder para gestionar bases de datos **PostgreSQL**. Te permite ver tablas, ejecutar consultas SQL y administrar usuarios sin usar comandos de terminal.

### 🛠️ Funciones Principales
1.  **Object Explorer (Explorador a la izquierda)**: Navega por servidores, bases de datos y tablas.
2.  **Query Tool (Herramienta de Consulta)**: El editor donde escribes código SQL. Se abre con el icono de un rayo ⚡ o clic derecho sobre una tabla > Query Tool.
3.  **Dashboard**: Gráficos en tiempo real sobre el estado del servidor (conexiones activas, transacciones).
4.  **Import/Export**: Para cargar datos desde archivos Excel/CSV directamente a las tablas.

---

## 2. Configuración de la Base de Datos (Paso a Paso)

Sigue estos pasos para conectar pgAdmin con tu base de datos local:

### Paso A: Registrar el Servidor
1.  Abre pgAdmin 4.
2.  Clic derecho en **Servers** > **Register** > **Server...**
3.  En la pestaña **General**:
    *   Name: `Proyectos Locales` (o el nombre que prefieras).
4.  En la pestaña **Connection**:
    *   Host name/address: `127.0.0.1`
    *   Port: `5432`
    *   Maintenance database: `postgres`
    *   Username: `postgres`
    *   Password: `Postgres2024!` (Marca "Save password" para no escribirla siempre).
5.  Clic en **Save**.

### Paso B: Seleccionar la Base de Datos del Proyecto
1.  Despliega el nuevo servidor en el explorador de la izquierda.
2.  Busca la base de datos llamada `aiplaning_local`.
    *   *Nota: Si no aparece, haz clic derecho en "Databases" > "Create" > "Database..." y nómbrala `aiplaning_local`.*

---

## 3. Cómo Visualizar las Tablas

Para ver los datos que estamos usando en el proyecto:

1.  Navega a: `Servers` > `Proyectos Locales` > `Databases` > `aiplaning_local` > `Schemas` > `public` > **Tables**.
2.  Allí verás tablas como:
    *   `sap_stock_mb52` (Inventario actual)
    *   `sap_consumo_movimientos` (Histórico de consumo)
    *   `sync_status_log` (Registro de sincronizaciones)
3.  **Para ver el contenido**: Clic derecho sobre una tabla > **View/Edit Data** > **All Rows**.

---

## 4. Inicializar el Esquema (Si la DB está vacía)
Si acabas de crear la base de datos y no tiene tablas:
1.  Clic derecho en `aiplaning_local` > **Query Tool**.
2.  Copia y pega el contenido del archivo `backend/create_local_schema.sql` que está en la carpeta de tu proyecto.
3.  Presiona **F5** (o el botón de Play ▶️).

¡Listo! Ya tienes acceso total a la base de datos desde la interfaz gráfica.
