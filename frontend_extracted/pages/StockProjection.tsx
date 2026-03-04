import React, { useState, useEffect } from 'react';
import { useData } from '../contexts/DataContext';
import {
    ComposedChart,
    Line,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    ReferenceLine,
    Area
} from 'recharts';
import { calculateProjection, calculateInitialStock, ProjectionDay } from '../utils/projection';
import { api } from '../services/api';
import { HistoricalValidationChart } from '../components/HistoricalValidationChart';

interface ProjectionData {
    date: string;
    psoh: number;
    supply_in: number;
    demand_out: number;
    status: 'healthy' | 'warning' | 'critical';
    supply_breakdown?: Record<string, number>;
    demand_breakdown?: Record<string, number>;
    stock_breakdown?: Record<string, number | { qty: number; is_valid: boolean }>;
}

interface SkuAlert {
    sku: string;
    type: 'critical' | 'warning' | 'delay_risk';
    date: string;
    psoh: number;
    days_until: number;
}

interface StockProjectionProps {
    sharedSkuId?: string;
    onSkuChange?: (id: string) => void;
    filteredSkus?: any[]; // Tipo simplificado para evitar errores de importación circular si los hay
}

export const StockProjection: React.FC<StockProjectionProps> = ({
    sharedSkuId,
    onSkuChange,
    filteredSkus: propFilteredSkus
}) => {
    const { skus: allSkus } = useData();
    // Priorizar skus filtrados por props (segmentación global)
    const skusToDisplay = propFilteredSkus || allSkus;

    const [selectedSku, setSelectedSku] = useState<string>(sharedSkuId || '');
    const [projection, setProjection] = useState<ProjectionData[]>([]);
    const [alerts, setAlerts] = useState<SkuAlert[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [onlyAlerts, setOnlyAlerts] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [horizon, setHorizon] = useState(30);
    const [availableWarehouses, setAvailableWarehouses] = useState<string[]>([]);
    const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);
    // Nuevo estado para el filtro de validos
    const [onlyValidStock, setOnlyValidStock] = useState(true);
    // Para saber cuales son invalidos
    const [invalidWarehouses, setInvalidWarehouses] = useState<string[]>([]);

    // Helper para mostrar fechas correctamente sin desplazamiento por Timezone
    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                // Construir fecha local explícitamente (Año, Mes-1, Día)
                const [y, m, d] = parts.map(Number);
                const date = new Date(y, m - 1, d);
                return date.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
            }
        } catch (e) {
            return dateStr;
        }
        return dateStr;
    };

    // Cargar alertas generales al inicio y cuando cambia el horizonte
    useEffect(() => {
        fetchAlerts();
    }, [horizon]);

    // Sincronizar con el estado global si cambia fuera de aquí (ej. desde Dashboard)
    useEffect(() => {
        if (sharedSkuId && sharedSkuId !== selectedSku) {
            setSelectedSku(sharedSkuId);
        }
    }, [sharedSkuId]);

    // Al cambiar el SKU internamente, notificar al padre
    const handleSkuSelection = (skuId: string) => {
        setSelectedSku(skuId);
        if (onSkuChange) onSkuChange(skuId);
    };

    // Cargar proyección cuando cambia el SKU (resetear filtros)
    useEffect(() => {
        if (selectedSku) {
            // Al cambiar SKU, reseteamos filtros y cargamos todo
            setAvailableWarehouses([]);
            setSelectedWarehouses([]);
            setInvalidWarehouses([]);
            setOnlyValidStock(true); // Reset a default
            fetchProjection(selectedSku); // Primera carga sin filtro
        } else {
            setProjection([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSku]); // Solo cuando cambia el SKU

    // Recargar proyección cuando cambia el horizonte (mantener filtros actuales)
    useEffect(() => {
        if (selectedSku && selectedWarehouses.length > 0) {
            // Si ya hay almacenes seleccionados, recargar con ellos
            fetchProjection(selectedSku, selectedWarehouses);
        } else if (selectedSku && availableWarehouses.length > 0) {
            // Si no hay seleccionados pero sí disponibles, recargar todo
            fetchProjection(selectedSku, null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [horizon]); // Solo cuando cambia el horizonte

    const fetchAlerts = async () => {
        // Las alertas se calculan de forma simplificada en el cliente
        // basándose en los SKUs disponibles y su stock actual
        try {
            const simpleAlerts: SkuAlert[] = [];
            for (const sku of (skusToDisplay || []).slice(0, 50)) { // Limitar a 50 para performance
                if (sku.stockLevel <= 0) {
                    simpleAlerts.push({
                        sku: sku.id,
                        type: 'critical',
                        date: new Date().toISOString().split('T')[0],
                        psoh: sku.stockLevel,
                        days_until: 0
                    });
                } else if (sku.stockLevel <= (sku.safetyStock || 0)) {
                    simpleAlerts.push({
                        sku: sku.id,
                        type: 'warning',
                        date: new Date().toISOString().split('T')[0],
                        psoh: sku.stockLevel,
                        days_until: 0
                    });
                }
            }
            setAlerts(simpleAlerts);
        } catch (error) {
            console.error("Error calculating alerts:", error);
        }
    };

    const fetchProjection = async (skuId: string, warehouseFilter: string[] | null = null) => {
        setIsLoading(true);
        try {
            const currentSku = allSkus.find(s => s.id === skuId);
            const safetyStock = currentSku?.safetyStock || 0;

            // Calcular rango de fechas para consultas
            const today = new Date();
            const endDate = new Date(today);
            endDate.setDate(today.getDate() + horizon);
            const startStr = today.toISOString().split('T')[0];
            const endStr = endDate.toISOString().split('T')[0];

            // Consultar datos en paralelo desde Supabase
            const [demandaData, stockData, produccionData, consumoData, feiFactor] = await Promise.all([
                api.getDemandaProyectada(skuId),
                api.getStockActual(skuId),
                api.getProduccionProgramada(skuId, startStr, endStr),
                api.getConsumoProduccion(skuId, startStr, endStr),
                api.getFEIFactor(skuId)
            ]);

            console.log('DEBUG: Demanda mensual:', demandaData.length, 'registros');
            console.log('DEBUG: Stock MB52:', stockData.length, 'registros');
            console.log('DEBUG: Producción:', produccionData.length, 'registros');
            console.log('DEBUG: Consumos:', consumoData.length, 'registros');

            // Calcular stock inicial (con o sin filtro de almacenes)
            const { total: initialStock, breakdown: stockBreakdown } = calculateInitialStock(
                stockData,
                warehouseFilter
            );

            // Calcular proyección PSoH con distribución diaria de demanda mensual
            const proj = calculateProjection(
                initialStock,
                safetyStock,
                demandaData,
                produccionData,
                consumoData,
                horizon,
                stockBreakdown,
                feiFactor
            );

            console.log('DEBUG: Projection array length:', proj.length);
            if (proj.length > 0) {
                console.log('DEBUG: First projection item:', proj[0]);
            }

            // Adaptar al formato esperado por el componente
            const adaptedProj: ProjectionData[] = proj.map(p => ({
                date: p.date,
                psoh: p.psoh,
                supply_in: p.supply,
                demand_out: p.demand,
                status: p.status,
                supply_breakdown: p.supply_breakdown,
                demand_breakdown: p.demand_breakdown,
                stock_breakdown: p.stock_breakdown
            }));

            setProjection(adaptedProj);

            // Poblar almacenes disponibles si es la primera carga (warehouseFilter es null)
            if (adaptedProj.length > 0 && adaptedProj[0].stock_breakdown && warehouseFilter === null) {
                const bd = adaptedProj[0].stock_breakdown;
                const keys = Object.keys(bd);
                setAvailableWarehouses(keys);

                // Detectar invalidos
                const invalid = keys.filter(k => {
                    const val = bd[k];
                    if (typeof val === 'object' && val !== null) {
                        return (val as any).is_valid === false;
                    }
                    return false;
                });
                setInvalidWarehouses(invalid);

                // Seleccionar inicialmente según el filtro "Solo Validos"
                if (onlyValidStock) {
                    const validOnes = keys.filter(k => !invalid.includes(k));
                    setSelectedWarehouses(validOnes);
                } else {
                    setSelectedWarehouses(keys);
                }
            }
        } catch (error) {
            console.error("Error fetching projection:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleWarehouse = (wh: string) => {
        const newSelection = selectedWarehouses.includes(wh)
            ? selectedWarehouses.filter(w => w !== wh)
            : [...selectedWarehouses, wh];

        setSelectedWarehouses(newSelection);
        // Disparar recarga con el nuevo filtro
        fetchProjection(selectedSku, newSelection);
    };

    const toggleAllWarehouses = (select: boolean) => {
        let newSelection: string[] = [];
        if (select) {
            if (onlyValidStock) {
                newSelection = availableWarehouses.filter(wh => !invalidWarehouses.includes(wh));
            } else {
                newSelection = [...availableWarehouses];
            }
        } else {
            newSelection = [];
        }

        setSelectedWarehouses(newSelection);
        fetchProjection(selectedSku, newSelection);
    };

    const finalFilteredSkus = (skusToDisplay || []).filter(sku => {
        const matchesAlert = onlyAlerts ? (alerts || []).some(a => a?.sku === sku.id) : true;
        const matchesSearch = (sku.id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (sku.name || '').toLowerCase().includes(searchTerm.toLowerCase());
        return matchesAlert && matchesSearch;
    });

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <header className="flex justify-between items-end border-b border-slate-800 pb-6">
                <div>
                    <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                        Proyección de Stock (Daily Bucket)
                    </h2>
                    <p className="text-slate-400 mt-2">
                        Gestión por excepción: Visualiza y anticipa quiebres de stock.
                    </p>
                </div>

                {/* KPI Alertas */}
                <div className="flex gap-3">
                    <div className={`px-4 py-2 rounded-lg border bg-slate-800/50 border-slate-700`}>
                        <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 opacity-50">Total Alertas</span>
                        <span className="text-xl font-bold text-white">{(alerts || []).length}</span>
                    </div>
                    <div className={`px-4 py-2 rounded-lg border ${(alerts || []).filter(a => a?.type === 'critical').length > 0 ? 'bg-red-500/10 border-red-500/50' : 'bg-slate-800/30 border-slate-800'}`}>
                        <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 opacity-70 text-red-400">Quiebres</span>
                        <span className={`text-xl font-bold ${(alerts || []).filter(a => a?.type === 'critical').length > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                            {(alerts || []).filter(a => a?.type === 'critical').length}
                        </span>
                    </div>
                    <div className={`px-4 py-2 rounded-lg border ${(alerts || []).filter(a => a?.type !== 'critical').length > 0 ? 'bg-orange-500/10 border-orange-500/50' : 'bg-slate-800/30 border-slate-800'}`}>
                        <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 opacity-70 text-orange-400">Riesgos</span>
                        <span className={`text-xl font-bold ${(alerts || []).filter(a => a?.type !== 'critical').length > 0 ? 'text-orange-400' : 'text-slate-500'}`}>
                            {(alerts || []).filter(a => a?.type !== 'critical').length}
                        </span>
                    </div>
                </div>
            </header>

            {/* Controles Principales */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">

                {/* Panel Lateral: Selector de SKUs */}
                <div className="md:col-span-3 space-y-4">
                    <div className="bg-dark-900 border border-slate-800 rounded-xl p-4 h-[600px] flex flex-col">
                        <div className="mb-4 space-y-3">
                            <label className="flex items-center gap-2 text-sm text-slate-300 font-medium cursor-pointer bg-slate-800/50 p-2 rounded">
                                <input
                                    type="checkbox"
                                    checked={onlyAlerts}
                                    onChange={e => setOnlyAlerts(e.target.checked)}
                                    className="form-checkbox rounded bg-slate-800 border-slate-600 text-red-500 focus:ring-red-500"
                                />
                                Solo SKUs con Quiebre
                            </label>
                            <div className="relative">
                                <span className="material-symbols-rounded absolute left-2 top-2.5 text-slate-500 text-sm">search</span>
                                <input
                                    type="text"
                                    placeholder="Buscar SKU..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-slate-800 border-slate-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            {/* Filtro de Horizonte Temporal */}
                            <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/50">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Horizonte (Días)</label>
                                    <span className="text-sm font-bold text-indigo-400">{horizon} d</span>
                                </div>
                                <input
                                    type="range"
                                    min="3"
                                    max="30"
                                    step="1"
                                    value={horizon}
                                    title={`Horizonte de proyección: ${horizon} días`}
                                    onChange={(e) => setHorizon(Number(e.target.value))}
                                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                />
                                <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                                    <span>3</span>
                                    <span>30</span>
                                </div>
                            </div>

                            {/* Filtro de Almacenes */}
                            {availableWarehouses.length > 0 && (
                                <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/50 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Almacenes</label>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => toggleAllWarehouses(true)}
                                                className="text-[10px] text-indigo-400 hover:text-indigo-300"
                                            >
                                                Todos
                                            </button>
                                            <button
                                                onClick={() => toggleAllWarehouses(false)}
                                                className="text-[10px] text-slate-500 hover:text-slate-300"
                                            >
                                                Ninguno
                                            </button>
                                        </div>
                                    </div>

                                    {/* Toggle Solo Validos */}
                                    <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer bg-slate-900/50 p-1.5 rounded border border-slate-800 mb-2">
                                        <div className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={onlyValidStock}
                                                onChange={e => {
                                                    const checked = e.target.checked;
                                                    setOnlyValidStock(checked);

                                                    // Si se activa "Ocultar Invalidos", deseleccionar los invalidos
                                                    if (checked) {
                                                        const validOnes = selectedWarehouses.filter(wh => !invalidWarehouses.includes(wh));
                                                        setSelectedWarehouses(validOnes);
                                                        fetchProjection(selectedSku, validOnes);
                                                    }
                                                    // Si se desactiva, no hacemos nada (el usuario puede seleccionarlos manualmente si quiere)
                                                }}
                                            />
                                            <div className="w-8 h-4 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                                        </div>
                                        Ocultar Almacenes NO Válidos
                                    </label>

                                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                                        {availableWarehouses
                                            .filter(wh => onlyValidStock ? !invalidWarehouses.includes(wh) : true)
                                            .map(wh => {
                                                const isValid = !invalidWarehouses.includes(wh);
                                                return (
                                                    <label key={wh} className={`flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-700/50 p-1 rounded ${!isValid ? 'opacity-70' : ''}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedWarehouses.includes(wh)}
                                                            onChange={() => toggleWarehouse(wh)}
                                                            className={`rounded bg-slate-800 border-slate-600 focus:ring-0 w-3.5 h-3.5 ${isValid ? 'text-indigo-500' : 'text-red-500'}`}
                                                        />
                                                        <span className={`truncate flex-1 ${!isValid ? 'text-red-400 italic line-through decoration-red-500/50' : 'text-slate-300'}`} title={wh}>
                                                            {wh}
                                                        </span>
                                                        {!isValid && <span className="text-[9px] text-red-500 font-bold border border-red-500/30 px-1 rounded">NO</span>}
                                                    </label>
                                                );
                                            })}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-1 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
                            {finalFilteredSkus.length === 0 && (
                                <div className="text-center text-slate-500 text-sm py-4">
                                    No se encontraron SKUs
                                </div>
                            )}
                            {finalFilteredSkus.map(sku => {
                                const hasAlert = (alerts || []).some(a => a?.sku === sku.id);
                                return (
                                    <button
                                        key={sku.id}
                                        onClick={() => handleSkuSelection(sku.id)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex justify-between items-center group border
                                    ${selectedSku === sku.id
                                                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                                                : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800 hover:text-white'
                                            }`}
                                    >
                                        <div className="truncate flex-1">
                                            <span className="font-bold block tracking-wide">{sku.id}</span>
                                            <span className="text-xs opacity-60 truncate block max-w-[180px]">{sku.name}</span>
                                        </div>
                                        {(() => {
                                            const alert = (alerts || []).find(a => a?.sku === sku.id);
                                            if (!alert) return null;

                                            if (alert.type === 'critical') {
                                                return <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse ml-2" title="Quiebre Proyectado"></span>;
                                            }
                                            if (alert.type === 'delay_risk') {
                                                return <span className="material-symbols-rounded text-orange-400 text-lg animate-bounce ml-2" title="Riesgo Crítico por Atraso">warning</span>;
                                            }
                                            if (alert.type === 'warning') {
                                                return <span className="w-2.5 h-2.5 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.6)] ml-2" title="Riesgo de Quiebre (Zona Roja)"></span>;
                                            }
                                            return null;
                                        })()}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Panel Central: Gráfico y Heatmap */}
                <div className="md:col-span-9 space-y-6">
                    {!selectedSku ? (
                        <div className="h-[600px] bg-dark-900 border border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center text-slate-500">
                            <span className="material-symbols-rounded text-6xl mb-4 opacity-20">query_stats</span>
                            <p className="text-lg font-medium">Selecciona un SKU</p>
                            <p className="text-sm opacity-60">Visualiza su proyección futura de stock, entradas y salidas</p>
                        </div>
                    ) : (
                        <>
                            {/* Gráfico de Proyección */}
                            <div className="bg-dark-900 border border-slate-800 rounded-xl p-6 relative">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <span className="material-symbols-rounded text-indigo-400">stacked_line_chart</span>
                                        Evolución PSoH ({horizon} Días)
                                    </h3>
                                    <div className="flex gap-4 text-xs font-medium">
                                        <span className="flex items-center gap-1 text-slate-400">
                                            <span className="w-2 h-2 rounded-full bg-indigo-500"></span> Stock
                                        </span>
                                        <span className="flex items-center gap-1 text-slate-400">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Producción
                                        </span>
                                        <span className="flex items-center gap-1 text-slate-400">
                                            <span className="w-2 h-2 rounded-sm border border-red-500"></span> Quiebre
                                        </span>
                                        <span className="flex items-center gap-1 text-slate-400">
                                            <span className="w-2 h-2 rounded-sm border border-red-500 border-dashed"></span> Zona Roja
                                        </span>
                                    </div>
                                </div>

                                <div className="h-[350px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={projection} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                            <defs>
                                                <linearGradient id="colorPsoh" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                            <XAxis
                                                dataKey="date"
                                                stroke="#64748b"
                                                tick={{ fill: '#64748b', fontSize: 11 }}
                                                tickFormatter={formatDate}
                                                minTickGap={30}
                                            />
                                            <YAxis
                                                stroke="#64748b"
                                                tick={{ fill: '#64748b', fontSize: 11 }}
                                                domain={['auto', 'auto']}
                                                width={60}
                                            />
                                            <Tooltip
                                                content={({ active, payload, label }) => {
                                                    if (active && payload && payload.length) {
                                                        const dateLabel = formatDate(label);
                                                        const psoh = payload.find(p => p.dataKey === 'psoh')?.value as number;
                                                        const psohData = payload.find(p => p.dataKey === 'psoh')?.payload as ProjectionData;

                                                        const supplyBkd = psohData?.supply_breakdown || {};
                                                        const demandBkd = psohData?.demand_breakdown || {};

                                                        const hasEntradas = Object.keys(supplyBkd).length > 0;
                                                        const hasSalidas = Object.keys(demandBkd).length > 0;

                                                        return (
                                                            <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 text-xs w-64 z-50">
                                                                <p className="font-bold text-slate-300 mb-2 border-b border-slate-700 pb-1">{dateLabel}</p>

                                                                <div className="flex justify-between items-center mb-2">
                                                                    <span className="text-indigo-400 font-bold">Stock Proyectado:</span>
                                                                    <span className="font-mono text-white text-sm">{psoh?.toLocaleString()}</span>
                                                                </div>

                                                                {(hasEntradas || hasSalidas) && (
                                                                    <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
                                                                        {hasEntradas && (
                                                                            <div>
                                                                                <p className="text-[10px] uppercase text-emerald-500 font-bold mb-0.5">Entradas</p>
                                                                                {Object.entries(supplyBkd).map(([key, val]) => (
                                                                                    <div key={key} className="flex justify-between pl-2">
                                                                                        <span className="text-slate-400 capitalize">{key.toLowerCase()}:</span>
                                                                                        <span className="text-emerald-400">+{val.toLocaleString()}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}

                                                                        {hasSalidas && (
                                                                            <div>
                                                                                <p className="text-[10px] uppercase text-orange-500 font-bold mb-0.5">Salidas</p>
                                                                                {Object.entries(demandBkd).map(([key, val]) => (
                                                                                    <div key={key} className="flex justify-between pl-2">
                                                                                        <span className="text-slate-400 capitalize">{key.toLowerCase()}:</span>
                                                                                        <span className="text-orange-400">-{val.toLocaleString()}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />

                                            {/* Zonas de referencia */}
                                            <ReferenceLine y={0} stroke="#ef4444" strokeWidth={2} label={{ value: '0', fill: '#ef4444', fontSize: 10, position: 'left' }} strokeDasharray="3 3" />
                                            {allSkus.find(s => s.id === selectedSku)?.safetyStock && (
                                                <ReferenceLine
                                                    y={allSkus.find(s => s.id === selectedSku)?.safetyStock}
                                                    stroke="#ef4444"
                                                    strokeWidth={2}
                                                    strokeDasharray="5 5"
                                                    label={{
                                                        value: `Zona Roja (${allSkus.find(s => s.id === selectedSku)?.safetyStock})`,
                                                        fill: '#ef4444',
                                                        fontSize: 10,
                                                        position: 'insideTopRight'
                                                    }}
                                                />
                                            )}

                                            {/* Barras: Supply In */}
                                            <Bar dataKey="supply_in" name="Entrada Producción" fill="#10b981" barSize={12} radius={[2, 2, 0, 0]} opacity={0.8} />

                                            {/* Línea: PSoH */}
                                            <Area type="monotone" dataKey="psoh" name="Proyección Stock" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorPsoh)" activeDot={{ r: 6, strokeWidth: 0 }} />

                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Heatmap Table */}
                            <div className="bg-dark-900 border border-slate-800 rounded-xl overflow-hidden">
                                <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                                    <h3 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                                        <span className="material-symbols-rounded text-slate-500">table_chart</span>
                                        Detalle Diario por Excepción
                                    </h3>
                                </div>
                                <div className="overflow-x-auto max-h-[300px]">
                                    <table className="w-full text-sm text-left border-collapse">
                                        <thead className="text-xs text-slate-400 uppercase bg-slate-900 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-4 py-3 sticky left-0 bg-slate-900 z-20 w-32 border-b border-r border-slate-800 shadow-sm">Fecha</th>
                                                <th className="px-4 py-3 text-right text-green-400 border-b border-slate-800">Entradas (+)</th>
                                                <th className="px-4 py-3 text-right text-orange-400 border-b border-slate-800">Salidas (-)</th>
                                                <th className="px-4 py-3 text-right text-blue-400 font-bold border-l border-r border-b border-slate-800 bg-slate-800/30">Saldo Final (=)</th>
                                                <th className="px-4 py-3 text-center border-b border-slate-800">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800">
                                            {projection.map((day, index) => (
                                                <tr key={day.date} className={`hover:bg-slate-800/50 transition-colors ${day.psoh <= 0 ? 'bg-red-500/5' : ''}`}>
                                                    <td className="px-4 py-2.5 font-medium text-slate-300 sticky left-0 bg-dark-900 border-r border-slate-800">
                                                        {formatDate(day.date)}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-slate-400 font-mono relative group/supply">
                                                        {day.supply_in > 0 ? (
                                                            <>
                                                                <span className="text-green-400 font-bold">+{day.supply_in.toLocaleString()}</span>
                                                                {/* Tooltip para Entradas */}
                                                                {day.supply_breakdown && Object.keys(day.supply_breakdown).length > 0 && (
                                                                    <div className="absolute left-full ml-2 top-0 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 z-50 hidden group-hover/supply:block pointer-events-none">
                                                                        <p className="text-[10px] uppercase text-green-400 font-bold mb-2 border-b border-slate-800 pb-1">Detalle de Entradas (Producción)</p>
                                                                        <div className="space-y-1">
                                                                            {Object.entries(day.supply_breakdown).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([key, val]) => (
                                                                                <div key={key} className="flex justify-between text-[11px]">
                                                                                    <span className="text-slate-400">{key}:</span>
                                                                                    <span className="text-white font-mono">+{val.toLocaleString()}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : '-'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right text-slate-400 font-mono relative group/demand">
                                                        {day.demand_out > 0 ? (
                                                            <>
                                                                <span>{day.demand_out.toLocaleString()}</span>
                                                                {/* Tooltip para Salidas */}
                                                                {day.demand_breakdown && Object.keys(day.demand_breakdown).length > 0 && (
                                                                    <div className="absolute left-full ml-2 top-0 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 z-50 hidden group-hover/demand:block pointer-events-none text-left">
                                                                        <p className="text-[10px] uppercase text-orange-400 font-bold mb-2 border-b border-slate-800 pb-1">Detalle de Salidas</p>
                                                                        <div className="space-y-2">
                                                                            {/* Ventas Primero */}
                                                                            {day.demand_breakdown['VENTA'] !== undefined && (
                                                                                <div className="flex justify-between items-center mb-1">
                                                                                    <span className="text-[11px] font-bold text-slate-300 uppercase">VENTA:</span>
                                                                                    <span className="text-white font-mono">-{day.demand_breakdown['VENTA'].toLocaleString()}</span>
                                                                                </div>
                                                                            )}

                                                                            {/* Sección CONSUMO agrupada */}
                                                                            {Object.keys(day.demand_breakdown).some(k => k.startsWith('CONSUMO')) && (() => {
                                                                                const consumos = Object.entries(day.demand_breakdown).filter(([k]) => k.startsWith('CONSUMO'));
                                                                                const total = consumos.reduce((s, [_, v]) => s + (v as number), 0);
                                                                                return (
                                                                                    <div className="pt-1.5 border-t border-slate-800/50 mt-1.5">
                                                                                        <div className="flex justify-between items-center mb-1">
                                                                                            <span className="text-[11px] font-bold text-slate-300 uppercase">CONSUMO:</span>
                                                                                            <span className="text-white font-mono text-sm">-{total.toLocaleString()}</span>
                                                                                        </div>
                                                                                        {consumos.map(([key, val]) => (
                                                                                            <div key={key} className="flex justify-between text-[11px] pl-2 py-0.5">
                                                                                                <span className="text-slate-400 italic">
                                                                                                    {key.split('|')[1]?.trim() || 'Otros'}:
                                                                                                </span>
                                                                                                <span className="text-slate-300 font-mono">-{val.toLocaleString()}</span>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : '-'}
                                                    </td>
                                                    <td className={`px-4 py-2.5 text-right font-bold font-mono border-l border-r border-slate-800 relative group/psoh
                                                ${day.psoh <= 0 ? 'text-red-500 bg-red-500/10' : 'text-blue-400'}`}>
                                                        {day.psoh.toLocaleString()}

                                                        {/* Tooltip para el Stock Inicial (Primera fila) */}
                                                        {index === 0 && day.stock_breakdown && Object.keys(day.stock_breakdown).length > 0 && (
                                                            <div className="absolute right-full mr-2 top-0 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 z-50 hidden group-hover/psoh:block pointer-events-none">
                                                                <p className="text-[10px] uppercase text-indigo-400 font-bold mb-2 border-b border-slate-800 pb-1">Stock Actual por Almacén</p>
                                                                <div className="space-y-1">
                                                                    {Object.entries(day.stock_breakdown!).sort((a, b) => {
                                                                        const valA = typeof a[1] === 'number' ? a[1] : (a[1] as any).qty;
                                                                        const valB = typeof b[1] === 'number' ? b[1] : (b[1] as any).qty;
                                                                        return valB - valA;
                                                                    }).map(([key, val]) => {
                                                                        const qty = typeof val === 'number' ? val : (val as any).qty;
                                                                        const isValid = typeof val === 'object' && val !== null ? (val as any).is_valid : true;
                                                                        return (
                                                                            <div key={key} className="flex justify-between text-[11px]">
                                                                                <span className={`${isValid ? 'text-slate-400' : 'text-red-400 italic'}`}>
                                                                                    {key} {!isValid && '(NO)'}
                                                                                </span>
                                                                                <span className={`${isValid ? 'text-white' : 'text-red-300'} font-mono`}>
                                                                                    {qty.toLocaleString()}
                                                                                </span>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-center">
                                                        {day.psoh <= 0 ? (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-100/10 text-red-500 border border-red-500/20">
                                                                CRÍTICO
                                                            </span>
                                                        ) : day.supply_in > 0 ? (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-green-100/10 text-green-500 border border-green-500/20">
                                                                ENTRADA
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-600 text-[10px] uppercase">OK</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Validación Histórica (Backtesting) */}
                            <HistoricalValidationChart skuId={selectedSku} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
