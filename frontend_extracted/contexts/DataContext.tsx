
import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { SKU, ABCClass, XYZClass } from '../types';
import { MOCK_SKUS } from '../constants';
import { api } from '../services/api';
import { cacheService } from '../services/cache';

export interface ConsumptionConfig {
  includeVenta: boolean;
  includeConsumo: boolean;
  includeTraspaso: boolean;
}

export interface DataContextType {
  skus: SKU[];
  importData: (file: File) => Promise<void>;
  isLoading: boolean;
  updateSku: (id: string, updates: Partial<SKU>) => void;
  isBackendOnline: boolean;
  checkConnection: () => Promise<void>;
  uploadStatus: { maestro: boolean; demanda: boolean; movimientos: boolean; stock: boolean; produccion: boolean };
  debugLogs: string[];
  consumptionConfig: ConsumptionConfig;
  updateConsumptionConfig: (config: ConsumptionConfig) => void;
  selectedCountry: string;
  setSelectedCountry: (country: string) => void;
  availableCountries: string[];
  processMap: Record<string, string>;
  rawAggregatedConsumption: any[];
  rawMaestro: any[];
  rawHybridPlanning: any[];
  rawExplodedDemand: any[]; // NEW
  rawProjectedDemand: any[]; // NEW
  addLog: (msg: string) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [skus, setSkus] = useState<SKU[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ maestro: false, demanda: false, movimientos: false, stock: false, produccion: false });

  // Raw Data Storage for rapid recalculation
  const [rawAggregatedConsumption, setRawAggregatedConsumption] = useState<any[]>([]);
  const [rawMaestro, setRawMaestro] = useState<any[]>([]);
  const [rawHybridPlanning, setRawHybridPlanning] = useState<any[]>([]);
  const [rawExplodedDemand, setRawExplodedDemand] = useState<any[]>([]);
  const [rawProjectedDemand, setRawProjectedDemand] = useState<any[]>([]);

  // Selected Country State
  const [selectedCountry, setSelectedCountry] = useState<string>(() => {
    return localStorage.getItem('pcp_selected_country') || 'Peru';
  });

  const [availableCountries, setAvailableCountries] = useState<string[]>(['Peru', 'Bolivia', 'Ecuador', 'Chile', 'Colombia', 'All']);
  const [processMap, setProcessMap] = useState<Record<string, string>>({});

  // Consumption Configuration
  const [consumptionConfig, setConsumptionConfig] = useState<ConsumptionConfig>({
    includeVenta: true,
    includeConsumo: true,
    includeTraspaso: true
  });

  // Save selection to localStorage
  useEffect(() => {
    localStorage.setItem('pcp_selected_country', selectedCountry);
  }, [selectedCountry]);

  const adaptMaestroToSKU = (item: any, consumptionStats: any = {}, hybridPlanning: Record<string, any> = {}, demandMap: Record<string, number[]> = {}): SKU => {
    // Normalize codigo for matching: remove leading zeros
    const normId = (item.codigo || '').toString().replace(/^0+/, '');
    const stats = consumptionStats[normId] || {};
    const hybrid = hybridPlanning[normId] || {};

    // SOURCE OF TRUTH: Use hybrid planning data if available
    // Otherwise fallback to stats or maestro
    // Monthly history for validation
    const monthlyConsumption = stats.history || [];

    // Metrics from Hybrid Plan (Backend)
    const adu = hybrid.adu_hibrido_final !== undefined ? Number(hybrid.adu_hibrido_final) : (stats.adu !== undefined ? stats.adu : (Number(item.adu) || 0));
    const stdDev = hybrid.desv_std_diaria !== undefined ? Number(hybrid.desv_std_diaria) : (stats.stdDev !== undefined ? stats.stdDev : (Number(item.std_dev_approx) || 0));
    const adu6m = hybrid.adu_mensual_6m !== undefined ? Number(hybrid.adu_mensual_6m) : (stats.adu6m || 0);
    const aduL30d = hybrid.adu_diario_l30d !== undefined ? Number(hybrid.adu_diario_l30d) : 0;
    const fei = hybrid.factor_fin_mes !== undefined ? Number(hybrid.factor_fin_mes) : 1;

    const cov = adu > 0 ? (stdDev / adu) : 0;

    // SOURCE OF TRUTH: Use backend segmentation from hybrid data
    const abc = hybrid.abc_segment || (item.abc || ABCClass.C);
    const xyz = hybrid.xyz_segment || (item.clase || XYZClass.Z);

    // Performance & Pattern Metrics
    const turnover = hybrid.turnover_ratio !== undefined ? Number(hybrid.turnover_ratio) : 0;
    const periods = hybrid.active_months !== undefined ? Number(hybrid.active_months) : 0;

    // 4. Expert DDMRP Buffer Logic (Refined)
    // Usar Lead Time del maestro si existe (>0), sino default 25
    const leadTime = (item.lead_time && item.lead_time > 0) ? item.lead_time : 25;
    const ltf = 0.2;     // Lead Time Factor (LTF) - Adjusted from 0.3

    // Variability Factor (VF) - Expert Tiers
    let vf = 0.7;
    if (cov <= 0.5) vf = 0.2;
    else if (cov < 0.8) vf = 0.4;

    const yellowZone = adu * leadTime;
    const redBase = adu * leadTime * ltf;
    const redAlert = adu * leadTime * vf; // New formula: ADU * LT * VF
    const redTotal = redBase + redAlert;

    const stockLevel = Number((item.stock || 0).toFixed(2));

    // Ponderar SOURCE OF TRUTH vs Cálculo local para SS y ROP
    // Fallback al cálculo local si el valor del backend es 0 o indefinido
    const safetyStockValue = (hybrid.stock_seguridad !== undefined && Number(hybrid.stock_seguridad) > 0) ? Number(hybrid.stock_seguridad) : redTotal;
    const ropValue = (hybrid.punto_reorden !== undefined && Number(hybrid.punto_reorden) > 0) ? Number(hybrid.punto_reorden) : (redTotal + yellowZone);

    return {
      id: item.codigo,
      name: item.descripcion || `Item ${item.codigo}`,
      category: item.grupo_articulos || 'General',
      abc,
      xyz,
      stockLevel,
      safetyStock: parseFloat(safetyStockValue.toFixed(2)),
      rop: parseFloat(ropValue.toFixed(2)),
      leadTime,
      serviceLevelTarget: 0.95,
      cost: 0, // Campo deprecado - no se usa en cálculos
      lifecycleStatus: 'Mature',
      history: [],
      forecast: demandMap[normId] || [], // Use the map we built
      alerts: [],
      monthlyConsumption, // Attached history

      // Segmentation fields
      jerarquia1: item.jerarquia_nivel_1 || 'Sin Jerarquía',
      grupoArticulosDesc: item.grupo_articulos_descripcion || 'Sin Grupo',
      tipoMaterial: item.tipo_material || 'N/A',

      adu: parseFloat(adu.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      variabilityFactor: vf,
      ddmrpZones: {
        yellow: parseFloat(yellowZone.toFixed(2)),
        redBase: parseFloat(redBase.toFixed(2)),
        redAlert: parseFloat(redAlert.toFixed(2)),
        redTotal: parseFloat(redTotal.toFixed(2))
      },
      // Hybrid Metrics Mapping
      adu6m: parseFloat(adu6m.toFixed(2)),
      aduL30d: parseFloat(aduL30d.toFixed(2)),
      fei: parseFloat(fei.toFixed(2)),
      hybridState: hybrid.estado_critico,
      stockActualHybrid: hybrid.stock_actual !== undefined ? Number(hybrid.stock_actual) : undefined,
      // Performance & Pattern Metrics
      turnover: turnover,
      periods: periods,
      rotationSegment: hybrid.rotation_segment as 'High' | 'Medium' | 'Low',
      periodicitySegment: hybrid.periodicity_segment as 'High' | 'Medium' | 'Low',
      procesos: item.procesos || '',
    };
  };

  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setDebugLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 20));
  };

  const isFetching = useRef(false);

  const loadData = async () => {
    if (isFetching.current) return;
    isFetching.current = true;
    setIsLoading(true);

    const startTime = performance.now();
    addLog(`Iniciando carga de datos para ${selectedCountry}...`);

    const startTimeNet = performance.now();

    try {
      // 1. Carga de estáticos o metadatos rápidos
      const [status, processes] = await Promise.all([
        api.getSystemStatus().catch(e => { console.error(e); return null; }),
        api.getProcessClasses().catch(e => { console.error(e); return []; })
      ]);

      if (status) {
        setIsBackendOnline(status.online);
        setUploadStatus(status);
      }

      if (processes.length > 0) {
        const pMap: Record<string, string> = {};
        processes.forEach((p: any) => {
          if (p.clase_proceso) {
            pMap[p.clase_proceso] = `${p.clase_proceso} - ${p.descripcion_proceso || 'Sin Descripción'}`;
          }
        });
        setProcessMap(pMap);
      }

      // 2. Carga MASIVA en paralelo con caché persistente
      const fetchAllMaestro = async () => {
        let all: any[] = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          const resp = await api.getMaestro(page * pageSize, pageSize, selectedCountry);
          if (resp.items && resp.items.length > 0) {
            all = [...all, ...resp.items];
            if (resp.items.length < pageSize) hasMore = false;
            page++;
          } else {
            hasMore = false;
          }
        }
        return all;
      };

      const [aggregates, maestroData, hybridData, explodedData, projectedData] = await Promise.all([
        api.getConsumoAgregado(selectedCountry).catch(e => { console.error(e); return null; }),
        fetchAllMaestro().catch(e => { console.error(e); return null; }),
        api.getHybridPlanningData(selectedCountry).catch(e => { console.error(e); return null; }),
        api.getAllExplodedDemand(new Date().toISOString().slice(0, 7) + '-01').catch(e => { console.error(e); return null; }),
        api.getAllDemanda().catch(e => { console.error(e); return null; })
      ]);

      const endTimeNet = performance.now();
      addLog(`Descarga completada en ${((endTimeNet - startTimeNet) / 1000).toFixed(2)}s.`);

      // Actualizar estados y Persistir en IndexedDB (Supera límite 5MB de LocalStorage)
      if (maestroData) {
        let filteredMaestro = [...maestroData];
        try {
          const plannedSkuIds = await api.getPlannedSkuIds();
          const beforeCount = filteredMaestro.length;
          filteredMaestro = filteredMaestro.filter((item: any) => {
            const normId = (item.codigo || '').toString().replace(/^0+/, '');
            return plannedSkuIds.has(normId);
          });
          addLog(`Filtro Planificación: ${filteredMaestro.length} de ${beforeCount} SKUs tienen plan de producción reciente`);
        } catch (e: any) {
          console.warn("Error fetching planned SKU filter, showing all SKUs", e);
          addLog("Advertencia: No se pudo aplicar filtro de planificación: " + e.message);
        }

        setRawMaestro(filteredMaestro);
        cacheService.set(`cache_maestro_${selectedCountry}`, filteredMaestro);
      }
      if (aggregates) {
        setRawAggregatedConsumption(aggregates);
        cacheService.set(`cache_aggregates_${selectedCountry}`, aggregates);
      }
      if (hybridData) {
        setRawHybridPlanning(hybridData);
        cacheService.set(`cache_hybrid_${selectedCountry}`, hybridData);
      }
      if (explodedData) setRawExplodedDemand(explodedData);
      if (projectedData) setRawProjectedDemand(projectedData);

      const endTime = performance.now();
      addLog(`Carga completada en ${((endTime - startTime) / 1000).toFixed(2)}s. Total SKUs: ${maestroData ? maestroData.length : 0}`);

    } catch (err: any) {
      console.error("Error global en loadData:", err);
      addLog("Fallo crítico en carga: " + err.message);

      // Fallback a caché si la red falla totalmente
      if (rawMaestro.length === 0) {
        addLog("Intentando recuperar de caché local...");
        const cM = await cacheService.get(`cache_maestro_${selectedCountry}`);
        if (cM) setRawMaestro(cM);
      }
    } finally {
      setIsLoading(false);
      isFetching.current = false;
    }
  };

  // Recalculate Metrics whenever Aggregates or Maestro changes
  useEffect(() => {
    if (rawMaestro.length === 0) return;

    const calculate = () => {
      const startTime = performance.now();

      // 1. Build Consumption Map (Optimized pass)
      const consumptionMap: Record<string, any> = {};

      // Get last 6 months (up to the previous month)
      const today = new Date();
      const monthsToCheck: string[] = [];
      for (let i = 6; i >= 1; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        monthsToCheck.push(`${yyyy}-${mm}`);
      }

      rawAggregatedConsumption.forEach((agg: any) => {
        const rawId = (agg.sku_id || '').toString();
        const skuId = rawId.replace(/^0+/, '');
        const month = (agg.mes || '').substring(0, 7);

        if (!monthsToCheck.includes(month)) return;

        const type = (agg.tipo2 || '').toLowerCase();
        let include = false;
        if (consumptionConfig.includeVenta && type.includes('venta')) include = true;
        else if (consumptionConfig.includeConsumo && type.includes('consumo')) include = true;
        else if (consumptionConfig.includeTraspaso && type.includes('traspaso')) include = true;

        if (include) {
          if (!consumptionMap[skuId]) {
            consumptionMap[skuId] = {
              totals: {},
              values: []
            };
          }
          consumptionMap[skuId].totals[month] = (consumptionMap[skuId].totals[month] || 0) + Number(agg.cantidad_total_tn);
        }
      });

      // 2. Finalize metrics per SKU in consumptionMap
      Object.keys(consumptionMap).forEach(skuId => {
        const data = consumptionMap[skuId];
        const values = monthsToCheck.map(m => data.totals[m] || 0);
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / 6;
        const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / 6;
        const dailyStdDev = Math.sqrt(variance) / Math.sqrt(30);

        consumptionMap[skuId] = {
          adu: mean / 30,
          adu6m: mean / 30,
          stdDev: dailyStdDev,
          history: monthsToCheck.map((m, i) => ({ month: m, quantity: values[i] }))
        };
      });

      // 3. Build Hybrid Planning Map (O(n))
      const hybridMap: Record<string, any> = {};
      rawHybridPlanning.forEach(item => {
        const sid = (item.sku_id || '').toString().replace(/^0+/, '');
        hybridMap[sid] = item;
      });

      // 3.5 Build Demand Map (Direct + Exploded)
      const demandMap: Record<string, number[]> = {};
      const currentMonthStr = new Date().toISOString().slice(0, 7);
      const nextMonthDate = new Date();
      nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
      const nextMonthStr = nextMonthDate.toISOString().slice(0, 7);

      // Helper to add demand
      const addDemand = (sku: string, month: string, qty: number) => {
        const sid = (sku || '').toString().replace(/^0+/, '');
        if (!demandMap[sid]) demandMap[sid] = [0, 0]; // [Current, Next]

        if (month === currentMonthStr) demandMap[sid][0] += qty;
        else if (month === nextMonthStr) demandMap[sid][1] += qty;
      };

      // A. Direct Demand (Finished Goods)
      rawProjectedDemand.forEach(d => {
        // sap_demanda_proyectada has 'mes' as full date string usually YYYY-MM-DD
        const m = (d.mes || '').substring(0, 7);
        addDemand(d.sku_id, m, Number(d.cantidad));
      });

      // B. Exploded Demand (Components)
      rawExplodedDemand.forEach(d => {
        const m = (d.mes || '').substring(0, 7);
        addDemand(d.sku_id, m, Number(d.cantidad_exploded));
      });


      // 4. Map Maestro to SKUs (O(n))
      try {
        const realSkus = rawMaestro.map((item: any) => adaptMaestroToSKU(item, consumptionMap, hybridMap, demandMap));
        setSkus(realSkus);

        const endTime = performance.now();
        addLog(`Motor Híbrido: ${realSkus.length} SKUs procesados en ${((endTime - startTime)).toFixed(1)}ms`);
      } catch (err: any) {
        console.error("Crash during metrics calculation:", err);
        addLog("Error en cálculo: " + err.message);
        if (skus.length === 0) setSkus(MOCK_SKUS);
      }
    };

    calculate();
  }, [rawAggregatedConsumption, rawMaestro, rawHybridPlanning, rawExplodedDemand, rawProjectedDemand, consumptionConfig]);

  useEffect(() => {
    addLog(`Cambiando contexto a: ${selectedCountry}`);
    loadData();
  }, [selectedCountry]);

  useEffect(() => {
    addLog("Iniciando DataProvider...");

    // Intento de precarga desde IndexedDB para sensación de 0s (Supera 5MB limit)
    const initCache = async () => {
      try {
        const [cM, cA, cH] = await Promise.all([
          cacheService.get(`cache_maestro_${selectedCountry}`),
          cacheService.get(`cache_aggregates_${selectedCountry}`),
          cacheService.get(`cache_hybrid_${selectedCountry}`)
        ]);

        if (cM && cA && cH) {
          addLog("Cargando datos desde caché local (Warm Start)...");
          setRawMaestro(cM);
          setRawAggregatedConsumption(cA);
          setRawHybridPlanning(cH);
        }
      } catch (e) {
        console.warn("Error leyendo caché:", e);
      }
    };

    initCache();

    const interval = setInterval(() => loadData(), 300000); // Polling cada 5m
    return () => clearInterval(interval);
  }, []);

  const importData = async (file: File) => {
    alert("La carga manual ha sido deshabilitada. Los datos se sincronizan automáticamente desde OneDrive cada mañana.");
    addLog("Intento de carga manual bloqueado (Feature Deprecated)");
  };

  const resetData = async () => {
    alert("El reinicio de base de datos no está permitido en la versión web/conectada. Contacte al administrador si requiere re-sincronización total.");
  };

  const updateSku = (id: string, updates: Partial<SKU>) => {
    setSkus(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const checkConnection = async () => {
    await loadData();
  };

  const updateConsumptionConfig = (newConfig: ConsumptionConfig) => {
    setConsumptionConfig(newConfig);
  };


  return (
    <DataContext.Provider value={{
      skus,
      importData,
      resetData,
      isLoading,
      updateSku,
      isBackendOnline,
      checkConnection,
      uploadStatus,
      debugLogs,
      consumptionConfig,
      updateConsumptionConfig,
      selectedCountry,
      setSelectedCountry,
      availableCountries,
      processMap,
      rawAggregatedConsumption,
      rawMaestro,
      rawHybridPlanning,
      rawExplodedDemand,
      rawProjectedDemand,
      addLog,
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
};
