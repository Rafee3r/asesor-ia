// Herramientas para agentes: las mismas se exponen por REST (/api/v1/<herramienta>) y por MCP (/api/mcp).
import * as core from './core';
import { ETAPAS } from './db';

const id = { type: 'string', description: 'ID del contacto (uuid)' };

export const TOOLS = [
  {
    name: 'listar_contactos',
    description: 'Lista contactos ordenados por el mensaje más reciente. Filtra por etapa o busca por nombre, teléfono o comuna.',
    inputSchema: {
      type: 'object',
      properties: {
        etapa: { type: 'string', enum: ETAPAS },
        buscar: { type: 'string' },
        limite: { type: 'number', description: 'Máximo 200, por defecto 50' },
      },
    },
    run: (a) => core.listarContactos(a),
  },
  {
    name: 'ver_contacto',
    description: 'Perfil completo de un contacto con su conversación reciente y llamadas.',
    inputSchema: { type: 'object', properties: { contact_id: id }, required: ['contact_id'] },
    run: async ({ contact_id }) => {
      const b = await core.briefingLlamada(contact_id);
      return { contacto: b.contacto, conversacion: b.conversacion, llamadas: b.llamadas };
    },
  },
  {
    name: 'actualizar_contacto',
    description: 'Cambia datos del perfil, la etapa, la cotización o activa/desactiva la IA. Pasar a etapa Cerrado envía el evento de compra a Meta (usa valor_venta en pesos si lo sabes).',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: id,
        cambios: {
          type: 'object',
          description: 'Campos a cambiar: nombre, telefono, email, edad, renta, cargas, edades_cargas, comuna, region, prevision_actual, plan_actual, costo_plan_actual, clinica_preferida, necesidades, horario_llamada, llamada_programada_at, etapa, motivo_descarte, temperatura, proximo_paso, ia_activa, notas, cotizacion, valor_venta',
        },
      },
      required: ['contact_id', 'cambios'],
    },
    run: ({ contact_id, cambios }) => core.actualizarContacto(contact_id, cambios || {}),
  },
  {
    name: 'enviar_mensaje',
    description: 'Envía un mensaje al contacto por su canal (WhatsApp, Instagram o Messenger). Solo funciona dentro de 24 h desde su último mensaje.',
    inputSchema: {
      type: 'object',
      properties: { contact_id: id, texto: { type: 'string' }, autor: { type: 'string', enum: ['humano', 'ia'] } },
      required: ['contact_id', 'texto'],
    },
    run: async ({ contact_id, texto, autor }) => core.enviarMensaje(await core.obtenerContacto(contact_id), texto, autor || 'humano'),
  },
  {
    name: 'sugerir_respuesta',
    description: 'Pide a la IA la siguiente respuesta para el contacto sin enviarla (para revisarla antes).',
    inputSchema: { type: 'object', properties: { contact_id: id }, required: ['contact_id'] },
    run: async ({ contact_id }) => core.responderConIA(await core.obtenerContacto(contact_id), { enviarRespuesta: false }),
  },
  {
    name: 'briefing_llamada',
    description: 'Todo lo necesario para la llamada del agente de voz: perfil, instrucciones de voz listas para Grok Voice, conversación y llamadas previas.',
    inputSchema: { type: 'object', properties: { contact_id: id }, required: ['contact_id'] },
    run: ({ contact_id }) => core.briefingLlamada(contact_id),
  },
  {
    name: 'registrar_llamada',
    description: 'Guarda el resultado de una llamada del agente de voz y avanza la etapa.',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: id,
        estado: { type: 'string', enum: ['completada', 'no_contesto', 'fallida', 'cancelada'] },
        resultado: { type: 'string', description: 'cerrado, interesado, objecion, no interesado...' },
        resumen: { type: 'string' },
        transcripcion: { type: 'string' },
        duracion_seg: { type: 'number' },
        grabacion_url: { type: 'string' },
        nueva_etapa: { type: 'string', enum: ETAPAS },
        firma_iso: { type: 'string', description: 'Fecha y hora acordada para la firma, ISO 8601' },
      },
      required: ['contact_id', 'estado'],
    },
    run: ({ contact_id, ...r }) => core.registrarResultadoLlamada(contact_id, r),
  },
  {
    name: 'llamadas_pendientes',
    description: 'Contactos con llamada agendada, ordenados por hora.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const lista = await core.listarContactos({ etapa: 'Llamada agendada', limite: 200 });
      return lista.sort((a, b) => String(a.llamada_programada_at).localeCompare(String(b.llamada_programada_at)));
    },
  },
  {
    name: 'metricas',
    description: 'Totales por etapa y por anuncio (contactos, calificados y cerrados) para optimizar Meta Ads.',
    inputSchema: { type: 'object', properties: {} },
    run: () => core.metricas(),
  },
];

export async function ejecutar(nombre, args = {}) {
  const t = TOOLS.find((x) => x.name === nombre);
  if (!t) throw new Error('Herramienta no existe: ' + nombre);
  for (const r of t.inputSchema.required || []) {
    if (args[r] === undefined || args[r] === null || args[r] === '') throw new Error(`Falta el parámetro ${r}`);
  }
  return t.run(args);
}
