import { createClient } from '@supabase/supabase-js';

// Cliente con service role: solo para codigo de servidor (webhooks, API, MCP).
let admin;
export function db() {
  if (!admin) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return admin;
}

export const ETAPAS = [
  'Nuevo', 'En conversacion', 'Calificado', 'Llamada agendada', 'Llamada hecha',
  'Firma agendada', 'Cerrado', 'No responde', 'Descartado',
];

// Campos del perfil que el bot puede completar
export const CAMPOS_PERFIL = [
  'nombre', 'telefono', 'email', 'edad', 'renta', 'cargas', 'edades_cargas', 'comuna', 'region',
  'prevision_actual', 'plan_actual', 'costo_plan_actual', 'clinica_preferida', 'necesidades',
  'preexistencias_mencionadas', 'horario_llamada',
];

const NUMERICOS = new Set(['edad', 'renta', 'cargas', 'costo_plan_actual']);

// Limpia lo que devuelve la IA antes de guardarlo
export function limpiarPerfil(p = {}) {
  const out = {};
  for (const k of CAMPOS_PERFIL) {
    let v = p[k];
    if (v === undefined || v === null || v === '') continue;
    if (NUMERICOS.has(k)) {
      const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(n)) continue;
      if (n === 0 && k !== 'cargas') continue; // 0 en edad o renta = dato no informado
      v = n;
    } else if (k === 'preexistencias_mencionadas') {
      if (!(v === true || v === 'true' || v === 'si' || v === 'sí')) continue; // solo se guarda si lo menciono
      v = true;
    } else {
      v = String(v).slice(0, 500);
    }
    out[k] = v;
  }
  return out;
}

export function soloDigitos(tel) {
  return String(tel || '').replace(/\D/g, '');
}

// Estilo WhatsApp chileno: sin signos de apertura y con la puntuación relajada de una persona real
export function estiloChat(t, azar = Math.random) {
  let s = String(t || '').replace(/[¿¡]/g, '').replace(/ {2,}/g, ' ').trim();
  // A veces empieza con minúscula (no si es una sigla como GES o una palabra en mayúsculas)
  if (azar() < 0.35 && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(s)) s = s[0].toLowerCase() + s.slice(1);
  // Casi nunca cierra con punto final
  if (azar() < 0.7) s = s.replace(/\.(\s*)$/, '$1');
  // A veces se salta la coma después del saludo ("hola Camila" en vez de "Hola, Camila")
  if (azar() < 0.5) s = s.replace(/^(hola|ya|ok|perfecto|claro|dale|genial|buenísimo|gracias),\s/i, '$1 ');
  return s.trim();
}
