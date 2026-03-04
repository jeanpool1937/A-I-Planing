
/**
 * IndexedDB Cache Manager
 * Permite persistir grandes volúmenes de datos (>5MB) superando los límites de localStorage.
 * Incluye soporte de TTL (Time-To-Live) para evitar re-fetches innecesarios a Supabase.
 */

const DB_NAME = 'PCP_Cache_DB';
const DB_VERSION = 2; // Incrementado para forzar migración/upgrade
const STORE_NAME = 'app_data_cache';

// TTL por defecto: 4 horas (datos sincronizan 1x/día desde SAP)
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

interface CacheEntry {
    data: any;
    timestamp: number;
}

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            // Eliminar store viejo si existe para recrearlo limpio
            if (db.objectStoreNames.contains(STORE_NAME)) {
                db.deleteObjectStore(STORE_NAME);
            }
            db.createObjectStore(STORE_NAME);
        };
    });
};

export const cacheService = {
    /**
     * Guarda un dato en caché con timestamp actual.
     */
    async set(key: string, data: any): Promise<void> {
        try {
            const db = await openDB();
            const entry: CacheEntry = { data, timestamp: Date.now() };
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put(entry, key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error('IndexedDB Set Error:', e);
        }
    },

    /**
     * Recupera un dato del caché. Retorna null si no existe.
     */
    async get(key: string): Promise<any | null> {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(key);
                request.onsuccess = () => {
                    const entry = request.result as CacheEntry | undefined;
                    resolve(entry ? entry.data : null);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error('IndexedDB Get Error:', e);
            return null;
        }
    },

    /**
     * Verifica si una entrada del caché ha expirado según el TTL dado.
     * @param key - Clave del caché
     * @param ttlMs - Tiempo de vida en milisegundos (default: 4 horas)
     * @returns true si expiró o no existe, false si aún es válida
     */
    async isExpired(key: string, ttlMs: number = DEFAULT_TTL_MS): Promise<boolean> {
        try {
            const db = await openDB();
            return new Promise((resolve) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(key);
                request.onsuccess = () => {
                    const entry = request.result as CacheEntry | undefined;
                    if (!entry || !entry.timestamp) {
                        resolve(true); // No existe → expirado
                        return;
                    }
                    const age = Date.now() - entry.timestamp;
                    resolve(age > ttlMs);
                };
                request.onerror = () => resolve(true); // Error → tratar como expirado
            });
        } catch (e) {
            console.error('IndexedDB isExpired Error:', e);
            return true;
        }
    },

    async delete(key: string): Promise<void> {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};
