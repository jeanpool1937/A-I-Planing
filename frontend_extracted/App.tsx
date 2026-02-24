
import React, { useState } from 'react';
import { DataProvider, useData } from './contexts/DataContext';
import { Dashboard } from './pages/Dashboard';
import { DemandPlanning } from './pages/DemandPlanning';
import { InventoryOptimization } from './pages/InventoryOptimization';
import { SupplyPlanning } from './pages/SupplyPlanning';

import { StockProjection } from './pages/StockProjection';
import { CriticalStockPage } from './pages/CriticalStockPage';
import { DeviationAnalysisPage } from './pages/DeviationAnalysisPage';
import { MasterReport } from './pages/MasterReport';
import { Configuration } from './pages/Configuration';
import { FilterBar } from './components/FilterBar';


enum View {
  DASHBOARD = 'dashboard',
  DEMAND = 'demand',
  INVENTORY = 'inventory',
  SUPPLY = 'supply',
  CRITICAL_STOCK = 'critical_stock',
  DEVIATION_ANALYSIS = 'deviation_analysis',
  PROJECTION = 'projection',
  MASTER_REPORT = 'master_report',
  CONFIGURATION = 'configuration',
}


import { LoginScreen } from './components/LoginScreen';

const AppContent: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('pcp_auth') === 'true';
  });

  const [currentView, setCurrentView] = useState<View>(View.DASHBOARD);
  const [sharedSelectedSku, setSharedSelectedSku] = useState<string>('');
  const { skus } = useData();

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  // Global Segmentation Filters
  const [selectedJerarquia, setSelectedJerarquia] = useState('');
  const [selectedGrupo, setSelectedGrupo] = useState('');
  const [selectedProceso, setSelectedProceso] = useState<string[]>([]);
  const [showManufacturedOnly, setShowManufacturedOnly] = useState(false);
  const [showOnlyPlanned, setShowOnlyPlanned] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSkus = skus.filter(s =>
    (!selectedJerarquia || s.jerarquia1 === selectedJerarquia) &&
    (!selectedGrupo || s.grupoArticulosDesc === selectedGrupo) &&
    (selectedProceso.length === 0 || selectedProceso.some(p => (s.procesos || '').includes(p))) &&
    (!showManufacturedOnly || (s.procesos && s.procesos.length > 0)) &&
    (!showOnlyPlanned || (s.forecast && s.forecast.some(f => f > 0))) &&
    (!searchQuery ||
      (s.id || '').toString().toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const showFilterBar = [View.DASHBOARD, View.DEMAND, View.INVENTORY, View.SUPPLY, View.PROJECTION, View.MASTER_REPORT].includes(currentView);

  const renderContent = () => {
    switch (currentView) {
      case View.DASHBOARD: return (
        <Dashboard
          onViewChange={setCurrentView}
          filteredSkus={filteredSkus}
          onSkuSelect={(id) => {
            setSharedSelectedSku(id);
            setCurrentView(View.PROJECTION);
          }}
        />
      );
      case View.DEMAND: return <DemandPlanning filteredSkus={filteredSkus} selectedJerarquia={selectedJerarquia} selectedGrupo={selectedGrupo} selectedProceso={selectedProceso} />;
      case View.INVENTORY: return <InventoryOptimization filteredSkus={filteredSkus} />;
      case View.SUPPLY: return <SupplyPlanning filteredSkus={filteredSkus} />;
      case View.MASTER_REPORT: return <MasterReport filteredSkus={filteredSkus} />;
      case View.CRITICAL_STOCK: return <CriticalStockPage />;
      case View.DEVIATION_ANALYSIS: return <DeviationAnalysisPage />;
      case View.PROJECTION: return (
        <StockProjection
          sharedSkuId={sharedSelectedSku}
          onSkuChange={setSharedSelectedSku}
          filteredSkus={filteredSkus}
        />
      );
      case View.CONFIGURATION: return <Configuration />;
      default: return <Dashboard onViewChange={setCurrentView} filteredSkus={filteredSkus} />;
    }
  };

  const NavItem = ({ view, icon, label }: { view: View; icon: string; label: string }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${currentView === view
        ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/20'
        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        }`}
    >
      <span className="material-symbols-rounded">{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="flex h-screen bg-dark-950 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-dark-900 border-r border-slate-800 flex flex-col">
        {/* ... existing header ... */}
        <div className="p-6 border-b border-slate-800">
          {/* ... header content ... */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary-600/20">
              <span className="material-symbols-rounded">psychology</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">A+I Planning</h1>
              <p className="text-[10px] uppercase tracking-widest text-primary-500 font-bold">Engine v3.0</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2 px-2">Análisis</div>
          <NavItem view={View.DASHBOARD} icon="dashboard" label="Dashboard General" />
          <NavItem view={View.DEMAND} icon="trending_up" label="Plan. de Demanda" />

          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2 mt-6 px-2">Operaciones</div>
          <NavItem view={View.INVENTORY} icon="inventory_2" label="Opt. Inventario" />
          <NavItem view={View.SUPPLY} icon="conveyor_belt" label="Suministro & Prod." />
          <NavItem view={View.PROJECTION} icon="stacked_line_chart" label="Proyección Stock" />
          <NavItem view={View.MASTER_REPORT} icon="description" label="Reporte Maestro" />

          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2 mt-6 px-2">Gestión Crítica</div>
          <NavItem view={View.CRITICAL_STOCK} icon="warning" label="Quiebres Críticos" />
          <NavItem view={View.DEVIATION_ANALYSIS} icon="query_stats" label="Análisis Desviación" />

          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2 mt-6 px-2">Sistema</div>

          <NavItem view={View.CONFIGURATION} icon="tune" label="Configuración" />
        </nav>

        {/* ... existing footer ... */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 p-2 rounded-lg bg-slate-800/50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow-inner">
              PCP
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-white truncate">Planificador</p>
              <p className="text-[10px] text-slate-400">Master Planner</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-dark-950 relative">
        <header className="sticky top-0 z-20 bg-dark-950/80 backdrop-blur-md border-b border-slate-800 px-8 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {currentView === View.DASHBOARD && 'Visión General'}
              {currentView === View.DEMAND && 'Planificación de Demanda'}
              {currentView === View.INVENTORY && 'Optimización de Inventario'}
              {currentView === View.SUPPLY && 'Planificación de Suministro'}
              {currentView === View.PROJECTION && 'Proyección de Stock (Daily Bucket)'}
              {currentView === View.MASTER_REPORT && 'Reporte Maestro de Proyección'}
              {currentView === View.CRITICAL_STOCK && 'Gestión de Quiebres Críticos'}
              {currentView === View.DEVIATION_ANALYSIS && 'Análisis de Desviación'}

              {currentView === View.CONFIGURATION && 'Configuración del Sistema'}
            </h2>
            <p className="text-sm text-slate-400">
              {currentView === View.CONFIGURATION ? 'Gestión y ajustes del sistema' :
                currentView === View.CRITICAL_STOCK ? `Análisis activo sobre ${criticalItemsCount(filteredSkus)} SKUs críticos` :
                  currentView === View.DEVIATION_ANALYSIS ? 'Comparativo Plan vs Real (Producción, Ventas, Consumo)' :
                    `Análisis activo sobre ${filteredSkus.length} SKUs${selectedJerarquia ? ` · ${selectedJerarquia}` : ''}${selectedProceso.length > 0 ? ` · ${selectedProceso.join(', ')}` : ''}`}
            </p>
          </div>

        </header>

        <div className="p-8">
          {/* Global Filter Bar */}
          {showFilterBar && (
            <FilterBar
              skus={skus}
              selectedJerarquia={selectedJerarquia}
              setSelectedJerarquia={setSelectedJerarquia}
              selectedGrupo={selectedGrupo}
              setSelectedGrupo={setSelectedGrupo}
              selectedProceso={selectedProceso}
              setSelectedProceso={setSelectedProceso}
              showManufacturedOnly={showManufacturedOnly}
              setShowManufacturedOnly={setShowManufacturedOnly}
              showOnlyPlanned={showOnlyPlanned}
              setShowOnlyPlanned={setShowOnlyPlanned}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
          )}
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

const criticalItemsCount = (items: any[]) => items.filter((i: any) => i.stockLevel < i.safetyStock).length;

const App: React.FC = () => (
  <DataProvider>
    <AppContent />
  </DataProvider>
);

export default App;
