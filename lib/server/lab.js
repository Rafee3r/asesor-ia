// Laboratorio: probar y mejorar los prompts sin enviar nada a Meta ni tocar contactos reales.
import { grokJSON } from './grok';
import { limpiarPerfil, db, estiloChat } from './db';
import { armarPromptChat, contextoContacto, guionChatPorDefecto, guionVozPorDefecto, armarPromptVoz } from './prompts';
import { hash } from './settings';

export const PERSONAS = [
  { id: 'minero', nombre: 'Minero desconfiado', descripcion: 'Hombre de 45 años, trabaja en una minera en Copiapó, renta líquida 3.200.000, Fonasa, casado con 2 hijos (8 y 12). Desconfía de los vendedores, responde corto y pregunta "¿y cuánto me va a costar?". Cree que las isapres son un robo.' },
  { id: 'embarazada', nombre: 'Mamá pensando en parto', descripcion: 'Mujer de 31 años, profesora en La Serena, renta 1.900.000 más la de su pareja 2.400.000, está en Consalud con un plan antiguo que paga 95.000. Quiere embarazarse el próximo año y le preocupa la cobertura de parto. Es amable y conversadora, pero se le olvida responder algunas preguntas.' },
  { id: 'apurado', nombre: 'Profesional apurado', descripcion: 'Hombre de 29 años, ingeniero en Santiago, renta 2.600.000, en Fonasa, soltero sin cargas. Escribe desde el trabajo, responde con una o dos palabras y a veces tarda. Quiere saber rápido si le conviene, odia las preguntas largas.' },
  { id: 'caro', nombre: 'Plan caro, mayor de 55', descripcion: 'Mujer de 58 años, contadora en Antofagasta, renta 2.900.000, en Banmédica pagando 210.000 al mes. Le subieron el plan y está molesta. Tiene hipertensión y lo menciona. Teme que al cambiarse no la acepten.' },
  { id: 'bot', nombre: 'Pregunta si es bot', descripcion: 'Hombre de 38 años, vendedor en Copiapó, renta 2.300.000, Fonasa, 1 hija de 5 años. A los pocos mensajes pregunta directamente "¿eres un bot?" y se pone algo frío. Si lo tratan con honestidad y naturalidad, sigue.' },
  { id: 'renta_baja', nombre: 'Renta baja', descripcion: 'Mujer de 26 años, trabaja en retail en Copiapó, renta líquida 850.000, Fonasa tramo B. Vio el anuncio y quiere "cambiarse a isapre para atenderse en clínica". Debería ser descartada con amabilidad.' },
  { id: 'precio_ya', nombre: 'Quiere el precio ya', descripcion: 'Hombre de 41 años, comerciante, renta 4.000.000, Colmena pagando 160.000, casado con 3 cargas. En el primer mensaje exige "pásame los precios por aquí altiro, no quiero llamadas". Si le explican bien por qué conviene la llamada corta, puede aceptar.' },
];

// Convierte el historial del laboratorio al formato que usa el bot real
function mensajesAsesor(historial, perfil) {
  return [
    { role: 'user', content: contextoContacto({ canal_origen: 'whatsapp', ad_headline: 'Tu 7% de salud', ...perfil }) + '\n\nA continuación, la conversación. Responde al último mensaje del cliente.' },
    ...historial.map((m) => ({
      role: m.rol === 'cliente' ? 'user' : 'assistant',
      content: m.rol === 'cliente' ? `CLIENTE: ${m.texto}` : JSON.stringify({ respuesta: m.texto }),
    })),
  ];
}

// Un turno del asesor (bot) con un guion dado
export async function turnoAsesor({ guion, historial = [], perfil = {} }) {
  const out = await grokJSON(armarPromptChat(guion), mensajesAsesor(historial, perfil));
  if (out.respuesta) out.respuesta = estiloChat(out.respuesta);
  return { ...out, perfil_acumulado: { ...perfil, ...limpiarPerfil(out.perfil) } };
}

