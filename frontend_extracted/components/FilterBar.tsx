import React from 'react';
import { useData } from '../contexts/DataContext';
import { SearchableSelect } from './SearchableSelect';

interface FilterBarProps {
    skus: any[];
    selectedJerarquia: string;
    setSelectedJerarquia: (val: string) => void;
    selectedGrupo: string;
    setSelectedGrupo: (val: string) => void;
    selectedProceso: string[];
    setSelectedProceso: (val: string[]) => void;
    showManufacturedOnly: boolean;
    setShowManufacturedOnly: (val: boolean) => void;
    showOnlyPlanned: boolean;
    setShowOnlyPlanned: (val: boolean) => void;
    searchQuery: string;
    setSearchQuery: (val: string) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
    skus,
    selectedJerarquia,
    setSelectedJerarquia,
    selectedGrupo,
    setSelectedGrupo,
    selectedProceso,
    setSelectedProceso,
    showManufacturedOnly,
    setShowManufacturedOnly,
    showOnlyPlanned,
    setShowOnlyPlanned,
    searchQuery,
    setSearchQuery
}) => {
    const { processMap } = useData();

    // Extraer valores únicos de la lista de SKUs
    const jerarquias = Array.from(new Set(skus.map(s => s.jerarquia1).filter(Boolean))).sort();

    // Procesos únicos: Un SKU puede tener varios procesos en string separado por comas
    const procesos = Array.from(
        new Set(
            skus
                .flatMap(s => (s.procesos || '').split(',').map((p: string) => p.trim()))
                .filter(Boolean)
        )
    ).sort();

    const grupos = Array.from(
        new Set(
            skus
                .filter(s =>
                    (selectedProceso.length === 0 || selectedProceso.some(p => (s.procesos || '').includes(p))) &&
                    (!showManufacturedOnly || (s.procesos && s.procesos.length > 0)) &&
                    (!showOnlyPlanned || (s.forecast && s.forecast.some(f => f > 0)))
                )
                .map(s => s.grupoArticulosDesc)
                .filter(Boolean)
        )
    ).sort();

    const activeCount = (selectedJerarquia ? 1 : 0) + (selectedGrupo ? 1 : 0) + (selectedProceso.length > 0 ? 1 : 0) + (showManufacturedOnly ? 1 : 0) + (showOnlyPlanned ? 1 : 0) + (searchQuery ? 1 : 0);

    return (
        <div className="flex flex-wrap items-center gap-3 bg-dark-900 border border-slate-800 rounded-xl px-4 py-3 mb-6">
            <div className="flex items-center gap-2 text-slate-400 mr-2">
                <span className="material-symbols-rounded text-lg">filter_alt</span>
                <span className="text-xs font-bold uppercase tracking-wider">Segmentación</span>
                {activeCount > 0 && (
                    <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">
                        {activeCount}
                    </span>
                )}
            </div>

            {/* Buscador de SKU/Descripción */}
            <div className="relative flex-1 min-w-[250px]">
                <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar por código o descripción..."
                    className="w-full bg-slate-800 border border-slate-700 text-sm text-white rounded-lg pl-10 pr-4 py-1.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all"
                />
                <span className="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-lg pointer-events-none">
                    search
                </span>
                {searchQuery && (
                    <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                    >
                        <span className="material-symbols-rounded text-sm">close</span>
                    </button>
                )}
            </div>

            {/* Jerarquía 1 */}
            <div className="relative">
                <select
                    value={selectedJerarquia}
                    onChange={e => {
                        setSelectedJerarquia(e.target.value);
                        setSelectedGrupo(''); // Reset grupo when hierarchy changes
                    }}
                    className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg pl-3 pr-8 py-1.5 appearance-none cursor-pointer focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                >
                    <option value="">Todas las Jerarquías</option>
                    {jerarquias.map(j => (
                        <option key={j} value={j}>{j}</option>
                    ))}
                </select>
                <span className="material-symbols-rounded absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">
                    expand_more
                </span>
            </div>

            {/* Proceso Productivo */}
            <div className="w-80">
                <SearchableSelect
                    options={procesos}
                    labelMap={processMap}
                    value={selectedProceso}
                    onChange={(val) => {
                        setSelectedProceso(val as string[]);
                        setSelectedGrupo('');
                    }}
                    placeholder="Buscar Proceso (ej. Z215)..."
                    emptyLabel="Todos los Procesos"
                    multiple={true}
                />
            </div>

            {/* Solo Fabricados Toggle */}
            <div className="flex items-center gap-2 border-l border-slate-800 pl-3 ml-2 mr-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={showManufacturedOnly}
                            onChange={e => setShowManufacturedOnly(e.target.checked)}
                        />
                        <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                    </div>
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors select-none">Solo Fabricados</span>
                </label>
            </div>

            {/* Solo con Plan Toggle */}
            <div className="flex items-center gap-2 border-l border-slate-800 pl-3 mr-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={showOnlyPlanned}
                            onChange={e => setShowOnlyPlanned(e.target.checked)}
                        />
                        <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                    </div>
                    <span className="text-sm text-slate-300 group-hover:text-white transition-colors select-none">Solo con Plan</span>
                </label>
            </div>

            {/* Grupo Artículos */}
            <div className="relative">
                <select
                    value={selectedGrupo}
                    onChange={e => setSelectedGrupo(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg pl-3 pr-8 py-1.5 appearance-none cursor-pointer focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                >
                    <option value="">Todos los Grupos</option>
                    {grupos.map(g => (
                        <option key={g} value={g}>{g}</option>
                    ))}
                </select>
                <span className="material-symbols-rounded absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">
                    expand_more
                </span>
            </div>

            {/* Clear Filters */}
            {activeCount > 0 && (
                <button
                    onClick={() => {
                        setSelectedJerarquia('');
                        setSelectedGrupo('');
                        setSelectedProceso([]);
                        setShowManufacturedOnly(false);
                        setShowOnlyPlanned(false);
                        setSearchQuery('');
                    }}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded-lg border border-red-500/20 transition-colors"
                >
                    <span className="material-symbols-rounded text-sm">close</span>
                    Limpiar
                </button>
            )}

            {/* Count indicator */}
            <div className="ml-auto text-xs text-slate-500">
                <span className="text-white font-bold">
                    {skus.filter(s =>
                        (!selectedJerarquia || s.jerarquia1 === selectedJerarquia) &&
                        (!selectedGrupo || s.grupoArticulosDesc === selectedGrupo) &&
                        (selectedProceso.length === 0 || selectedProceso.some(p => (s.procesos || '').includes(p))) &&
                        (!showManufacturedOnly || (s.procesos && s.procesos.length > 0)) &&
                        (!showOnlyPlanned || (s.forecast && s.forecast.some(f => f > 0))) &&
                        (!searchQuery ||
                            (s.id || '').toString().toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (s.name || '').toLowerCase().includes(searchQuery.toLowerCase())
                        )
                    ).length}
                </span>
                <span> de {skus.length} SKUs</span>
            </div>
        </div>
    );
};
