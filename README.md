# Asesor IA Isapre

Sistema de asesoría de isapres: los anuncios llevan a WhatsApp, Instagram o Messenger; la IA (Grok) conversa, arma el perfil de cada persona y agenda la llamada; el agente de voz recibe todo; tú ves y controlas todo en la app.

## Qué incluye
- **App humana** (`/`): bandeja de contactos con perfil completo, conversación, control IA/humano, cotización, llamadas y métricas por etapa.
- **Webhook de Meta** (`/api/webhooks/meta`): recibe WhatsApp Cloud API, Messenger e Instagram. Crea una ficha por número o usuario, guarda de qué anuncio vino y responde con IA.
- **Eventos para Meta Ads** (Conversions API): LeadSubmitted al primer mensaje, QualifiedLead al calificar, Purchase al cerrar.
- **API REST** (`/api/v1/<herramienta>`) y **servidor MCP** (`/api/mcp`) con las mismas herramientas para agentes.
- **Agente de voz**: `briefing_llamada` entrega las instrucciones listas para Grok Voice con todo lo que juntó el chat; `registrar_llamada` guarda el resultado.

## Puesta en marcha
1. **Supabase**: proyecto nuevo, ejecutar `supabase/schema.sql` en el SQL Editor. Crear tu usuario en Authentication y luego:
   `insert into profiles (id, nombre, rol) values ('<id del usuario>', 'Rafael', 'admin');`
2. **Vercel**: importar el repo y cargar las variables de `.env.example`.
3. **Meta (developers.facebook.com)**: una app de tipo Business con los productos WhatsApp, Messenger e Instagram.
   - Webhook: `https://<tu-dominio>/api/webhooks/meta` con el `META_VERIFY_TOKEN` que inventes.
   - Suscribir: WhatsApp `messages`; Página `messages`, `messaging_referrals`; Instagram `messages`.
   - Tokens permanentes de sistema para WhatsApp y la página.
4. **xAI**: crear la API key y ponerla en `XAI_API_KEY`.
5. **Conversions API**: en Events Manager crea o elige el dataset y genera el token (`META_DATASET_ID`, `META_CAPI_TOKEN`).

## Conectar un agente por MCP
URL: `https://<tu-dominio>/api/mcp` · Header: `Authorization: Bearer <AGENT_API_KEY>`

Herramientas: listar_contactos, ver_contacto, actualizar_contacto, enviar_mensaje, sugerir_respuesta, briefing_llamada, registrar_llamada, llamadas_pendientes, metricas.

## API REST
`POST /api/v1/<herramienta>` con el mismo header y los argumentos en JSON. `GET /api/v1` lista todo.

## Reglas que el sistema respeta
- La IA nunca niega ser IA si se lo preguntan y no inventa precios.
- Si alguien pide no ser contactado (opt_out), no se le vuelve a escribir.
- WhatsApp solo permite mensajes libres dentro de 24 h desde el último mensaje del cliente.
- Leads de formularios de Meta: `POST /api/leads` con header `x-api-key: <AGENT_API_KEY>` (compatible con Make).
