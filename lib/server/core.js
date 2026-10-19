// Logica central: la usan los webhooks, la API REST y el servidor MCP.
import { db, ETAPAS, limpiarPerfil } from './db';
import { enviar, enviarEventoMeta } from './meta';
import { grokJSON } from './grok';
import { promptChat, contextoContacto, promptVoz } from './prompts';

const CAMPO_ID = { whatsapp: 'wa_id', instagram: 'ig_id', messenger: 'fb_id' };
const EVENTO_POR_ETAPA = { Calificado: 'QualifiedLead', Cerrado: 'Purchase' };
const ETAPAS_IA = new Set(['Nuevo', 'En conversacion', 'Calificado', 'Llamada agendada', 'Descartado']);
const VENTANA_WA_MS = 24 * 3600 * 1000;

// ---------- Contactos ----------

export async function buscarOCrearContacto({ canal, externalId, nombre, referral }) {
  const campo = CAMPO_ID[canal];
  const { data: existe } = await db().from('contacts').select('*').eq(campo, externalId).maybeSingle();
  if (existe) {
    // Llego por formulario y ahora escribe por un canal de mensajes: ese pasa a ser su canal
    if (['formulario', 'manual'].includes(existe.canal_origen)) {
      const { data } = await db().from('contacts').update({ canal_origen: canal, nombre: existe.nombre || nombre || null }).eq('id', existe.id).select().single();
      return { contacto: data, nuevo: false };
    }
    // Si vuelve a entrar desde otro anuncio, guardamos el ultimo
    if (referral?.ad_id && referral.ad_id !== existe.ad_id) {
      const { data } = await db().from('contacts').update({
        ad_id: referral.ad_id, ad_headline: referral.headline || null,
        ctwa_clid: referral.ctwa_clid || existe.ctwa_clid, fuente_url: referral.url || null,
      }).eq('id', existe.id).select().single();
      return { contacto: data, nuevo: false };
    }
    return { contacto: existe, nuevo: false };
  }

  const { data: primerAdmin } = await db().from('profiles').select('id').eq('rol', 'admin').order('created_at').limit(1);
  const fila = {
    [campo]: externalId,
    canal_origen: canal,
    nombre: nombre || null,
    telefono: canal === 'whatsapp' ? externalId : null,
    ad_id: referral?.ad_id || null,
    ad_headline: referral?.headline || null,
    ctwa_clid: referral?.ctwa_clid || null,
    fuente_url: referral?.url || null,
    consentimiento: true, // escribio por iniciativa propia
    asignado_a: primerAdmin?.[0]?.id || null,
  };
  const { data, error } = await db().from('contacts').insert(fila).select().single();
  if (error) {
    // Carrera: dos mensajes del mismo contacto a la vez
    const { data: otro } = await db().from('contacts').select('*').eq(campo, externalId).single();
    return { contacto: otro, nuevo: false };
  }
  await registrarEvento(data, 'LeadSubmitted', canal);
  return { contacto: data, nuevo: true };
}

export async function obtenerContacto(id) {
  const { data, error } = await db().from('contacts').select('*').eq('id', id).single();
  if (error) throw new Error('Contacto no encontrado');
  return data;
}

