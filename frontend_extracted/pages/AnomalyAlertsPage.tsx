import React, { useState, useEffect } from 'react';

interface AnomalyAlert {
    id: string;
    detected_at: string;
    sku_id: string;
    sku_name: string;
    movement_type: string;
    anomaly_score: number;
    severity: 'critical' | 'moderate' | 'low';
    expected_value: number;
    actual_value: number;
    deviation_pct: number;
    status: 'open' | 'reviewed' | 'dismissed';
}

export const AnomalyAlertsPage: React.FC = () => {
    const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchAlerts = async () => {
        try {
            const response = await fetch('http://localhost:8000/cognitive/anomalies?limit=50');
            const data = await response.json();
            setAlerts(data);
        } catch (error) {
            console.error('Error fetching anomalies:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 60000);
        return () => clearInterval(interval);
    }, []);

    const handleAction = async (id: string, status: 'reviewed' | 'dismissed') => {
        try {
            await fetch('http://localhost:8000/cognitive/anomalies/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alert_id: id, status }),
            });
            setAlerts(prev => prev.map(a => a.id === id ? { ...a, status } : a));
        } catch (error) {
            console.error('Error updating anomaly status:', error);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <span className="material-symbols-rounded animate-spin text-primary-500 text-4xl">sync</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-dark-900 p-6 rounded-xl border border-slate-800">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Alertas Abiertas</p>
                    <h3 className="text-3xl font-bold text-white">{alerts.filter(a => a.status === 'open').length}</h3>
                </div>
                <div className="bg-dark-900 p-6 rounded-xl border border-slate-800">
                    <p className="text-primary-400 text-xs font-bold uppercase tracking-widest mb-1">Críticas</p>
                    <h3 className="text-3xl font-bold text-white">{alerts.filter(a => a.severity === 'critical' && a.status === 'open').length}</h3>
                </div>
                <div className="bg-dark-900 p-6 rounded-xl border border-slate-800">
                    <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-1">Auditadas hoy</p>
                    <h3 className="text-3xl font-bold text-white">{alerts.filter(a => a.status !== 'open').length}</h3>
                </div>
            </div>

            <div className="bg-dark-900 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
                <table className="w-full text-left">
                    <thead className="bg-slate-800/80 text-slate-400 text-xs uppercase font-bold tracking-widest">
                        <tr>
                            <th className="px-6 py-4">Detectada</th>
                            <th className="px-6 py-4">SKU</th>
                            <th className="px-6 py-4">Tipo</th>
                            <th className="px-6 py-4">Valores (Real vs Esperado)</th>
                            <th className="px-6 py-4">Desviación</th>
                            <th className="px-6 py-4">Severidad</th>
                            <th className="px-6 py-4">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-sm">
                        {alerts.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-slate-500 italic">No se han detectado anomalías de movimientos recientemente.</td>
                            </tr>
                        ) : (
                            alerts.map((alert) => (
                                <tr key={alert.id} className={`hover:bg-slate-800/30 transition-colors ${alert.status !== 'open' ? 'opacity-50' : ''}`}>
                                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                                        {new Date(alert.detected_at).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-white">{alert.sku_id}</div>
                                        <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{alert.sku_name}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-[10px] font-bold uppercase">
                                            {alert.movement_type}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="text-white font-mono">{alert.actual_value.toLocaleString()} <span className="text-slate-500 text-[10px]">REAL</span></span>
                                            <span className="text-slate-500 font-mono text-xs">{alert.expected_value.toLocaleString()} <span className="text-[10px]">AVG</span></span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 font-bold text-rose-500">
                                        {alert.deviation_pct.toFixed(1)}%
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${alert.severity === 'critical' ? 'bg-rose-500/10 text-rose-500' :
                                                alert.severity === 'moderate' ? 'bg-amber-500/10 text-amber-500' :
                                                    'bg-slate-500/10 text-slate-400'
                                            }`}>
                                            {alert.severity}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {alert.status === 'open' ? (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleAction(alert.id, 'reviewed')}
                                                    className="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white p-1.5 rounded transition-all shadow-sm"
                                                    title="Marcar como revisado"
                                                >
                                                    <span className="material-symbols-rounded text-sm">check_circle</span>
                                                </button>
                                                <button
                                                    onClick={() => handleAction(alert.id, 'dismissed')}
                                                    className="bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white p-1.5 rounded transition-all shadow-sm"
                                                    title="Descartar (Falso Positivo)"
                                                >
                                                    <span className="material-symbols-rounded text-sm">cancel</span>
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-[10px] uppercase font-bold text-slate-600 tracking-wider">
                                                {alert.status}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
