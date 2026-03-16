import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';

interface SyncLog {
    id: number;
    run_date: string;
    table_name: string;
    rows_upserted: number;
    status: 'success' | 'error';
    error_msg: string | null;
    executed_at: string;
}

// Nombres amigables para las tablas
const TABLE_LABELS: Record<string, string> = {
    sap_consumo_movimientos: 'Consumo Diario',
    sap_produccion: 'Producción',
    sap_programa_produccion: 'Programa Producción',
    sap_stock_mb52: 'Stock MB52',
    sap_reporte_maestro: 'Reporte Maestro',
    sap_plan_inventario_hibrido: 'Plan de Inventario',
    sap_consumo_sku_mensual: 'Consumo Mensual',
    sap_demanda_proyectada: 'Demanda Proyectada',
};

const EXPECTED_TABLES = [
    'sap_consumo_movimientos',
    'sap_produccion',
    'sap_programa_produccion',
    'sap_stock_mb52',
    'sap_reporte_maestro',
];

export const SyncStatusWidget: React.FC = () => {
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const fetchLogs = async () => {
        setLoading(true);
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
            .from('sync_status_log')
            .select('*')
            .eq('run_date', today)
            .order('executed_at', { ascending: false });

        if (!error && data) {
            setLogs(data as SyncLog[]);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const handleManualSync = async () => {
        if (syncing) return;
        setSyncing(true);
        try {
            const resp = await fetch('http://localhost:8000/run-sync', { method: 'POST' });
            const data = await resp.json();

            if (data.status === 'started' || data.status === 'busy') {
                const interval = setInterval(async () => {
                    const statusResp = await fetch('http://localhost:8000/status');
                    const statusData = await statusResp.json();
                    if (!statusData.sync_in_progress) {
                        clearInterval(interval);
                        setSyncing(false);
                        fetchLogs();
                    }
                }, 3000);
            } else {
                setSyncing(false);
            }
        } catch (err) {
            console.error('Error llamando a la API local:', err);
            alert('No se pudo conectar con el servidor local. Asegúrate de que "backend/run_api.bat" esté ejecutándose.');
            setSyncing(false);
        }
    };

    // Cerrar panel al clic fuera
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        if (open) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    // Calcular estado global del día
    const todayUpdatedTables = new Set(logs.map((l) => l.table_name));
    const latestByTable = logs.reduce<Record<string, SyncLog>>((acc, log) => {
        if (!acc[log.table_name] || log.executed_at > acc[log.table_name].executed_at) {
            acc[log.table_name] = log;
        }
        return acc;
    }, {});

    const hasErrors = Object.values(latestByTable).some((l) => l.status === 'error');
    const allTablesUpdated = EXPECTED_TABLES.every((t) => todayUpdatedTables.has(t));
    const noDataToday = logs.length === 0;

    const globalStatus: 'success' | 'partial' | 'error' | 'pending' = noDataToday
        ? 'pending'
        : hasErrors
            ? 'error'
            : allTablesUpdated
                ? 'success'
                : 'partial';

    // Configuración visual por estado
    const statusConfig = {
        success: {
            dot: '#22c55e',
            glow: '0 0 8px rgba(34,197,94,0.6)',
            label: 'Sincronizado hoy',
            icon: 'check_circle',
            color: '#22c55e',
            badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        },
        partial: {
            dot: '#f59e0b',
            glow: '0 0 8px rgba(245,158,11,0.6)',
            label: 'Parcialmente actualizado',
            icon: 'warning',
            color: '#f59e0b',
            badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        },
        error: {
            dot: '#ef4444',
            glow: '0 0 8px rgba(239,68,68,0.6)',
            label: 'Error en sincronización',
            icon: 'error',
            color: '#ef4444',
            badge: 'bg-red-500/15 text-red-400 border-red-500/30',
        },
        pending: {
            dot: '#64748b',
            glow: 'none',
            label: 'Sin datos hoy',
            icon: 'schedule',
            color: '#64748b',
            badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
        },
    };

    const cfg = statusConfig[globalStatus];

    // Ya calculado arriba para hasErrors

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    };

    const totalRows = logs.filter((l) => l.status === 'success').reduce((s, l) => s + l.rows_upserted, 0);

    return (
        <div className="relative" ref={panelRef}>
            {/* Trigger Button */}
            <button
                onClick={() => setOpen((p) => !p)}
                title="Estado de sincronización de datos"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    border: `1px solid`,
                    borderColor: cfg.color + '50',
                    background: 'rgba(15,23,42,0.7)',
                    backdropFilter: 'blur(8px)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    color: cfg.color,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(30,41,59,0.9)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(15,23,42,0.7)')}
            >
                {/* Dot pulsante */}
                <span style={{ position: 'relative', width: '8px', height: '8px' }}>
                    <span
                        style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            background: cfg.dot,
                            boxShadow: cfg.glow,
                            animation: globalStatus === 'success' ? 'none' : 'pulse 2s infinite',
                        }}
                    />
                    {globalStatus !== 'pending' && globalStatus !== 'success' && (
                        <span
                            style={{
                                position: 'absolute',
                                inset: '-3px',
                                borderRadius: '50%',
                                background: cfg.dot,
                                opacity: 0.3,
                                animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
                            }}
                        />
                    )}
                </span>

                {loading ? (
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>Verificando…</span>
                ) : (
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{cfg.label}</span>
                )}

                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>
                    {open ? 'expand_less' : 'expand_more'}
                </span>
            </button>

            {/* Panel Desplegable */}
            {open && (
                <div
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 10px)',
                        right: 0,
                        width: '360px',
                        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                        border: '1px solid rgba(100,116,139,0.3)',
                        borderRadius: '16px',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(100,116,139,0.1)',
                        zIndex: 9999,
                        overflow: 'hidden',
                    }}
                >
                    {/* Header del panel */}
                    <div
                        style={{
                            padding: '16px 20px',
                            borderBottom: '1px solid rgba(100,116,139,0.2)',
                            background: 'rgba(15,23,42,0.5)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span
                                    className="material-symbols-rounded"
                                    style={{ color: cfg.color, fontSize: '20px' }}
                                >
                                    {cfg.icon}
                                </span>
                                <div>
                                    <p style={{ color: '#f1f5f9', fontSize: '14px', fontWeight: 700, margin: 0 }}>
                                        Sincronización de Datos
                                    </p>
                                    <p style={{ color: '#64748b', fontSize: '11px', margin: 0 }}>
                                        {new Date().toLocaleDateString('es-PE', {
                                            weekday: 'long',
                                            day: 'numeric',
                                            month: 'long',
                                        })}
                                    </p>
                                </div>
                            </div>
                            {!noDataToday && (
                                <div
                                    style={{
                                        background: cfg.color + '20',
                                        border: `1px solid ${cfg.color}40`,
                                        borderRadius: '8px',
                                        padding: '4px 10px',
                                        color: cfg.color,
                                        fontSize: '11px',
                                        fontWeight: 700,
                                    }}
                                >
                                    +{totalRows.toLocaleString()} filas
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Lista de tablas */}
                    <div style={{ padding: '12px 8px', maxHeight: '340px', overflowY: 'auto' }}>
                        {loading ? (
                            <p style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                                Cargando estado…
                            </p>
                        ) : noDataToday ? (
                            <div style={{ textAlign: 'center', padding: '24px 20px' }}>
                                <span
                                    className="material-symbols-rounded"
                                    style={{ fontSize: '40px', color: '#334155', display: 'block', marginBottom: '8px' }}
                                >
                                    cloud_off
                                </span>
                                <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>
                                    Los scripts aún no se han ejecutado hoy
                                </p>
                            </div>
                        ) : (
                            <>
                                {EXPECTED_TABLES.map((tableName) => {
                                    const log = latestByTable[tableName];
                                    const isOk = log?.status === 'success';
                                    const missing = !log;

                                    return (
                                        <div
                                            key={tableName}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '10px 12px',
                                                borderRadius: '10px',
                                                marginBottom: '4px',
                                                background: isOk
                                                    ? 'rgba(34,197,94,0.05)'
                                                    : missing
                                                        ? 'rgba(100,116,139,0.05)'
                                                        : 'rgba(239,68,68,0.05)',
                                                border: `1px solid ${isOk ? 'rgba(34,197,94,0.15)' : missing ? 'rgba(100,116,139,0.15)' : 'rgba(239,68,68,0.15)'}`,
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span
                                                    className="material-symbols-rounded"
                                                    style={{
                                                        fontSize: '16px',
                                                        color: isOk ? '#22c55e' : missing ? '#64748b' : '#ef4444',
                                                    }}
                                                >
                                                    {isOk ? 'check_circle' : missing ? 'radio_button_unchecked' : 'cancel'}
                                                </span>
                                                <div>
                                                    <p style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600, margin: 0 }}>
                                                        {TABLE_LABELS[tableName] || tableName}
                                                    </p>
                                                    <p style={{ color: '#475569', fontSize: '10px', margin: 0 }}>
                                                        {missing ? 'Pendiente' : isOk ? `${formatTime(log.executed_at)}` : log.error_msg?.slice(0, 40) + '…'}
                                                    </p>
                                                </div>
                                            </div>
                                            {log && isOk && (
                                                <span
                                                    style={{
                                                        background: 'rgba(34,197,94,0.15)',
                                                        color: '#22c55e',
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        padding: '2px 8px',
                                                        borderRadius: '6px',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    +{log.rows_upserted.toLocaleString()}
                                                </span>
                                            )}
                                            {missing && (
                                                <span
                                                    style={{
                                                        background: 'rgba(100,116,139,0.15)',
                                                        color: '#64748b',
                                                        fontSize: '11px',
                                                        padding: '2px 8px',
                                                        borderRadius: '6px',
                                                    }}
                                                >
                                                    —
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Tablas extra que se hayan actualizado (no esperadas) */}
                                {Object.keys(latestByTable)
                                    .filter((t) => !EXPECTED_TABLES.includes(t))
                                    .map((tableName) => {
                                        const log = latestByTable[tableName];
                                        const isOk = log.status === 'success';
                                        return (
                                            <div
                                                key={tableName}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '10px 12px',
                                                    borderRadius: '10px',
                                                    marginBottom: '4px',
                                                    background: isOk ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)',
                                                    border: `1px solid ${isOk ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}`,
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <span
                                                        className="material-symbols-rounded"
                                                        style={{ fontSize: '16px', color: isOk ? '#22c55e' : '#ef4444' }}
                                                    >
                                                        {isOk ? 'check_circle' : 'cancel'}
                                                    </span>
                                                    <div>
                                                        <p style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600, margin: 0 }}>
                                                            {TABLE_LABELS[tableName] || tableName}
                                                        </p>
                                                        <p style={{ color: '#475569', fontSize: '10px', margin: 0 }}>
                                                            {formatTime(log.executed_at)}
                                                        </p>
                                                    </div>
                                                </div>
                                                {isOk && (
                                                    <span
                                                        style={{
                                                            background: 'rgba(34,197,94,0.15)',
                                                            color: '#22c55e',
                                                            fontSize: '11px',
                                                            fontWeight: 700,
                                                            padding: '2px 8px',
                                                            borderRadius: '6px',
                                                        }}
                                                    >
                                                        +{log.rows_upserted.toLocaleString()}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    {!noDataToday && (
                        <div
                            style={{
                                padding: '12px 20px',
                                borderTop: '1px solid rgba(100,116,139,0.2)',
                                background: 'rgba(15,23,42,0.5)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <span style={{ color: '#475569', fontSize: '11px' }}>
                                {todayUpdatedTables.size} de {EXPECTED_TABLES.length} tablas actualizadas
                            </span>
                            <button
                                onClick={handleManualSync}
                                disabled={syncing}
                                style={{
                                    background: syncing ? 'rgba(100,116,139,0.1)' : 'rgba(59,130,246,0.15)',
                                    border: `1px solid ${syncing ? 'rgba(100,116,139,0.2)' : 'rgba(59,130,246,0.3)'}`,
                                    cursor: syncing ? 'not-allowed' : 'pointer',
                                    color: syncing ? '#64748b' : '#3b82f6',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    transition: 'all 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                    if (!syncing) e.currentTarget.style.background = 'rgba(59,130,246,0.25)';
                                }}
                                onMouseLeave={(e) => {
                                    if (!syncing) e.currentTarget.style.background = 'rgba(59,130,246,0.15)';
                                }}
                            >
                                <span className={`material-symbols-rounded ${syncing ? 'animate-spin' : ''}`} style={{ fontSize: '14px' }}>
                                    {syncing ? 'sync' : 'laundry'}
                                </span>
                                {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
                            </button>

                            <button
                                onClick={async () => {
                                    setLoading(true);
                                    await fetchLogs();
                                }}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#94a3b8',
                                    fontSize: '11px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(148,163,184,0.1)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                                <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>
                                    refresh
                                </span>
                                Actualizar
                            </button>
                        </div>
                    )}
                </div>
            )}

            <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
};