export async function listarContactos({ etapa, buscar, limite = 50 } = {}) {
  let q = db().from('contacts').select('id,nombre,telefono,canal_origen,etapa,temperatura,renta,edad,prevision_actual,comuna,resumen_ia,proximo_paso,llamada_programada_at,ia_activa,last_message_at,ad_id')
    .order('last_message_at', { ascending: false, nullsFirst: false }).limit(Math.min(limite, 200));
  if (etapa) q = q.eq('etapa', etapa);
  if (buscar) q = q.or(`nombre.ilike.%${buscar}%,telefono.ilike.%${buscar}%,comuna.ilike.%${buscar}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function historial(contactId, limite = 40) {
  const { data } = await db().from('messages').select('created_at,canal,direccion,autor,texto')
    .eq('contact_id', contactId).order('created_at', { ascending: false }).limit(limite);
  return (data || []).reverse();
}

export async function actualizarContacto(id, cambios) {
  const permitidos = ['nombre', 'telefono', 'email', 'edad', 'renta', 'cargas', 'edades_cargas', 'comuna', 'region',
    'prevision_actual', 'plan_actual', 'costo_plan_actual', 'clinica_preferida', 'necesidades', 'horario_llamada',
    'llamada_programada_at', 'etapa', 'motivo_descarte', 'temperatura', 'proximo_paso', 'ia_activa', 'notas', 'asignado_a', 'opt_out',
    'resumen_ia', 'cotizacion'];
  const fila = {};
  for (const k of permitidos) if (k in cambios) fila[k] = cambios[k];
  if (fila.etapa && !ETAPAS.includes(fila.etapa)) throw new Error('Etapa invalida: ' + fila.etapa);

  const antes = await obtenerContacto(id);
  const { data, error } = await db().from('contacts').update(fila).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  if (fila.etapa && fila.etapa !== antes.etapa && EVENTO_POR_ETAPA[fila.etapa]) {
    await registrarEvento(data, EVENTO_POR_ETAPA[fila.etapa], data.canal_origen, cambios.valor_venta);
  }
  return data;
}

// ---------- Mensajes ----------

async function guardarMensaje(fila) {
  const { data, error } = await db().from('messages').insert(fila).select().single();
  if (error) {
    if (error.code === '23505') return null; // duplicado (Meta reintento)
    throw new Error(error.message);
  }
  return data;
}

// Envia un mensaje (humano, agente o IA) por el canal del contacto y lo guarda
export async function enviarMensaje(contacto, texto, autor = 'humano') {
  const canal = contacto.canal_origen;
  if (!['whatsapp', 'instagram', 'messenger'].includes(canal)) throw new Error('El contacto no tiene canal de mensajes');
  if (contacto.opt_out) throw new Error('El contacto pidió no ser contactado');
  const ultimo = contacto.last_inbound_at ? new Date(contacto.last_inbound_at).getTime() : 0;
  if (Date.now() - ultimo > VENTANA_WA_MS) {
    throw new Error('Pasaron más de 24 h desde su último mensaje: Meta solo permite plantillas aprobadas');
  }
  const r = await enviar(contacto, canal, texto);
  const metaId = r?.messages?.[0]?.id || r?.message_id || null;
  await guardarMensaje({ contact_id: contacto.id, canal, direccion: 'saliente', autor, texto, meta_message_id: metaId });
  await db().from('contacts').update({ last_message_at: new Date().toISOString() }).eq('id', contacto.id);
  return { ok: true, meta_message_id: metaId };
}

// Punto de entrada de cada mensaje que llega desde Meta
export async function procesarEntrante({ canal, externalId, nombre, texto, metaMessageId, referral, raw }) {
  const { contacto } = await buscarOCrearContacto({ canal, externalId, nombre, referral });
  const msg = await guardarMensaje({
    contact_id: contacto.id, canal, direccion: 'entrante', autor: 'cliente',
    texto: texto || '[mensaje sin texto]', meta_message_id: metaMessageId || null, raw: raw || null,
  });
  if (!msg) return { duplicado: true };

  const ahora = new Date().toISOString();
  const cambios = { last_inbound_at: ahora, last_message_at: ahora };
  if (contacto.etapa === 'Nuevo') cambios.etapa = 'En conversacion';
  if (contacto.etapa === 'No responde') cambios.etapa = 'En conversacion';
  await db().from('contacts').update(cambios).eq('id', contacto.id);

  const fresco = await obtenerContacto(contacto.id);
  if (!fresco.ia_activa || fresco.opt_out || !process.env.XAI_API_KEY) return { contacto: fresco.id, ia: false };
  return responderConIA(fresco);
}

// ---------- Agente IA de mensajes ----------

export async function responderConIA(contacto, { enviarRespuesta = true } = {}) {
  const hist = await historial(contacto.id, 30);
  const mensajes = [
    { role: 'user', content: contextoContacto(contacto) + '\n\nA continuación, la conversación. Responde al último mensaje del cliente.' },
    ...hist.filter((m) => m.texto).map((m) => ({
      role: m.direccion === 'entrante' ? 'user' : 'assistant',
      content: m.direccion === 'entrante' ? `CLIENTE: ${m.texto}` : JSON.stringify({ respuesta: m.texto }),
    })),
  ];

  const out = await grokJSON(await promptChat(), mensajes);

  // Aplicar lo que devolvio la IA
  const cambios = { ...limpiarPerfil(out.perfil) };
  if (out.resumen) cambios.resumen_ia = String(out.resumen).slice(0, 600);
  if (out.proximo_paso) cambios.proximo_paso = String(out.proximo_paso).slice(0, 300);
  if (['frio', 'tibio', 'caliente'].includes(out.temperatura)) cambios.temperatura = out.temperatura;
  if (out.llamada_iso && !Number.isNaN(Date.parse(out.llamada_iso))) cambios.llamada_programada_at = new Date(out.llamada_iso).toISOString();
  if (out.opt_out) { cambios.opt_out = true; cambios.ia_activa = false; cambios.etapa = 'Descartado'; cambios.motivo_descarte = 'Pidió no ser contactado'; }
  if (out.escalar_humano) { cambios.ia_activa = false; cambios.proximo_paso = 'Revisar: la IA pidió que lo tome un humano'; }

  // La IA solo mueve hacia adelante (o a Descartado) y solo en sus etapas
  if (!cambios.etapa && ETAPAS_IA.has(out.etapa) && ETAPAS_IA.has(contacto.etapa)) {
    const avanza = ETAPAS.indexOf(out.etapa) > ETAPAS.indexOf(contacto.etapa);
    if (out.etapa === 'Descartado' || avanza) cambios.etapa = out.etapa;
    if (out.etapa === 'Descartado' && out.motivo_descarte) cambios.motivo_descarte = String(out.motivo_descarte).slice(0, 300);
  }

  let actualizado = contacto;
  if (Object.keys(cambios).length) actualizado = await actualizarContacto(contacto.id, cambios);

  // Si se agendo la llamada, crear el registro para el agente de voz
  if (cambios.etapa === 'Llamada agendada') {
    await db().from('calls').insert({ contact_id: contacto.id, programada_at: cambios.llamada_programada_at || actualizado.llamada_programada_at || null });
  }

  let enviado = null;
  if (enviarRespuesta && out.respuesta) {
    enviado = await enviarMensaje({ ...actualizado, opt_out: false }, String(out.respuesta), 'ia');
  }
  return { contacto: contacto.id, respuesta: out.respuesta || null, etapa: actualizado.etapa, enviado: !!enviado };
}

// ---------- Llamadas (agente de voz) ----------

export async function briefingLlamada(contactId) {
  const c = await obtenerContacto(contactId);
  const hist = await historial(contactId, 60);
  const { data: llamadas } = await db().from('calls').select('*').eq('contact_id', contactId).order('created_at', { ascending: false });
  return {
    contacto: c,
    telefono: c.telefono,
    instrucciones_voz: await promptVoz(c, c.cotizacion),
    conversacion: hist,
    llamadas: llamadas || [],
  };
}

export async function registrarResultadoLlamada(contactId, { estado = 'completada', resultado, resumen, transcripcion, duracion_seg, grabacion_url, nueva_etapa, firma_iso }) {
  const { data: pendiente } = await db().from('calls').select('id').eq('contact_id', contactId)
    .in('estado', ['programada', 'en_curso']).order('created_at', { ascending: false }).limit(1);
  const fila = { estado, resultado, resumen, transcripcion, duracion_seg, grabacion_url };
  if (pendiente?.[0]) await db().from('calls').update(fila).eq('id', pendiente[0].id);
  else await db().from('calls').insert({ contact_id: contactId, ...fila });

  if (resumen) {
    await guardarMensaje({ contact_id: contactId, canal: 'llamada', direccion: 'saliente', autor: 'ia', texto: `Resumen de llamada: ${resumen}` });
  }
  const cambios = { etapa: nueva_etapa || (estado === 'completada' ? 'Llamada hecha' : undefined) };
  if (firma_iso) { cambios.etapa = 'Firma agendada'; cambios.proximo_paso = `Firma con el cliente: ${firma_iso}`; }
  if (estado === 'no_contesto') cambios.proximo_paso = 'No contestó la llamada: reintentar';
  Object.keys(cambios).forEach((k) => cambios[k] === undefined && delete cambios[k]);
  return Object.keys(cambios).length ? actualizarContacto(contactId, cambios) : obtenerContacto(contactId);
}

// ---------- Eventos para Meta ----------

export async function registrarEvento(contacto, nombre, canal, valor) {
  let respuesta = null;
  let enviado = false;
  try {
    respuesta = await enviarEventoMeta(contacto, nombre, canal || contacto.canal_origen, valor);
    enviado = !respuesta?.omitido;
  } catch (e) {
    respuesta = { error: String(e.message || e) };
  }
  await db().from('events').insert({ contact_id: contacto.id, nombre, enviado_meta: enviado, respuesta_meta: respuesta });
}

// ---------- Metricas ----------

export async function metricas() {
  const { data } = await db().from('contacts').select('etapa,canal_origen,ad_id,created_at');
  const porEtapa = {};
  const porAnuncio = {};
  for (const c of data || []) {
    porEtapa[c.etapa] = (porEtapa[c.etapa] || 0) + 1;
    const k = c.ad_id || 'sin anuncio';
    porAnuncio[k] = porAnuncio[k] || { total: 0, calificados: 0, cerrados: 0 };
    porAnuncio[k].total++;
    if (['Calificado', 'Llamada agendada', 'Llamada hecha', 'Firma agendada', 'Cerrado'].includes(c.etapa)) porAnuncio[k].calificados++;
    if (c.etapa === 'Cerrado') porAnuncio[k].cerrados++;
  }
  return { total: data?.length || 0, por_etapa: porEtapa, por_anuncio: porAnuncio };
}
