import React, { useState, useEffect, useMemo } from 'react';
import { SKU } from '../types';
import { api } from '../services/api';
import * as XLSX from 'xlsx';
import { useData } from '../contexts/DataContext';

interface MasterReportProps {
    filteredSkus: SKU[];
}

export const MasterReport: React.FC<MasterReportProps> = ({ filteredSkus }) => {
    const { isBackendOnline, addLog, rawAggregatedConsumption, rawHybridPlanning } = useData();
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
    const [reportData, setReportData] = useState<{ movimientos: any[], produccion: any[], programa: any[] } | null>(null);

    // Calculate current and next month strings
    const now = new Date();
    const currentMonthStr = now.toISOString().slice(0, 7); // YYYY-MM
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthStr = nextMonthDate.toISOString().slice(0, 7);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const data = await api.getMasterReportDetails(currentMonthStr);
                setReportData(data);
            } catch (e) {
                console.error("MasterReport: Error fetching details", e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentMonthStr]);

    // Process data for each SKU
    const reportRecords = useMemo(() => {
        const prodRealMap: Record<string, number> = {};
        const prodPlanMap: Record<string, number> = {};
        const realMovMap: Record<string, number> = {};

        if (reportData) {
            // 1. Real Fabricado (sap_produccion) - Ahora viene agregado desde RPC
            reportData.produccion.forEach(r => {
                const sid = (r.sku || '').toString().replace(/^0+/, '');
                prodRealMap[sid] = (prodRealMap[sid] || 0) + (Number(r.total) || 0);
            });
            // 2. Proyectado Fabricado (sap_programa_produccion)
            reportData.programa.forEach(p => {
                const sid = (p.sku || '').toString().replace(/^0+/, '');
                prodPlanMap[sid] = (prodPlanMap[sid] || 0) + (Number(p.total) || 0);
            });
            // 3. Real Venta/Movimientos (sap_consumo_movimientos)
            reportData.movimientos.forEach(m => {
                const sid = (m.sku || '').toString().replace(/^0+/, '');
                realMovMap[sid] = (realMovMap[sid] || 0) + (Number(m.total) || 0);
            });
        } else {
            // FALLBACK: Use rawAggregatedConsumption for Real Venta/Consumo if it's the current month
            rawAggregatedConsumption.forEach(agg => {
                const month = (agg.mes || '').substring(0, 7);
                if (month === currentMonthStr) {
                    const sid = (agg.sku_id || '').toString().replace(/^0+/, '');
                    realMovMap[sid] = (realMovMap[sid] || 0) + (Number(agg.cantidad_total_tn) || 0);
                }
            });

            // FALLBACK: Use rawHybridPlanning for Proyectado Fabricado (Total target)
            rawHybridPlanning.forEach(item => {
                const sid = (item.sku_id || '').toString().replace(/^0+/, '');
                prodPlanMap[sid] = Number(item.cantidad_planificada_total_tn) || 0;
            });
        }

        return filteredSkus.map(sku => {
            const skuIdClean = sku.id.toString().replace(/^0+/, '');

            // 1. PO Mes actual (Demanda Proyectada)
            const poActual = sku.forecast[0] || 0;

            // 2. Producción y Ventas Reales (Mes Actual)
            const realFabricado = prodRealMap[skuIdClean] || 0;
            const realVenta = realMovMap[skuIdClean] || 0;

            // 3. Stock Inicio Mes
            // Retrocalc: Stock al 1 del mes = Stock Hoy - Real Fab + Real Venta
            const initialStock = sku.stockLevel - realFabricado + realVenta;

            // 4. Cobertura inicial (Stock Inicio Mes / PO Mes Actual)
            const coverageInitial = poActual > 0 ? (initialStock / poActual) : 0;

            // 5. Stock MB52 Hoy
            const stockHoy = sku.stockLevel;

            // 6. Cobertura Actual (Stock Hoy / PO Mes Actual)
            const coverageActual = poActual > 0 ? (stockHoy / poActual) : 0;

            // 7. Proyectado Venta y Consumo (Restante hasta fin de mes)
            const fei = sku.fei || 1.0;
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const currentDay = now.getDate();
            const remainingDays = Math.max(0, daysInMonth - currentDay);
            const projectedConsumoRem = sku.adu * remainingDays * fei;

            // 8. Proyectado Fabricado (Restante hasta fin de mes)
            const totalProgrammed = prodPlanMap[skuIdClean] || 0;
            const projectedFabricadoRem = Math.max(0, totalProgrammed - realFabricado);

            // 9. Stock fin mes: Stock Hoy + Producción que falta - Consumo que falta
            const stockFinMes = stockHoy + projectedFabricadoRem - projectedConsumoRem;

            // 10. PO Prox mes
            const poProxMes = sku.forecast[1] || 0;

            // 11. Cobertura final (Stock Fin Mes / PO Prox Mes)
            const coverageFinal = poProxMes > 0 ? (stockFinMes / poProxMes) : 0;

            return {
                sku: sku.id,
                desc: sku.name,
                poActual,
                coverageInitial,
                initialStock,
                realConsumo: realVenta,
                realFabricado,
                stockHoy,
                coverageActual,
                projectedConsumo: projectedConsumoRem,
                projectedFabricado: projectedFabricadoRem,
                stockFinMes,
                poProxMes,
                coverageFinal
            };
        });
    }, [filteredSkus, reportData, rawAggregatedConsumption, rawHybridPlanning, currentMonthStr, now]);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 50;

    // Reset to page 1 when filtered SKUs change
    useEffect(() => {
        setCurrentPage(1);
    }, [filteredSkus]);

    const totalPages = Math.ceil(reportRecords.length / PAGE_SIZE);
    const paginatedRecords = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return reportRecords.slice(start, start + PAGE_SIZE);
    }, [reportRecords, currentPage]);

    const exportToExcel = () => {
        // ... (existing export logic correctly uses reportRecords, which is full data)
        addLog("Generando archivo Excel...");
        const worksheet = XLSX.utils.json_to_sheet(reportRecords.map(r => ({
            "SKU": r.sku,
            "Descripción": r.desc,
            "PO Mes Actual": Math.round(r.poActual),
            "Cobertura Inicial": r.coverageInitial.toFixed(2),
            "Stock Inicio Mes": Math.round(r.initialStock),
            "Real Venta/Consumo": Math.round(r.realConsumo),
            "Real Fabricado": Math.round(r.realFabricado),
            "Stock Hoy": Math.round(r.stockHoy),
            "Cobertura Actual": r.coverageActual.toFixed(2),
            "Proyectado Venta/Consumo": Math.round(r.projectedConsumo),
            "Proyectado Fabricado": Math.round(r.projectedFabricado),
            "Stock Fin Mes": Math.round(r.stockFinMes),
            "PO Próx Mes": Math.round(r.poProxMes),
            "Cobertura Final": r.coverageFinal.toFixed(2)
        })));

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte Maestro");

        XLSX.writeFile(workbook, `Reporte_Maestro_PCP_${currentMonthStr}.xlsx`);
        addLog("Reporte exportado correctamente.");
    };

    const syncToDatabase = async () => {
        if (!reportRecords.length) return;

        setSyncing(true);
        setSyncProgress({ current: 0, total: reportRecords.length });
        addLog("Iniciando sincronización manual con Supabase...");

        try {
            // 1. Limpiar tabla primero
            await api.clearReporteMaestro();

            // 2. Batching (Lotes de 500)
            const BATCH_SIZE = 500;
            const records = reportRecords.map(r => ({
                sku_id: r.sku,
                descripcion: r.desc,
                po_mes_actual: r.poActual,
                coverage_initial: r.coverageInitial,
                stock_inicio_mes: r.initialStock,
                real_venta_consumo: r.realConsumo,
                real_fabricado: r.realFabricado,
                stock_hoy: r.stockHoy,
                coverage_actual: r.coverageActual,
                projected_venta_consumo: r.projectedConsumo,
                projected_fabricado: r.projectedFabricado,
                stock_fin_mes: r.stockFinMes,
                po_prox_mes: r.poProxMes,
                coverage_final: r.coverageFinal,
                updated_at: new Date().toISOString()
            }));

            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                const batch = records.slice(i, i + BATCH_SIZE);
                await api.upsertReporteMaestro(batch);
                setSyncProgress(prev => ({ ...prev, current: Math.min(i + BATCH_SIZE, records.length) }));
            }

            addLog("¡Sincronización exitosa! Los datos están en Supabase.");
            alert("Los datos del reporte han sido persistidos correctamente en la base de datos.");
        } catch (error: any) {
            console.error("Sync error:", error);
            addLog(`Error en sincronización: ${error.message}`);
            alert("Hubo un error al intentar guardar los datos.");
        } finally {
            setSyncing(false);
            setSyncProgress({ current: 0, total: 0 });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-dark-900/50 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center gap-3">
                    <span className="material-symbols-rounded text-primary-500">info</span>
                    <p className="text-sm text-slate-300">Este reporte proyecta el stock al cierre de mes considerando el **Factor de Estacionalidad (FEI)**.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={syncToDatabase}
                        disabled={syncing || reportRecords.length === 0}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium text-sm shadow-lg overflow-hidden relative ${syncing
                            ? 'bg-slate-800 text-slate-400 cursor-wait'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                            }`}
                    >
                        {syncing && (
                            <div
                                className="absolute bottom-0 left-0 h-1 bg-indigo-400 transition-all duration-300"
                                style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                            />
                        )}
                        <span className={`material-symbols-rounded text-lg ${syncing ? 'animate-spin' : ''}`}>
                            {syncing ? 'sync' : 'cloud_upload'}
                        </span>
                        {syncing
                            ? `Sincronizando ${syncProgress.current}/${syncProgress.total}...`
                            : 'Sincronizar con DB'
                        }
                    </button>
                    <button
                        onClick={exportToExcel}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors shadow-lg shadow-emerald-600/20 font-medium text-sm"
                    >
                        <span className="material-symbols-rounded text-lg">download</span>
                        Exportar Excel (.xlsx)
                    </button>
                </div>
            </div>

            <div className="bg-dark-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-[11px] text-left border-collapse">
                        <thead>
                            <tr className="bg-dark-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                                <th className="p-3 font-bold sticky left-0 bg-dark-950 z-10 border-r border-slate-800">SKU / Descripción</th>
                                <th className="p-3 font-bold text-center bg-blue-900/20">PO Mes Actual</th>
                                <th className="p-3 font-bold text-center bg-blue-900/20">Cob. Inicial</th>
                                <th className="p-3 font-bold text-center">Stock Inicio</th>
                                <th className="p-3 font-bold text-center bg-green-900/20">Real Venta</th>
                                <th className="p-3 font-bold text-center bg-green-900/20">Real Fab</th>
                                <th className="p-3 font-bold text-center bg-amber-900/20">Stock MB52 Hoy</th>
                                <th className="p-3 font-bold text-center bg-amber-900/20">Cob. Actual</th>
                                <th className="p-3 font-bold text-center bg-indigo-900/20">Proy. Venta</th>
                                <th className="p-3 font-bold text-center bg-indigo-900/20">Proy. Fab</th>
                                <th className="p-3 font-bold text-center bg-amber-950">Stock Fin Mes</th>
                                <th className="p-3 font-bold text-center">PO Próx Mes</th>
                                <th className="p-3 font-bold text-center">Cob. Final</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {paginatedRecords.map(r => (
                                <tr key={r.sku} className="hover:bg-slate-800/30 transition-colors">
                                    <td className="p-2 border-r border-slate-800 sticky left-0 bg-dark-900 z-10 w-48">
                                        <p className="font-bold text-white font-mono">{r.sku}</p>
                                        <p className="text-slate-500 truncate">{r.desc}</p>
                                    </td>
                                    <td className="p-2 text-right font-mono text-slate-300">{Math.round(r.poActual).toLocaleString()}</td>
                                    <td className={`p-2 text-center font-bold ${r.coverageInitial < 0.3 ? 'text-red-400' : 'text-slate-400'}`}>{r.coverageInitial.toFixed(2) === 'NaN' ? '0.00' : r.coverageInitial.toFixed(2)}</td>
                                    <td className="p-2 text-right font-mono text-slate-400">{Math.round(r.initialStock).toLocaleString()}</td>
                                    <td className="p-2 text-right font-mono text-slate-200">{Math.round(r.realConsumo).toLocaleString()}</td>
                                    <td className="p-2 text-right font-mono text-slate-200">{Math.round(r.realFabricado).toLocaleString()}</td>
                                    <td className="p-2 text-right font-mono font-bold text-amber-300 bg-amber-500/5">{Math.round(r.stockHoy).toLocaleString()}</td>
                                    <td className="p-2 text-center font-bold text-slate-400">{r.coverageActual.toFixed(2) === 'NaN' ? '0.00' : r.coverageActual.toFixed(2)}</td>
                                    <td className="p-2 text-right font-mono text-indigo-300">{Math.round(r.projectedConsumo).toLocaleString()}</td>
                                    <td className="p-2 text-right font-mono text-indigo-300">{Math.round(r.projectedFabricado).toLocaleString()}</td>
                                    <td className={`p-2 text-right font-mono font-bold bg-amber-950/30 ${r.stockFinMes < 0 ? 'text-red-500' : 'text-white'}`}>
                                        {Math.round(r.stockFinMes).toLocaleString()}
                                    </td>
                                    <td className="p-2 text-right font-mono text-slate-400">{Math.round(r.poProxMes).toLocaleString()}</td>
                                    <td className={`p-2 text-center font-bold ${r.coverageFinal < 0.3 ? 'text-red-400' : 'text-slate-400'}`}>{r.coverageFinal.toFixed(2) === 'NaN' ? '0.00' : r.coverageFinal.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {reportRecords.length === 0 && (
                        <div className="p-12 text-center text-slate-500 bg-dark-900">
                            No hay SKUs que coincidan con los filtros actuales.
                        </div>
                    )}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between p-4 bg-dark-950 border-t border-slate-800">
                        <p className="text-xs text-slate-500">
                            Mostrando <span className="text-slate-300">{(currentPage - 1) * PAGE_SIZE + 1}</span> a <span className="text-slate-300">{Math.min(currentPage * PAGE_SIZE, reportRecords.length)}</span> de <span className="text-slate-300">{reportRecords.length}</span> resultados
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1 bg-dark-800 text-slate-300 rounded hover:bg-slate-700 disabled:opacity-30 transition-colors text-xs"
                            >
                                Anterior
                            </button>
                            <div className="flex items-center px-4 text-xs font-mono text-primary-400">
                                {currentPage} / {totalPages}
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1 bg-dark-800 text-slate-300 rounded hover:bg-slate-700 disabled:opacity-30 transition-colors text-xs"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
