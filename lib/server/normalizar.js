// Convierte los payloads de webhooks de Meta (WhatsApp, Messenger, Instagram) en mensajes normalizados

// Texto legible de cualquier tipo de mensaje de WhatsApp
function textoWhatsApp(m) {
  if (m.type === 'text') return m.text?.body;
  if (m.type === 'button') return m.button?.text;
  if (m.type === 'interactive') return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
  if (m.type === 'image') return m.image?.caption ? `[imagen] ${m.image.caption}` : '[imagen]';
  if (m.type === 'audio') return '[audio: pídele que lo escriba]';
  if (m.type === 'document') return '[documento]';
  if (m.type === 'location') return '[ubicación]';
  return `[${m.type}]`;
}

// Convierte el payload de Meta en una lista de mensajes normalizados
export function normalizar(body) {
  const out = [];
  if (body.object === 'whatsapp_business_account') {
    for (const e of body.entry || []) {
      for (const ch of e.changes || []) {
        const v = ch.value || {};
        const nombres = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of v.messages || []) {
          const ref = m.referral;
          out.push({
            canal: 'whatsapp',
            externalId: m.from,
            nombre: nombres[m.from],
            texto: textoWhatsApp(m),
            metaMessageId: m.id,
            referral: ref ? { ad_id: ref.source_id, headline: ref.headline || ref.body, ctwa_clid: ref.ctwa_clid, url: ref.source_url } : null,
            raw: m,
          });
        }
      }
    }
  } else if (body.object === 'page' || body.object === 'instagram') {
    const canal = body.object === 'page' ? 'messenger' : 'instagram';
    for (const e of body.entry || []) {
      for (const ev of e.messaging || []) {
        if (!ev.message || ev.message.is_echo) continue;
        if (ev.sender?.id === e.id) continue; // mensajes de la propia cuenta
        const ref = ev.referral || ev.message?.referral;
        const adjunto = ev.message.attachments?.length ? `[${ev.message.attachments[0].type}]` : null;
        out.push({
          canal,
          externalId: ev.sender.id,
          nombre: null,
          texto: ev.message.text || adjunto || '[mensaje]',
          metaMessageId: ev.message.mid,
          referral: ref ? { ad_id: ref.ad_id, headline: ref.ads_context_data?.ad_title, url: null } : null,
          raw: ev,
        });
      }
    }
  }
  return out;
}

