import { createClient } from '@supabase/supabase-js';

// Prioridad: 
// 1. URL guardada en localStorage (para el túnel local)
// 2. URL por defecto (Supabase Cloud - solo como respaldo si no hay política restrictiva)
const DEFAULT_URL = 'https://nvrcsheavwwrcukhtvcw.supabase.co';
const TUNNEL_URL = localStorage.getItem('PCP_TUNNEL_URL');

const SUPABASE_URL = TUNNEL_URL || DEFAULT_URL;

// Nota: Para el túnel local, la anon_key no es estrictamente validada por nuestro mock, 
// pero se mantiene para compatibilidad con el cliente.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52cmNzaGVhdnd3cmN1a2h0dmN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzkyMDUsImV4cCI6MjA4NjMxNTIwNX0.0ndDO1K8c_WnP3FQumSCoWf-XGlBsrBfJXlCNMplGSE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log(`[PCP Architecture] Conectado a: ${SUPABASE_URL}`);
if (!TUNNEL_URL) {
  console.warn("Trabajando en modo NUBE. Para modo LOCAL, ejecuta: localStorage.setItem('PCP_TUNNEL_URL', 'https://tu-tunel.loca.lt') y recarga.");
}