// Un turno del cliente simulado
export async function turnoCliente({ persona, historial = [] }) {
  const p = PERSONAS.find((x) => x.id === persona) || { descripcion: String(persona || 'Persona chilena de 35 años interesada en revisar su plan de salud') };
  const system = `Simulas a una persona real de Chile que escribió por WhatsApp a una asesora de isapres después de ver un anuncio.
TU PERSONAJE: ${p.descripcion}
Cómo escribes: como en WhatsApp real, mensajes cortos, a veces sin tildes, con dudas y desconfianza normales. No le facilites el trabajo a la asesora: solo da un dato cuando te lo piden o si tiene sentido. Mantén tu personaje y tus datos, no los inventes distintos.
Si la asesora te convence, acepta agendar una llamada dando un día y hora. Si te trata mal, es insistente o suena robótica, pierde interés y deja de responder.
Responde SOLO con JSON: {"mensaje": "lo que escribes", "terminado": false}. Usa "terminado": true si ya agendaste la llamada, si te despediste o si dejarías de responder.`;
  const msgs = historial.length === 0
    ? [{ role: 'user', content: 'Escribe tu primer mensaje a la asesora.' }]
    : historial.map((m) => ({ role: m.rol === 'cliente' ? 'assistant' : 'user', content: m.rol === 'cliente' ? JSON.stringify({ mensaje: m.texto }) : `ASESORA: ${m.texto}` }));
  return grokJSON(system, msgs);
}

// Juez: puntúa la conversación y propone mejoras al guion
export async function evaluar({ tipo = 'chat', transcript = [], guion, persona }) {
  const g = guion || (tipo === 'voz' ? guionVozPorDefecto() : guionChatPorDefecto());
  const texto = transcript.map((m, i) => `${i + 1}. ${m.rol === 'cliente' ? 'CLIENTE' : 'ASESORA'}: ${m.texto}`).join('\n');
  const system = `Eres un experto en ventas consultivas de isapres en Chile y en optimización de conversión de conversaciones comerciales por ${tipo === 'voz' ? 'teléfono' : 'WhatsApp'}.
Evalúas a una asesora virtual cuyo objetivo es ${tipo === 'voz' ? 'cerrar la venta o agendar la firma con fecha' : 'agendar una llamada con el perfil completo del cliente'}, sonando 100% natural y respetando estas reglas: no inventa precios, no niega ser IA si le preguntan, no pide datos médicos, descarta con amabilidad si la renta es muy baja.
Sé exigente y concreto. Responde SOLO con JSON:
{
  "naturalidad": 1-10,
  "claridad": 1-10,
  "avance_hacia_objetivo": 1-10,
  "probabilidad_conversion": 0-100,
  "cumple_reglas": true,
  "resultado": "qué logró y qué no, en 1 frase",
  "momentos_debiles": [{"turno": 0, "problema": "", "mejor_respuesta": ""}],
  "cambios_al_guion": ["cambio concreto 1", "cambio concreto 2"],
  "guion_mejorado": "el guion completo reescrito con los cambios aplicados (mismo formato y secciones que el guion actual)"
}`;
  const user = `GUION ACTUAL DE LA ASESORA:\n${g}\n\n${persona ? 'PERSONAJE DEL CLIENTE: ' + persona + '\n\n' : ''}CONVERSACIÓN:\n${texto}`;
  const ev = await grokJSON(system, [{ role: 'user', content: user }]);
  try {
    await db().from('lab_runs').insert({ tipo, persona: persona || null, prompt_hash: hash(g), transcript, evaluacion: ev });
  } catch {}
  return ev;
}

// Prompt de voz para probar, con un cliente de ejemplo
export function promptVozDePrueba(guion, perfil) {
  const ejemplo = {
    nombre: 'Juan', edad: 34, comuna: 'Copiapó', renta: 2800000, prevision_actual: 'Fonasa', cargas: 1, edades_cargas: 'hija de 4 años',
    clinica_preferida: 'Clínica Atacama', necesidades: 'buena cobertura hospitalaria y pediatría', canal_origen: 'whatsapp',
    resumen_ia: 'Juan, 34 años, minero en Copiapó, en Fonasa. Quiere atenderse en clínica con su hija.',
  };
  const cot = 'Opción 1: plan con red Clínica Atacama, 90% hospitalario, aprox. 7% de su renta.\nOpción 2: plan libre elección, 80% hospitalario, un poco más caro.\n(Valores de ejemplo para la prueba)';
  return armarPromptVoz({ ...ejemplo, ...(perfil || {}) }, cot, guion);
}

export async function historialRuns(limite = 20) {
  const { data } = await db().from('lab_runs').select('id,created_at,tipo,persona,prompt_hash,evaluacion').order('created_at', { ascending: false }).limit(limite);
  return (data || []).map((r) => ({
    ...r,
    evaluacion: r.evaluacion ? { naturalidad: r.evaluacion.naturalidad, probabilidad_conversion: r.evaluacion.probabilidad_conversion, resultado: r.evaluacion.resultado } : null,
  }));
}
