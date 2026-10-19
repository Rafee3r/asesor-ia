import crypto from 'crypto';

const V = () => process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = () => `https://graph.facebook.com/${V()}`;

async function post(url, body, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// Verifica que el webhook venga de Meta (header X-Hub-Signature-256)
export function firmaValida(rawBody, header) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true; // sin secreto configurado no se valida (solo para pruebas)
  if (!header) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Envio de mensajes ----------

export async function enviarWhatsApp(waId, texto) {
  return post(`${GRAPH()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to: waId,
    type: 'text',
    text: { body: texto, preview_url: false },
  }, process.env.WHATSAPP_TOKEN);
}

// Instagram (conectado a la pagina) y Messenger usan la misma Send API con el token de la pagina
export async function enviarMessengerOInstagram(canal, recipientId, texto) {
  return post(`${GRAPH()}/${process.env.FB_PAGE_ID}/messages`, {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: { text: texto },
  }, process.env.FB_PAGE_TOKEN);
}

export async function enviar(contacto, canal, texto) {
  if (canal === 'whatsapp') return enviarWhatsApp(contacto.wa_id, texto);
  if (canal === 'instagram') return enviarMessengerOInstagram('instagram', contacto.ig_id, texto);
  if (canal === 'messenger') return enviarMessengerOInstagram('messenger', contacto.fb_id, texto);
  throw new Error('Canal sin envio: ' + canal);
}

// ---------- Conversions API (eventos para optimizar anuncios) ----------
// Nombres permitidos para business messaging: LeadSubmitted, QualifiedLead, Purchase, etc.

const sha = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

export async function enviarEventoMeta(contacto, eventName, canal, valor) {
  const dataset = process.env.META_DATASET_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!dataset || !token) return { omitido: 'Falta META_DATASET_ID o META_CAPI_TOKEN' };

  let user_data;
  if (canal === 'whatsapp') {
    user_data = { whatsapp_business_account_id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID };
    if (contacto.ctwa_clid) user_data.ctwa_clid = contacto.ctwa_clid;
    else {
      user_data.page_id = process.env.FB_PAGE_ID;
      user_data.ph = [sha(contacto.wa_id)];
    }
  } else if (canal === 'messenger') {
    user_data = { page_id: process.env.FB_PAGE_ID, page_scoped_user_id: contacto.fb_id };
  } else if (canal === 'instagram') {
    user_data = { instagram_business_account_id: process.env.INSTAGRAM_ACCOUNT_ID, ig_sid: contacto.ig_id };
  } else {
    return { omitido: 'Canal sin atribucion' };
  }

  const evento = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'business_messaging',
    messaging_channel: canal,
    user_data,
  };
  if (valor) evento.custom_data = { currency: 'CLP', value: valor };

  return post(`${GRAPH()}/${dataset}/events`, { data: [evento] }, token);
}
