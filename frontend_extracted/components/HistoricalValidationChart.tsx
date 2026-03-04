import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
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
} from 'recharts';
import { buildDailyDemandMap } from '../utils/projection';

interface HistoricalValidationChartProps {
    skuId: string;
}

interface ValidationDataPoint {
    date: string;
    real: number;
    planPT?: number;       // Plan comercial diario (PT)
    planST?: number;       // Programa de consumo diario (ST)
    planTotal?: number;    // Suma de ambos si es Dual
}

type SkuType = 'PT' | 'ST' | 'Dual' | 'Sin_Plan';

const SKU_TYPE_LABELS: Record<SkuType, string> = {
    PT: 'Producto Terminado — Plan Comercial',
    ST: 'Semiterminado — Programa de Producción',
    Dual: 'Dual (PT + ST) — Plan Comercial + Programa',
    Sin_Plan: 'Sin plan registrado',
};

const SKU_TYPE_BADGE: Record<SkuType, string> = {
    PT: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    ST: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    Dual: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    Sin_Plan: 'bg-slate-700/40 text-slate-400 border-slate-600',
};

export const HistoricalValidationChart: React.FC<HistoricalValidationChartProps> = ({ skuId }) => {
    const [data, setData] = useState<ValidationDataPoint[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [skuType, setSkuType] = useState<SkuType>('Sin_Plan');
    const [metrics, setMetrics] = useState({ madPlan: 0, errorPercent: 0, totalReal: 0, totalPlan: 0 });

    useEffect(() => {
        if (skuId) {
            fetchValidationData();
        } else {
            setData([]);
        }
    }, [skuId]);

    const fetchValidationData = async () => {
        setIsLoading(true);
        try {
            const { real, planComercial, programaConsumo, skuType: type } = await api.getHistoricalValidation(skuId);
            setSkuType(type);

            const today = new Date();

            // --- Construir mapa de plan PT (plan mensual → diario) ---
            const ptDailyMap: Record<string, number> = {};
            if (type === 'PT' || type === 'Dual') {
                const builtPT = buildDailyDemandMap(planComercial);
                Object.assign(ptDailyMap, builtPT);
            }

            // --- Construir mapa de plan ST (programa de producción → agrupado por fecha) ---
            const stDailyMap: Record<string, number> = {};
            if (type === 'ST' || type === 'Dual') {
                programaConsumo.forEach((r: any) => {
                    if (r.fecha && r.cantidad_programada > 0) {
                        const d = r.fecha.split('T')[0];
                        stDailyMap[d] = (stDailyMap[d] || 0) + parseFloat(r.cantidad_programada);
                    }
                });
            }

            // --- Construir mapa de movimientos reales ---
            const realMap: Record<string, number> = {};
            real.forEach((r: any) => {
                if (r.fecha && r.cantidad_final_tn > 0) {
                    const d = r.fecha.split('T')[0];
                    realMap[d] = (realMap[d] || 0) + r.cantidad_final_tn;
                }
            });

            // --- Serie de tiempo: últimos 30 días ---
            const chartData: ValidationDataPoint[] = [];
            let sumReal = 0, sumPlan = 0, sumError = 0;

            for (let i = 30; i > 0; i--) {
                const date = new Date(today);
                date.setDate(today.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];

                const realVal = realMap[dateStr] || 0;
                const ptVal = ptDailyMap[dateStr] || 0;
                const stVal = stDailyMap[dateStr] || 0;
                const totalPlan = ptVal + stVal;

                sumReal += realVal;
                sumPlan += totalPlan;
                sumError += Math.abs(realVal - totalPlan);

                const point: ValidationDataPoint = {
                    date: dateStr,
                    real: parseFloat(realVal.toFixed(3)),
                    planTotal: parseFloat(totalPlan.toFixed(3)),
                };
                if (type === 'PT' || type === 'Dual') point.planPT = parseFloat(ptVal.toFixed(3));
                if (type === 'ST' || type === 'Dual') point.planST = parseFloat(stVal.toFixed(3));

                chartData.push(point);
            }

            setData(chartData);
            const errorPercent = sumReal > 0 ? (sumError / sumReal) * 100 : (sumPlan > 0 ? 100 : 0);
            setMetrics({
                madPlan: parseFloat((sumError / 30).toFixed(2)),
                errorPercent: parseFloat(errorPercent.toFixed(1)),
                totalReal: parseFloat(sumReal.toFixed(2)),
                totalPlan: parseFloat(sumPlan.toFixed(2)),
            });

        } catch (error) {
            console.error('Error fetching historical validation:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        try {
            const [y, m, d] = dateStr.split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
        } catch { return dateStr; }
    };

    if (!skuId) return null;

    const errorColor = metrics.errorPercent > 40
        ? 'text-red-400 border-red-500/30 bg-red-500/10'
        : metrics.errorPercent > 20
            ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
            : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';

    return (
        <div className="bg-dark-900 border border-slate-800 rounded-xl p-6 mt-6">
            <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
                <div>
                    <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                        <span className="material-symbols-rounded text-indigo-400">history_toggle_off</span>
                        Backtesting: Real vs Plan (Últimos 30 días)
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] uppercase font-bold border rounded px-2 py-0.5 ${SKU_TYPE_BADGE[skuType]}`}>
                            {skuType}
                        </span>
                        <span className="text-xs text-slate-400">{SKU_TYPE_LABELS[skuType]}</span>
                    </div>
                </div>

                {/* KPIs */}
                <div className="flex gap-3 flex-wrap">
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 min-w-[110px]">
                        <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Real</span>
                        <span className="text-xl font-bold text-emerald-400">{metrics.totalReal.toLocaleString()} <span className="text-xs font-normal">Tn</span></span>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 min-w-[110px]">
                        <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Plan</span>
                        <span className="text-xl font-bold text-indigo-400">{metrics.totalPlan.toLocaleString()} <span className="text-xs font-normal">Tn</span></span>
                    </div>
                    <div className={`rounded-lg p-3 border min-w-[110px] ${errorColor}`}>
                        <span className="text-[10px] uppercase font-bold block opacity-70">% Error Plan</span>
                        <span className="text-xl font-bold">{metrics.errorPercent}%</span>
                    </div>
                </div>
            </div>

            {/* Descripción contextual */}
            <p className="text-xs text-slate-500 mb-4">
                {skuType === 'ST' && 'Las salidas reales (consumos internos) se comparan contra el Programa de Producción del mes. Una alta desviación indica que el programa sub o sobreestimó las necesidades.'}
                {skuType === 'PT' && 'Las salidas reales (ventas) se comparan contra el Plan Comercial mensual distribuido en días hábiles.'}
                {skuType === 'Dual' && 'SKU con comportamiento dual: se vende Y se consume internamente. El plan total incluye el Plan Comercial + Programa de Producción.'}
                {skuType === 'Sin_Plan' && 'Este SKU no tiene plan registrado en ninguna fuente. Solo se muestra la historia real de salidas.'}
            </p>

            {isLoading ? (
                <div className="h-[250px] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                </div>
            ) : data.length === 0 ? (
                <div className="h-[250px] flex items-center justify-center text-slate-500 text-sm">
                    No hay datos suficientes para backtesting.
                </div>
            ) : (
                <div className="h-[260px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                            <XAxis
                                dataKey="date"
                                stroke="#64748b"
                                tick={{ fill: '#64748b', fontSize: 10 }}
                                tickFormatter={formatDate}
                                minTickGap={20}
                            />
                            <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 10 }} width={52} />
                            <Tooltip
                                cursor={{ fill: '#334155', opacity: 0.2 }}
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        const realVal = payload.find(p => p.dataKey === 'real')?.value;
                                        const planVal = payload.find(p => p.dataKey === 'planTotal')?.value as number;
                                        const diff = realVal !== undefined && planVal !== undefined
                                            ? parseFloat((Number(realVal) - planVal).toFixed(3))
                                            : null;
                                        return (
                                            <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 text-xs w-58">
                                                <p className="font-bold text-slate-300 mb-2 border-b border-slate-700 pb-1">{formatDate(label)}</p>
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between gap-4"><span className="text-emerald-400 font-semibold">Real:</span><span className="font-mono text-white">{realVal} Tn</span></div>
                                                    {(skuType === 'PT' || skuType === 'Dual') && (
                                                        <div className="flex justify-between gap-4"><span className="text-indigo-400 font-semibold">Plan Comercial:</span><span className="font-mono text-white">{payload.find(p => p.dataKey === 'planPT')?.value} Tn</span></div>
                                                    )}
                                                    {(skuType === 'ST' || skuType === 'Dual') && (
                                                        <div className="flex justify-between gap-4"><span className="text-amber-400 font-semibold">Prog. Producción:</span><span className="font-mono text-white">{payload.find(p => p.dataKey === 'planST')?.value} Tn</span></div>
                                                    )}
                                                    {diff !== null && (
                                                        <div className={`flex justify-between gap-4 pt-1 border-t border-slate-700 ${diff < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                                            <span className="font-semibold">Desviación:</span>
                                                            <span className="font-mono font-bold">{diff > 0 ? '+' : ''}{diff} Tn</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                            {/* Barras reales */}
                            <Bar dataKey="real" name="Salidas Reales" fill="#10b981" barSize={7} radius={[2, 2, 0, 0]} opacity={0.85} />
                            {/* Líneas de plan según tipo */}
                            {(skuType === 'PT' || skuType === 'Dual') && (
                                <Line type="stepAfter" dataKey="planPT" name="Plan Comercial (PT)" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                            )}
                            {(skuType === 'ST' || skuType === 'Dual') && (
                                <Line type="stepAfter" dataKey="planST" name="Prog. Producción (ST)" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" dot={false} />
                            )}
                            {skuType === 'Dual' && (
                                <Line type="stepAfter" dataKey="planTotal" name="Plan Total (PT+ST)" stroke="#a78bfa" strokeWidth={1.5} dot={false} opacity={0.6} />
                            )}
                            {skuType === 'Sin_Plan' && (
                                <Line type="monotone" dataKey="planTotal" name="Sin plan" stroke="#475569" strokeWidth={1} dot={false} strokeDasharray="2 4" />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
};
