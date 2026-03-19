# 🎨 Visualizadores Modernos y Acceso Local (A+I-Planing)

Dado que no tienes privilegios de administrador, hemos configurado una instancia de PostgreSQL "portátil" que corre en el **Disco D**.

## 🛑 El Secreto de la Conexión: ¡El Puerto 5433!

El error anterior ocurrió porque pgAdmin intentó conectar al puerto `5432` (el estándar). Para tu versión local sin admin, debes usar:

*   **Host**: `127.0.0.1`
*   **Puerto**: `5433`  <-- ESTO ES LO MÁS IMPORTANTE
*   **Usuario**: `postgres`
*   **Password**: *Puedes dejarlo vacío o poner cualquier cosa* (está configurado como `trust`).
*   **Base de Datos**: `aiplaning_local`

---

## 🔝 Recomendación: Beekeeper Studio (Moderno y Gratuito)

Como pgAdmin te resultaba antiguo, **Beekeeper Studio** es la opción ideal por su diseño moderno y oscuro.

### 📥 Pasos para instalar sin Admin:
1.  Descarga la versión "Portable" o "User Installer" de [Beekeeper Studio Community](https://www.beekeeperstudio.io/get).
2.  Ábrelo (no requiere admin).
3.  Crea una nueva conexión:
    *   **Connection Type**: Postgres
    *   **Host**: `127.0.0.1`
    *   **Port**: `5433`
    *   **User**: `postgres`
    *   **Database**: `aiplaning_local`
4.  ¡Dale a **Connect** y verás tus tablas con un diseño increíble!

---

## 🛠️ Cómo iniciar el servidor de datos
Si alguna vez no conecta, recuerda ejecutar primero este archivo en tu carpeta del proyecto:
`iniciar_servidor_db.bat`
*(Este script levanta la base de datos en el puerto 5433 sin pedirte permisos de administrador).*
