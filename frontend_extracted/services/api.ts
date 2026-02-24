import { supabase } from './supabase';

export const api = {
    checkHealth: async (): Promise<boolean> => {
        // Simple check to see if we can reach Supabase
        const { error } = await supabase.from('sap_maestro_articulos').select('count', { count: 'exact', head: true });
        return !error;
    },

    getSystemStatus: async () => {
        // Query counts from all tables to build system status
        const [
            { count: maestro },
            { count: demanda },
            { count: movimientos },
            { count: stock },
            { count: produccion }
        ] = await Promise.all([
            supabase.from('sap_maestro_articulos').select('*', { count: 'exact', head: true }),
            supabase.from('sap_demanda_proyectada').select('*', { count: 'exact', head: true }),
            supabase.from('sap_consumo_movimientos').select('*', { count: 'exact', head: true }),
            supabase.from('sap_stock_mb52').select('*', { count: 'exact', head: true }),
            supabase.from('sap_produccion').select('*', { count: 'exact', head: true })
        ]);

        return {
            maestro: (maestro || 0) > 0,
            demanda: (demanda || 0) > 0,
            movimientos: (movimientos || 0) > 0,
            stock: (stock || 0) > 0,
            produccion: (produccion || 0) > 0
        };
    },

    resetDatabase: async () => {
        // Client-side reset is not allowed for security reasons in this architecture
        // This button should likely be hidden or repurposed
        console.warn("Reset database not supported in client-side mode");
        return { success: false, message: "Not supported" };
    },

    getStats: async () => {
        const { count } = await supabase.from('sap_maestro_articulos').select('*', { count: 'exact', head: true });
        return {
            total_skus: count || 0,
            last_sync: new Date().toISOString() // TODO: Get real last sync from logs/metadata table?
        };
    },

    getMaestro: async (skip = 0, limit = 1000, pais?: string) => {
        let query = supabase
            .from('view_tablero_pcp')
            .select('*')
            .order('codigo', { ascending: true })
            .range(skip, skip + limit - 1);

        if (pais && pais !== 'All') {
            query = query.eq('pais', pais);
        }

        const { data, error } = await query;
        if (error) throw error;
        return { items: data || [] };
    },

    // Upload functions are deprecated as sync is handled by automatic scripts
    uploadFile: async () => {
        throw new Error("Upload functionality is deprecated. Use automatic sync scripts.");
    },

    /**
     * Obtiene la demanda proyectada mensual para un SKU desde Supabase.
     * Retorna registros con { mes, cantidad } para el mes actual y siguiente.
     */
    getDemandaProyectada: async (skuId: string) => {
        const { data, error } = await supabase
            .from('sap_demanda_proyectada')
            .select('mes, cantidad')
            .eq('sku_id', skuId);

        if (error) {
            console.warn('Error fetching demanda proyectada:', error.message);
            return [];
        }
        return data || [];
    },

    /**
     * Obtiene la demanda explosionada para un mes específico.
     */
    getExplodedDemand: async (monthStr: string) => {
        const { data, error } = await supabase
            .from('view_exploded_demand')
            .select('*')
            .eq('mes', monthStr);

        if (error) {
            console.warn('Error fetching exploded demand:', error.message);
            return [];
        }
        return data || [];
    },

    /**
     * Obtiene toda la demanda explosionada futura.
     */
    getAllExplodedDemand: async (startMonth: string) => {
        let allData: any[] = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('view_exploded_demand')
                .select('*')
                .gte('mes', startMonth)
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                console.warn('Error fetching all exploded demand:', error.message);
                return [];
            }

            if (data && data.length > 0) {
                allData = [...allData, ...data];
                if (data.length < pageSize) hasMore = false;
                page++;
            } else {
                hasMore = false;
            }
        }
        return allData;
    },

    /**
     * Obtiene el stock actual (snapshot MB52) para un SKU.
     * Retorna desglose por centro/almacén.
     */
    getStockActual: async (skuId: string) => {
        const { data, error } = await supabase
            .from('sap_stock_mb52')
            .select('centro, almacen, cantidad_stock, almacen_valido')
            .eq('material', skuId);

        if (error) {
            console.warn('Error fetching stock actual:', error.message);
            return [];
        }
        return data || [];
    },

    /**
     * Obtiene el catálogo de clases de proceso.
     */
    getProcessClasses: async () => {
        const { data, error } = await supabase
            .from('sap_clase_proceso')
            .select('clase_proceso, descripcion_proceso');

        if (error) {
            console.warn('Error fetching process classes:', error.message);
            return [];
        }
        return data || [];
    },

    /**
     * Obtiene todos los registros de demanda para el dashboard.
     */
    getAllDemanda: async (startMonth?: string) => {
        let allData: any[] = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        const start = startMonth || new Date().toISOString().slice(0, 7) + '-01';

        while (hasMore) {
            const { data, error } = await supabase
                .from('sap_demanda_proyectada')
                .select('*')
                .gte('mes', start)
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                console.warn('Error fetching all demanda:', error.message);
                return [];
            }

            if (data && data.length > 0) {
                allData = [...allData, ...data];
                if (data.length < pageSize) hasMore = false;
                page++;
            } else {
                hasMore = false;
            }
        }
        return allData;
    },

    /**
     * Obtiene la producción programada (supply in) para un SKU desde el Plan de Producción.
     */
    getProduccionProgramada: async (skuId: string, startDate: string, endDate: string) => {
        const { data, error } = await supabase
            .from('sap_programa_produccion')
            .select('fecha, cantidad_programada, clase_proceso')
            .eq('sku_produccion', skuId)
            .gte('fecha', startDate)
            .lte('fecha', endDate);

        if (error) {
            console.warn('Error fetching produccion programada:', error.message);
            return [];
        }

        // Mapear cantidad_programada a 'programado' para compatibilidad con el resto del sistema
        return (data || []).map(r => ({
            fecha: r.fecha,
            programado: parseFloat(String(r.cantidad_programada || 0)),
            clase_proceso: r.clase_proceso
        }));
    },

    /**
     * Obtiene consumos de producción programados (demand out) para un SKU como materia prima.
     */
    getConsumoProduccion: async (skuId: string, startDate: string, endDate: string) => {
        const { data, error } = await supabase
            .from('sap_programa_produccion')
            .select('fecha, cantidad_programada, clase_proceso')
            .eq('sku_consumo', skuId)
            .gte('fecha', startDate)
            .lte('fecha', endDate);

        if (error) {
            console.warn('Error fetching consumo produccion:', error.message);
            return [];
        }

        // Mapear cantidad_programada a 'consumo' para compatibilidad
        return (data || []).map(r => ({
            fecha: r.fecha,
            consumo: parseFloat(String(r.cantidad_programada || 0)),
            clase_proceso: r.clase_proceso
        }));
    },

    /**
     * Obtiene el Factor de Estacionalidad e Incremento (FEI) para un SKU.
     */
    getFEIFactor: async (skuId: string): Promise<number> => {
        const { data, error } = await supabase
            .from('sap_plan_inventario_hibrido')
            .select('factor_fin_mes')
            .eq('sku_id', skuId)
            .single();

        if (error) {
            return 1.0; // Default no increment
        }
        return parseFloat(String(data?.factor_fin_mes || 1.0));
    },

    /**
     * Obtiene toda la demanda proyectada agregada por mes.
     * Usado por Dashboard y DemandPlanning para visualizar tendencias globales.
     */

    /**
     * Obtiene resumen de producción agrupado por mes para el dashboard.
     */
    getProduccionSummary: async () => {
        const { data, error } = await supabase
            .from('sap_produccion')
            .select('material, cantidad_tn, fecha_contabilizacion, clase_orden')
            .gte('fecha_contabilizacion', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
            .order('fecha_contabilizacion', { ascending: true });

        if (error) {
            console.warn('Error fetching produccion summary:', error.message);
            return [];
        }
        return data || [];
    },

    /**
     * Obtiene el historial de consumo (movimientos) agrupado para análisis.
     */
    // ... existing code ...
    /**
     * Obtiene TODO el historial de consumo (movimientos) para recálculo de ADU.
     * Trae los últimos X días (default 180) con paginación automática.
     */
    getAllMovimientos: async (days: number = 180) => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        console.log(`Fetching movements since ${startDateStr}...`);

        let allData: any[] = [];
        let page = 0;
        const pageSize = 1000; // Supabase default limit is 1000; 2000 was causing truncation without paging
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('sap_consumo_movimientos')
                .select('id, material_clave, fecha, cantidad_final_tn, tipo2')
                .gte('fecha', startDateStr)
                .order('fecha', { ascending: true })
                .order('id', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                console.error('Error fetching consumption history:', error);
                throw error;
            }

            if (data && data.length > 0) {
                allData = [...allData, ...data];
                // If we got less than pageSize, we're done
                if (data.length < pageSize) hasMore = false;
                page++;
            } else {
                hasMore = false;
            }
        }

        console.log(`Fetched ${allData.length} total movements.`);
        return allData;
    },

    /**
     * Ejecuta el procedimiento almacenado en Supabase para recalcular los agregados de consumo.
     * Basado en meses cerrados (mes anterior).
     */
    triggerDDMRUpdate: async (horizonMonths: number = 12) => {
        const { data, error } = await supabase.rpc('calculate_ddmr_aggregates', {
            horizon_months: horizonMonths
        });

        if (error) {
            console.error('Error triggering DDMR update:', error);
            throw error;
        }
        return data;
    },

    /**
     * Obtiene los consumos agregados pre-calculados desde la tabla optimizada.
     */
    getConsumoAgregado: async (pais?: string) => {
        let allData: any[] = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            let query = supabase
                .from('sap_consumo_sku_mensual')
                .select('*')
                .order('mes', { ascending: true })
                .order('sku_id', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (pais && pais !== 'All') {
                query = query.eq('pais', pais);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching consumption aggregates:', error);
                throw error;
            }

            if (data && data.length > 0) {
                allData = [...allData, ...data];
                if (data.length < pageSize) hasMore = false;
                page++;
            } else {
                hasMore = false;
            }
        }
        return allData;
    },

    getConsumoHistory: async () => {
        // Deprecated but kept for backward compatibility if needed
        // Just calls the new one with smaller window or direct query
        return api.getAllMovimientos(90);
    },

    /**
     * Configuration Methods
     */
    getDistinctGroups: async () => {
        const { data, error } = await supabase
            .from('sap_maestro_articulos')
            .select('grupo_articulos_descripcion')
            .not('grupo_articulos_descripcion', 'is', null);

        if (error) throw error;
        // Unique values
        return [...new Set(data?.map(item => item.grupo_articulos_descripcion))].sort();
    },

    getDistinctTypes: async () => {
        const { data, error } = await supabase
            .from('sap_maestro_articulos')
            .select('tipo_material')
            .not('tipo_material', 'is', null);

        if (error) throw error;
        return [...new Set(data?.map(item => item.tipo_material))].sort();
    },

    getDistinctStatuses: async () => {
        const { data, error } = await supabase
            .from('sap_almacenes_comerciales')
            .select('status')
            .not('status', 'is', null);

        if (error) throw error;
        return [...new Set(data?.map(item => item.status))].sort();
    },

    getStockRules: async () => {
        const { data, error } = await supabase
            .from('sap_config_reglas_stock')
            .select('*');

        if (error) throw error;
        return data || [];
    },

    upsertStockRule: async (grupo: string, tipo: string, statuses: string[]) => {
        const { data, error } = await supabase
            .from('sap_config_reglas_stock')
            .upsert({
                grupo_articulo: grupo,
                tipo_material: tipo,
                status_permitidos: statuses,
                updated_at: new Date().toISOString()
            }, { onConflict: 'grupo_articulo, tipo_material' })
            .select();

        if (error) throw error;
        return data;
    },

    deleteStockRule: async (id: string) => {
        const { error } = await supabase
            .from('sap_config_reglas_stock')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    getMaterialCombinations: async () => {
        const { data, error } = await supabase
            .from('sap_maestro_articulos')
            .select('grupo_articulos_descripcion, tipo_material');

        if (error) throw error;

        // Deduplicate
        const unique = new Map();
        data?.forEach(item => {
            const key = `${item.grupo_articulos_descripcion}|${item.tipo_material}`;
            if (!unique.has(key)) {
                unique.set(key, item);
            }
        });

        return Array.from(unique.values()).sort((a: any, b: any) =>
            a.grupo_articulos_descripcion.localeCompare(b.grupo_articulos_descripcion) ||
            a.tipo_material.localeCompare(b.tipo_material)
        );
    },

    /**
     * QUIEBRES CRÍTICOS y ANÁLISIS DE DESVIACIÓN
     */

    // 1. Get Critical Stock Items (logic similar to Dashboard but focused on criticals)
    getCriticalItems: async () => {
        // We reuse the main maestro logic but we could optimize if we had a dedicated view
        // For now, we fetch all and filter in frontend to ensure consistency with main logic
        return api.getMaestro(0, 2000);
    },

    // 2. Get Production Plan vs Real (Monthly)
    getProductionDeviation: async (monthStr: string) => {
        // monthStr format: 'YYYY-MM'

        // A. Plan: sap_programa_produccion
        const startOfMonth = `${monthStr}-01`;
        // Calculate end of month
        const [year, month] = monthStr.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const endOfMonth = `${monthStr}-${lastDay}`;

        const { data: planData, error: planError } = await supabase
            .from('sap_programa_produccion')
            .select('*')
            .gte('fecha', startOfMonth)
            .lte('fecha', endOfMonth);

        if (planError) throw planError;

        // B. Real: sap_produccion
        const { data: realData, error: realError } = await supabase
            .from('sap_produccion')
            .select('*')
            .gte('fecha_contabilizacion', startOfMonth)
            .lte('fecha_contabilizacion', endOfMonth)
            .limit(1000); // Limit para evitar bloqueo, idealmente usar agregación

        if (realError) throw realError;

        return { plan: planData || [], real: realData || [] };
    },

    // 3. Get Sales Deviation (PO Historico vs Movimientos Tipo2=Venta)
    getSalesDeviation: async (monthStr: string) => {
        const startOfMonth = `${monthStr}-01`;
        // Calculate end of month
        const [year, month] = monthStr.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const endOfMonth = `${monthStr}-${lastDay}`;

        // A. Plan: PO Historico (sap_demanda_proyectada)
        // Note: sap_demanda_proyectada 'mes' is usually first day of month
        const { data: planData, error: planError } = await supabase
            .from('sap_demanda_proyectada')
            .select('*')
            .eq('mes', startOfMonth);

        if (planError) throw planError;

        // B. Real: Movimientos (tipo2 = 'Venta' or similar)
        const { data: realData, error: realError } = await supabase
            .from('sap_consumo_movimientos')
            .select('*')
            .gte('fecha', startOfMonth)
            .lte('fecha', endOfMonth)
            // Filter by 'Venta' (or whatever value user confirms, generally 'Venta')
            // Using ilike for safety
            .ilike('tipo2', '%Venta%')
            .limit(1000);

        if (realError) throw realError;

        return { plan: planData || [], real: realData || [] };
    },

    // 4. Get Consumption Deviation (Programa Produccion Insumos vs Movimientos Tipo2=Consumo)
    getConsumptionDeviation: async (monthStr: string) => {
        const startOfMonth = `${monthStr}-01`;
        // Calculate end of month
        const [year, month] = monthStr.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const endOfMonth = `${monthStr}-${lastDay}`;

        // A. Plan: sap_programa_produccion (Insumos)
        // We look at 'sku_consumo' field in the program
        const { data: planData, error: planError } = await supabase
            .from('sap_programa_produccion')
            .select('*')
            .gte('fecha', startOfMonth)
            .lte('fecha', endOfMonth)
            .not('sku_consumo', 'is', null)
            .neq('sku_consumo', '0');

        if (planError) throw planError;

        // B. Real: Movimientos (tipo2 = 'Consumo')
        const { data: realData, error: realError } = await supabase
            .from('sap_consumo_movimientos')
            .select('*')
            .gte('fecha', startOfMonth)
            .lte('fecha', endOfMonth)
            .ilike('tipo2', '%Consumo%')
            .limit(1000);

        if (realError) throw realError;

        return { plan: planData || [], real: realData || [] };
    },

    /**
     * MASTER HYBRID PLANNING
     * Source of truth for all inventory intelligence
     */
    getHybridPlanningData: async (pais?: string) => {
        let allData: any[] = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        try {
            while (hasMore) {
                let query = supabase
                    .from('sap_plan_inventario_hibrido')
                    .select('*')
                    .range(page * pageSize, (page + 1) * pageSize - 1);

                if (pais && pais !== 'All') {
                    query = query.eq('pais', pais);
                }

                const { data, error } = await query;

                if (error) throw error;

                if (data) {
                    allData = [...allData, ...data];
                    if (data.length < pageSize) hasMore = false;
                    page++;
                } else {
                    hasMore = false;
                }
            }
            return allData;
        } catch (error) {
            console.error('Error fetching hybrid planning data:', error);
            throw error;
        }
    },

    /**
     * Force Recalculation of Hybrid Metrics
     * Triggers the PGSQL function to update L30d, 6m, and FEI immediately.
     */
    /**
     * MASTER REPORT SPECIFIC: Fetches all detailed movements, production, and planning for a month.
     * Includes automatic pagination for many records.
     */
    getMasterReportDetails: async (monthStr: string) => {
        const startOfMonth = `${monthStr}-01`;
        const [year, month] = monthStr.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const endOfMonth = `${monthStr}-${lastDay}`;

        const fetchAll = async (table: string, gteCol: string, lteCol: string) => {
            let all: any[] = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data, error } = await supabase
                    .from(table)
                    .select('*')
                    .gte(gteCol, startOfMonth)
                    .lte(lteCol, endOfMonth)
                    .range(page * pageSize, (page + 1) * pageSize - 1);

                if (error) throw error;
                if (data && data.length > 0) {
                    all = [...all, ...data];
                    if (data.length < pageSize) hasMore = false;
                    page++;
                } else {
                    hasMore = false;
                }
            }
            return all;
        };

        const [movimientos, produccion, programa] = await Promise.all([
            fetchAll('sap_consumo_movimientos', 'fecha', 'fecha'),
            fetchAll('sap_produccion', 'fecha_contabilizacion', 'fecha_contabilizacion'),
            supabase.from('sap_programa_produccion')
                .select('sku_produccion, cantidad_programada, sku_consumo')
                .gte('fecha', startOfMonth)
                .lte('fecha', endOfMonth)
        ]);

        return {
            movimientos: movimientos || [],
            produccion: produccion || [],
            programa: (programa.data as any[]) || []
        };
    },

    /**
     * Persiste los datos calculados del Reporte Maestro en la tabla consolidada.
     */
    upsertReporteMaestro: async (records: any[]) => {
        // 1. Limpiar datos existentes (Truncate manual vía Delete)
        // Nota: Solo borramos si el batch es el primero o si se decide hacer un reset total inicial
        // Para simplificar desde el front, el componente llamará a un delete inicial y luego mandará batches.
        const { error } = await supabase
            .from('sap_reporte_maestro')
            .upsert(records, { onConflict: 'sku_id' });

        if (error) throw error;
        return { success: true };
    },

    clearReporteMaestro: async () => {
        const { error } = await supabase
            .from('sap_reporte_maestro')
            .delete()
            .neq('sku_id', '0'); // Delete all

        if (error) throw error;
        return { success: true };
    }
};
