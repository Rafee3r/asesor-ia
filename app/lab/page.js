'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase';

async function labApi(accion, args) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) { window.location.href = '/login'; throw new Error('Inicia sesión'); }
  const r = await fetch(`/api/lab/${accion}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(args || {}),
  });
  const j = await r.json().catch(() => ({ ok: false, error: 'Respuesta inválida del servidor' }));
  if (!j.ok) throw new Error(j.error || 'Error');
  return j.data;
}

export default function Lab() {
  const [tab, setTab] = useState('chat');
  const [prompts, setPrompts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    labApi('prompts').then(setPrompts).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="wrap">
      <div className="top">
        <h1>Laboratorio <span className="muted">· prueba y mejora los guiones sin tocar clientes reales</span></h1>
        <a className="btn" href="/">Volver a la bandeja</a>
      </div>
      <div className="tabs">
        {[['chat', 'Chat (WhatsApp)'], ['voz', 'Voz en vivo'], ['historial', 'Historial de pruebas']].map(([k, t]) => (
          <span key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}</span>
        ))}
      </div>
      {error && <div className="err">{error}</div>}
      {!prompts && !error && <small className="muted">Cargando guiones…</small>}
      {prompts && tab === 'chat' && <LabChat inicial={prompts.chat} />}
      {prompts && tab === 'voz' && <LabVoz inicial={prompts.voz} />}
      {tab === 'historial' && <Historial />}
    </div>
  );
}

// ---------- Editor de guion (compartido) ----------

function Editor({ tipo, guion, setGuion, info, onGuardado }) {
  const [estado, setEstado] = useState('');
  const [nota, setNota] = useState('');
  async function guardar() {
    setEstado('Guardando…');
    try { await labApi('guardar_prompt', { tipo, guion, nota }); setEstado('Guardado. El bot real ya usa este guion.'); setNota(''); onGuardado?.(); }
    catch (e) { setEstado(e.message); }
  }
  async function restaurar() {
    setEstado('Restaurando…');
    try { const r = await labApi('restaurar_prompt', { tipo }); setGuion(r.guion); setEstado('Volviste al guion original.'); }
    catch (e) { setEstado(e.message); }
  }
  return (
    <div className="card lab-editor">
      <div className="card-head">
        <h2>Guion {tipo === 'chat' ? 'de chat' : 'de voz'}</h2>
        <span className={'badge' + (info.personalizado ? '' : ' warn')}>{info.personalizado ? 'Personalizado' : 'Original'}</span>
      </div>
      <small className="muted">Lo que edites aquí se prueba al instante en esta página. El bot real solo cambia cuando presionas Guardar. Las reglas fijas (honestidad, no inventar precios, formato de datos) se agregan siempre.</small>
      <textarea id={`guion-${tipo}`} className="guion" value={guion} onChange={(e) => setGuion(e.target.value)} spellCheck={false} />
      <input id={`nota-${tipo}`} placeholder="Nota de esta versión (opcional): ej. saludo más corto" value={nota} onChange={(e) => setNota(e.target.value)} />
      <div className="btns">
        <button className="btn gold" onClick={guardar}>Guardar como activo</button>
        <button className="btn" onClick={restaurar}>Volver al original</button>
      </div>
      {estado && <div className="note">{estado}</div>}
    </div>
  );
}

function Evaluacion({ ev, onUsarGuion }) {
  if (!ev) return null;
  const n = (v) => (v === undefined || v === null ? '—' : v);
  return (
    <div className="card evaluacion">
      <h2>Evaluación</h2>
      <div className="kpis kpis4">
        <div className="kpi"><b>{n(ev.naturalidad)}/10</b><span>Naturalidad</span></div>
        <div className="kpi"><b>{n(ev.claridad)}/10</b><span>Claridad</span></div>
        <div className="kpi"><b>{n(ev.avance_hacia_objetivo)}/10</b><span>Avance</span></div>
        <div className="kpi"><b>{n(ev.probabilidad_conversion)}%</b><span>Prob. de conversión</span></div>
      </div>
      {ev.cumple_reglas === false && <div className="alert">Rompió alguna regla fija. Revisa los momentos débiles.</div>}
      {ev.resultado && <p className="resumen-box">{ev.resultado}</p>}
      {ev.momentos_debiles?.length > 0 && (
        <>
          <label>Momentos débiles</label>
          {ev.momentos_debiles.map((m, i) => (
            <div key={i} className="call">
              <b>Turno {m.turno}: {m.problema}</b>
              {m.mejor_respuesta && <p>Mejor: “{m.mejor_respuesta}”</p>}
            </div>
          ))}
        </>
      )}
      {ev.cambios_al_guion?.length > 0 && (
        <>
          <label>Cambios sugeridos al guion</label>
          <ul className="lista">{ev.cambios_al_guion.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </>
      )}
      {ev.guion_mejorado && (
        <div className="btns"><button className="btn gold" onClick={() => onUsarGuion(ev.guion_mejorado)}>Cargar guion mejorado en el editor</button></div>
      )}
    </div>
  );
}

// ---------- Chat ----------

function LabChat({ inicial }) {
  const [guion, setGuion] = useState(inicial.activo);
  const [info, setInfo] = useState(inicial);
  const [personas, setPersonas] = useState([]);
  const [persona, setPersona] = useState('minero');
  const [historial, setHistorial] = useState([]);
  const [perfil, setPerfil] = useState({});
  const [estadoIA, setEstadoIA] = useState(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [ev, setEv] = useState(null);
  const [error, setError] = useState('');
  const detener = useRef(false);
  const fin = useRef(null);

  useEffect(() => { labApi('personas').then(setPersonas).catch(() => {}); }, []);
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }); }, [historial.length]);

  function reiniciar() { setHistorial([]); setPerfil({}); setEstadoIA(null); setEv(null); setError(''); }

  async function responderAsesor(hist, perf) {
    const out = await labApi('turno_asesor', { guion, historial: hist, perfil: perf });
    const nuevoHist = out.respuesta ? [...hist, { rol: 'asesor', texto: out.respuesta }] : hist;
    setHistorial(nuevoHist);
    setPerfil(out.perfil_acumulado || perf);
    setEstadoIA({ etapa: out.etapa, temperatura: out.temperatura, proximo_paso: out.proximo_paso, opt_out: out.opt_out, escalar_humano: out.escalar_humano, llamada_iso: out.llamada_iso });
    return { hist: nuevoHist, perf: out.perfil_acumulado || perf, out };
  }

  async function enviarManual(e) {
    e.preventDefault();
    if (!texto.trim()) return;
    setError(''); setOcupado('La asesora está escribiendo…');
    const hist = [...historial, { rol: 'cliente', texto: texto.trim() }];
    setHistorial(hist); setTexto('');
    try { await responderAsesor(hist, perfil); } catch (err) { setError(err.message); }
    setOcupado('');
  }

  async function simular() {
    reiniciar(); detener.current = false; setError('');
    let hist = []; let perf = {};
    try {
      for (let i = 0; i < 10 && !detener.current; i++) {
        setOcupado(`Turno ${i + 1}: el cliente escribe…`);
        const c = await labApi('turno_cliente', { persona, historial: hist });
        if (c.mensaje) { hist = [...hist, { rol: 'cliente', texto: c.mensaje }]; setHistorial(hist); }
        if (c.terminado && i > 0) break;
        setOcupado(`Turno ${i + 1}: la asesora responde…`);
        const r = await responderAsesor(hist, perf);
        hist = r.hist; perf = r.perf;
        if (['Llamada agendada', 'Descartado'].includes(r.out.etapa) || r.out.opt_out || r.out.escalar_humano) break;
      }
      setOcupado('Evaluando…');
      const p = personas.find((x) => x.id === persona);
      setEv(await labApi('evaluar', { tipo: 'chat', transcript: hist, guion, persona: p?.descripcion }));
    } catch (err) { setError(err.message); }
    setOcupado('');
  }

  async function evaluarActual() {
    if (!historial.length) return;
    setOcupado('Evaluando…'); setError('');
    try { setEv(await labApi('evaluar', { tipo: 'chat', transcript: historial, guion })); } catch (err) { setError(err.message); }
    setOcupado('');
  }

  const campos = Object.entries(perfil).filter(([, v]) => v !== null && v !== '' && v !== undefined);

  return (
    <div className="lab-grid">
      <Editor tipo="chat" guion={guion} setGuion={setGuion} info={info} onGuardado={() => setInfo({ ...info, personalizado: true })} />
      <div className="lab-col">
        <div className="card">
          <div className="card-head">
            <h2>Conversación de prueba</h2>
            <button className="btn" onClick={reiniciar} disabled={!!ocupado}>Reiniciar</button>
          </div>
          <div className="two">
            <div>
              <label htmlFor="persona">Cliente simulado</label>
              <select id="persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
                {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="btns" style={{ alignItems: 'flex-end' }}>
              {!ocupado || !ocupado.startsWith('Turno')
                ? <button className="btn gold" onClick={simular} disabled={!!ocupado}>Simular conversación</button>
                : <button className="btn" onClick={() => { detener.current = true; }}>Detener</button>}
            </div>
          </div>
          {personas.find((p) => p.id === persona) && <small className="muted">{personas.find((p) => p.id === persona).descripcion}</small>}

          <div className="chat lab-chat">
            {historial.length === 0 && <small className="muted">Escribe abajo como si fueras un cliente, o presiona “Simular conversación” para que la IA haga de cliente.</small>}
            {historial.map((m, i) => (
              <div key={i} className={'msg ' + (m.rol === 'cliente' ? 'cliente' : 'ia')}>
                <div className="bubble">{m.texto}</div>
                <small>{m.rol === 'cliente' ? 'Cliente' : 'Asesora IA'} · turno {i + 1}</small>
              </div>
            ))}
            <div ref={fin} />
          </div>
          {ocupado && <div className="note">{ocupado}</div>}
          <form className="composer" onSubmit={enviarManual}>
            <textarea id="msg-cliente" rows={2} placeholder="Escribe como cliente…" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!!ocupado} />
            <div className="btns">
              <button className="btn" type="button" onClick={evaluarActual} disabled={!!ocupado || !historial.length}>Evaluar conversación</button>
              <button className="btn gold" type="submit" disabled={!!ocupado || !texto.trim()}>Enviar</button>
            </div>
          </form>
          {error && <div className="err">{error}</div>}
        </div>

        {(campos.length > 0 || estadoIA) && (
          <div className="card">
            <h2>Lo que la IA entendió</h2>
            {estadoIA && (
              <div className="chips-line">
                <span className="badge">{estadoIA.etapa || '—'}</span>
                {estadoIA.temperatura && <span className="badge">{estadoIA.temperatura}</span>}
                {estadoIA.llamada_iso && <span className="badge">Llamada: {new Date(estadoIA.llamada_iso).toLocaleString('es-CL')}</span>}
                {estadoIA.opt_out && <span className="badge warn">Pidió no ser contactado</span>}
                {estadoIA.escalar_humano && <span className="badge warn">Pasar a humano</span>}
              </div>
            )}
            <div className="grid3">
              {campos.map(([k, v]) => <div key={k}><span>{k.replace(/_/g, ' ')}</span><b>{String(v)}</b></div>)}
            </div>
            {estadoIA?.proximo_paso && <div className="when">Próximo paso: {estadoIA.proximo_paso}</div>}
          </div>
        )}

        <Evaluacion ev={ev} onUsarGuion={(g) => { setGuion(g); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      </div>
    </div>
  );
}

// ---------- Voz en vivo ----------

const VOCES = ['eve', 'ara', 'leo', 'rex', 'sal'];

function b64DesdePCM(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const v = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function pcmDesdeB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const v = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
  return out;
}

function LabVoz({ inicial }) {
  const [guion, setGuion] = useState(inicial.activo);
  const [info, setInfo] = useState(inicial);
  const [voz, setVoz] = useState('eve');
  const [estado, setEstado] = useState('inactiva');
  const [lineas, setLineas] = useState([]);
  const [error, setError] = useState('');
  const [ev, setEv] = useState(null);
  const [evaluando, setEvaluando] = useState(false);
  const r = useRef({});
  const fin = useRef(null);

  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }); }, [lineas]);
  useEffect(() => () => colgar(), []); // eslint-disable-line

  function agregar(rol, texto, acumular) {
    setLineas((ls) => {
      if (acumular && ls.length && ls[ls.length - 1].rol === rol && ls[ls.length - 1].abierta) {
        const copia = [...ls];
        copia[copia.length - 1] = { ...copia[copia.length - 1], texto: copia[copia.length - 1].texto + texto };
        return copia;
      }
      return [...ls.map((l) => ({ ...l, abierta: false })), { rol, texto, abierta: !!acumular }];
    });
  }

  function cortarAudio() {
    (r.current.fuentes || []).forEach((s) => { try { s.stop(); } catch {} });
    r.current.fuentes = [];
    if (r.current.ctx) r.current.siguiente = r.current.ctx.currentTime;
  }

  function reproducir(b64) {
    const ctx = r.current.ctx;
    const datos = pcmDesdeB64(b64);
    const buf = ctx.createBuffer(1, datos.length, 24000);
    buf.copyToChannel(datos, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const t = Math.max(ctx.currentTime + 0.02, r.current.siguiente || 0);
    src.start(t);
    r.current.siguiente = t + buf.duration;
    r.current.fuentes = [...(r.current.fuentes || []), src];
    src.onended = () => { r.current.fuentes = (r.current.fuentes || []).filter((x) => x !== src); };
  }

  async function llamar() {
    setError(''); setEv(null); setLineas([]); setEstado('conectando');
    try {
      const { instrucciones } = await labApi('prompt_voz_prueba', { guion });
      const { token } = await labApi('voz_token');
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const ws = new WebSocket('wss://api.x.ai/v1/realtime', [`xai-client-secret.${token}`]);
      r.current = { ctx, mic, ws, fuentes: [], siguiente: 0 };

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            instructions: instrucciones,
            voice: voz,
            turn_detection: { type: 'server_vad' },
            audio: { input: { format: { type: 'audio/pcm', rate: 24000 } }, output: { format: { type: 'audio/pcm', rate: 24000 } } },
          },
        }));
        // La asesora habla primero, como en una llamada real
        ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '(La llamada se acaba de conectar. Saluda tú primero.)' }] } }));
        ws.send(JSON.stringify({ type: 'response.create' }));

        const src = ctx.createMediaStreamSource(mic);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (e) => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64DesdePCM(e.inputBuffer.getChannelData(0)) }));
        };
        src.connect(proc);
        proc.connect(ctx.destination);
        r.current.proc = proc;
        r.current.src = src;
        setEstado('en llamada');
      };

      ws.onmessage = (m) => {
        let e; try { e = JSON.parse(m.data); } catch { return; }
        const t = e.type || '';
        if (t === 'response.output_audio.delta' || t === 'response.audio.delta') reproducir(e.delta);
        else if (t === 'input_audio_buffer.speech_started') cortarAudio();
        else if (t.includes('transcript') && t.endsWith('.delta') && t.startsWith('response.')) agregar('asesor', e.delta || '', true);
        else if (t.includes('input_audio_transcription') && (t.endsWith('.completed') || t.endsWith('.updated')) && e.transcript) agregar('cliente', e.transcript, false);
        else if (t === 'response.done') setLineas((ls) => ls.map((l) => ({ ...l, abierta: false })));
        else if (t === 'error') setError(e.error?.message || JSON.stringify(e).slice(0, 200));
      };
      ws.onerror = () => setError('Se cortó la conexión de voz.');
      ws.onclose = () => { setEstado('inactiva'); limpiarAudio(); };
    } catch (err) {
      setError(err.message || String(err));
      setEstado('inactiva');
      limpiarAudio();
    }
  }

  function limpiarAudio() {
    const x = r.current;
    try { x.proc?.disconnect(); x.src?.disconnect(); } catch {}
    x.mic?.getTracks().forEach((tr) => tr.stop());
    try { x.ctx?.close(); } catch {}
  }

  function colgar() {
    try { r.current.ws?.close(); } catch {}
    limpiarAudio();
    setEstado('inactiva');
  }

  async function evaluarLlamada() {
    const transcript = lineas.filter((l) => l.texto.trim()).map((l) => ({ rol: l.rol, texto: l.texto.trim() }));
    if (!transcript.length) return;
    setEvaluando(true); setError('');
    try { setEv(await labApi('evaluar', { tipo: 'voz', transcript, guion })); } catch (err) { setError(err.message); }
    setEvaluando(false);
  }

  return (
    <div className="lab-grid">
      <Editor tipo="voz" guion={guion} setGuion={setGuion} info={info} onGuardado={() => setInfo({ ...info, personalizado: true })} />
      <div className="lab-col">
        <div className="card">
          <div className="card-head">
            <h2>Llamada de prueba</h2>
            <span className={'badge' + (estado === 'en llamada' ? '' : ' warn')}>{estado}</span>
          </div>
          <small className="muted">Tú haces de cliente: “Juan, 34 años, Fonasa, Copiapó, con una hija”. La asesora tiene una cotización de ejemplo. Usa audífonos para evitar eco.</small>
          <div className="two">
            <div>
              <label htmlFor="voz">Voz</label>
              <select id="voz" value={voz} onChange={(e) => setVoz(e.target.value)} disabled={estado !== 'inactiva'}>
                {VOCES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="btns" style={{ alignItems: 'flex-end' }}>
              {estado === 'inactiva'
                ? <button className="btn gold" onClick={llamar}>Empezar llamada</button>
                : <button className="btn" onClick={colgar}>Colgar</button>}
            </div>
          </div>
          <div className="chat lab-chat">
            {lineas.length === 0 && <small className="muted">La transcripción aparecerá aquí mientras hablan.</small>}
            {lineas.map((l, i) => (
              <div key={i} className={'msg ' + (l.rol === 'cliente' ? 'cliente' : 'ia')}>
                <div className="bubble">{l.texto || '…'}</div>
                <small>{l.rol === 'cliente' ? 'Tú (cliente)' : 'Asesora IA'}</small>
              </div>
            ))}
            <div ref={fin} />
          </div>
          <div className="btns">
            <button className="btn" onClick={evaluarLlamada} disabled={evaluando || estado !== 'inactiva' || !lineas.length}>{evaluando ? 'Evaluando…' : 'Evaluar llamada'}</button>
          </div>
          {error && <div className="err">{error}</div>}
        </div>
        <Evaluacion ev={ev} onUsarGuion={(g) => { setGuion(g); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      </div>
    </div>
  );
}

// ---------- Historial ----------

function Historial() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { labApi('historial').then(setRuns).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="err">{error}</div>;
  if (!runs) return <small className="muted">Cargando…</small>;
  if (!runs.length) return <div className="card placeholder">Todavía no hay pruebas evaluadas. Simula una conversación en la pestaña Chat.</div>;
  return (
    <div className="card">
      <h2>Pruebas evaluadas</h2>
      <small className="muted">Compara versiones de guion por su código: si el código cambia, el guion cambió.</small>
      <div className="tabla-wrap">
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Guion</th><th>Naturalidad</th><th>Conversión</th><th>Resultado</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{r.tipo}</td>
                <td><code>{r.prompt_hash}</code></td>
                <td>{r.evaluacion?.naturalidad ?? '—'}/10</td>
                <td>{r.evaluacion?.probabilidad_conversion ?? '—'}%</td>
                <td>{r.evaluacion?.resultado || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
