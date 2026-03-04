# Agentes Backend — Sistema PCP

## Motor de Pronósticos Híbrido (`forecast_engine.py`)

Script Python que genera pronósticos diarios a **90 días** para cada SKU, combinando datos históricos con planes comerciales/producción.

### Fuentes de Datos

| Fuente | Tabla Supabase | Tipo | Uso |
|--------|---------------|------|-----|
| Consumo histórico mensual | `sap_consumo_sku_mensual` | Pasado | ADU por tipo (consumo/venta) |
| Consumo histórico diario | `sap_consumo_diario_resumen` | Pasado | ADU reactivo últimos 90d |
| Producción real | `sap_produccion` | Pasado | ADU producción |
| Plan de ventas | `sap_demanda_proyectada` | Futuro | Plan comercial mensual → diario |
| Programa producción | `sap_programa_produccion` | Futuro | Producción y consumo MP del mes |
| Segmentación | `sap_plan_inventario_hibrido` | Config | ABC/XYZ, factor estacionalidad |

### Métodos de Pronóstico

1. **WMA** (Media Móvil Ponderada): Pondera los 3 últimos meses con pesos 3:2:1
2. **SES** (Suavización Exponencial Simple): α configurable (0.15–0.25), reactivo a cambios
3. **Croston**: Para demanda intermitente, calcula tamaño y frecuencia por separado
4. **Plan→Diario**: Plan comercial mensual ÷ días hábiles × factor de estacionalidad
5. **Programa Directo**: Dato del programa de producción del mes vigente

### Regla de Selección por Segmento ABC/XYZ

La tabla define automáticamente qué método usar y cuánto peso darle al plan vs al histórico:

| Segmento | Peso Plan | Peso Histórico | Método Histórico | Razón |
|----------|-----------|----------------|------------------|-------|
| **A-X** (alto vol., estable) | 0.6 | 0.4 | WMA | Plan comercial confiable, histórico valida |
| **A-Y** (alto vol., variable) | 0.4 | 0.6 | SES | Variabilidad alta, histórico da mejor señal |
| **A-Z** (alto vol., intermitente) | 0.3 | 0.7 | Croston | Patrón errático, Croston captura mejor |
| **B-X** (medio vol., estable) | 0.5 | 0.5 | WMA | Balance equilibrado |
| **B-Y** (medio vol., variable) | 0.4 | 0.6 | SES | Similar a A-Y pero más estable |
| **B-Z** (medio vol., intermitente) | 0.3 | 0.7 | Croston | Intermitente, Croston necesario |
| **C-\*** / **SP** (bajo impacto) | 0.7 | 0.3 | WMA | Bajo impacto, plan es suficiente |

**Reglas especiales:**
- Si **no hay histórico** (SKU nuevo) → **100% plan**
- Si **no hay plan** → **100% histórico**
- Si hay **programa de producción del mes vigente** → se usa directamente (reemplaza el cálculo)

### Salida

Tabla `sap_pronostico_diario` con un registro por SKU × día × tipo:

| Campo | Descripción |
|-------|-------------|
| `sku_id` | Código del material |
| `fecha` | Día del pronóstico |
| `tipo` | `consumo`, `venta`, o `produccion` |
| `cantidad_pronosticada` | Toneladas pronosticadas para ese día |
| `metodo_usado` | Método aplicado: WMA, SES, CROSTON, PLAN_DIRECTO, PROGRAMA |
| `fuente` | Origen: historico, plan, hibrido, programa |
| `peso_plan` / `peso_historico` | Pesos usados en la mezcla (0 a 1) |
| `abc_segment` / `xyz_segment` | Segmentos del SKU al momento del cálculo |

### Ejecución

```bash
# Manual
run_forecast.bat

# Automática (integrado en daily_sync.py)
run_daily.bat  # incluye pronóstico al final
```

---

## Otros Agentes

- **`report_master_persistor.py`**: Calcula y persiste el Reporte Maestro de proyección mensual
- **`data_validator.py`**: Validaciones de calidad de datos
- **`qa_engine.py`**: Motor de auditoría QA

---

## Clasificación de SKU: PT / ST / Dual

Un mismo código SAP puede comportarse de formas distintas según el contexto de consumo.
El sistema detecta automáticamente el rol funcional del SKU para elegir la fuente de plan correcta en los backtesting y proyecciones.

| Tipo | Criterio de detección | Fuente de Plan (backtesting) |
|------|-----------------------|------------------------------|
| **PT** (Producto Terminado) | Existe en `sap_demanda_proyectada` | Plan Comercial mensual ÷ días hábiles |
| **ST** (Semiterminado o MP) | Existe en `sap_programa_produccion.sku_consumo` | Programa de Producción del mes |
| **Dual** | Está en ambas fuentes (venta directa Y consumo interno) | Plan Comercial + Programa sumados |
| **Sin Plan** | No está en ninguna fuente | Solo se muestra historial real |

**Razón de usar el Programa de Producción para ST:**
La producción de un PT no corre al mismo ritmo que la venta (se produce en lotes, no diariamente como se vende). Por lo tanto, comparar el consumo de un ST contra el Plan de Venta del PT padre no tiene sentido. En cambio, compararlo contra el Programa de Producción (que ya incorpora la lógica de lotes y sku_consumo) revela con exactitud si el plan estimaba correctamente las necesidades de insumos.
