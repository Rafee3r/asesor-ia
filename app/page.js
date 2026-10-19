'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser, ETAPAS, etiqueta, haceCuanto, horasDesde, pesos, soloDigitos, api } from '../lib/supabase';

const CANAL = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', formulario: 'Formulario', manual: 'Manual' };
const RESUMEN_ETAPAS = ['Nuevo', 'En conversacion', 'Calificado', 'Llamada agendada', 'Firma agendada', 'Cerrado'];

export default function Home() {
  const sb = supabaseBrowser();
  const [contactos, setContactos] = useState([]);
  const [sel, setSel] = useState(null);
  const [filtro, setFiltro] = useState('Todos');
  const [buscar, setBuscar] = useState('');
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    const { data: ses } = await sb.auth.getSession();
    if (!ses.session) { window.location.href = '/login'; return; }
    const { data, error } = await sb.from('contacts').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(500);
    if (!error) setContactos(data || []);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, []);

  async function actualizar(id, cambios) {
    const { data, error } = await sb.from('contacts').update(cambios).eq('id', id).select().single();
    if (!error && data) setContactos((cs) => cs.map((c) => (c.id === id ? data : c)));
    return { data, error };
  }

  const conteo = useMemo(() => {
    const m = {};
    contactos.forEach((c) => { m[c.etapa] = (m[c.etapa] || 0) + 1; });
    return m;
  }, [contactos]);

  const visibles = useMemo(() => {
    let base = filtro === 'Todos' ? contactos : contactos.filter((c) => c.etapa === filtro);
    if (filtro === 'Revisar') base = contactos.filter((c) => !c.ia_activa && !c.opt_out && !['Cerrado', 'Descartado'].includes(c.etapa));
    const q = buscar.trim().toLowerCase();
    if (q) base = base.filter((c) => [c.nombre, c.telefono, c.comuna, c.prevision_actual].some((v) => String(v || '').toLowerCase().includes(q)));
    return base;
  }, [contactos, filtro, buscar]);

  const contacto = contactos.find((c) => c.id === sel);
  const revisar = contactos.filter((c) => !c.ia_activa && !c.opt_out && !['Cerrado', 'Descartado'].includes(c.etapa)).length;

  async function salir() {
    await sb.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <div className="wrap">
      <div className="top">
        <h1>Asesor IA <span className="muted">· {contactos.length} contactos</span></h1>
        <button className="btn" onClick={salir}>Salir</button>
      </div>

      <div className="kpis">
        {RESUMEN_ETAPAS.map((e) => (
          <div key={e} className={'kpi' + (filtro === e ? ' on' : '')} onClick={() => setFiltro(filtro === e ? 'Todos' : e)}>
            <b>{conteo[e] || 0}</b><span>{etiqueta(e)}</span>
          </div>
        ))}
      </div>

      <div className="filters">
        <input className="search" placeholder="Buscar nombre, teléfono o comuna" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {['Todos', 'Revisar', ...ETAPAS].map((e) => (
          <span key={e} className={'chip' + (filtro === e ? ' on' : '') + (e === 'Revisar' && revisar ? ' alerta' : '')} onClick={() => setFiltro(e)}>
            {etiqueta(e)}{e === 'Revisar' && revisar ? ` (${revisar})` : ''}
          </span>
        ))}
      </div>

      <div className="layout">
        <div className="list">
          {cargando && <small className="muted">Cargando…</small>}
          {!cargando && visibles.length === 0 && (
            <div className="empty">
              <b>No hay contactos en esta vista.</b>
              <small>Cuando alguien escriba por WhatsApp, Instagram o Messenger aparecerá aquí con su perfil armado por la IA.</small>
            </div>
          )}
          {visibles.map((c) => (
            <div key={c.id} className={'row' + (sel === c.id ? ' sel' : '')} onClick={() => setSel(c.id)}>
              <div className="row-main">
                <div className="row-top">
                  <span className={'dot ' + (c.temperatura || '')} title={c.temperatura || 'sin temperatura'} />
                  <b>{c.nombre || c.telefono || 'Sin nombre'}</b>
                  <span className="canal">{CANAL[c.canal_origen]}</span>
                </div>
                <small>{etiqueta(c.etapa)}{c.prevision_actual ? ` · ${c.prevision_actual}` : ''}{c.renta ? ` · ${pesos(c.renta)}` : ''}</small>
                {c.resumen_ia && <small className="resumen">{c.resumen_ia}</small>}
              </div>
              <div className="row-side">
                <span className="badge">{haceCuanto(c.last_message_at)}</span>
                {!c.ia_activa && !c.opt_out && <span className="badge warn">Humano</span>}
              </div>
            </div>
          ))}
        </div>

        {contacto ? (
          <Ficha key={contacto.id} c={contacto} onChange={(cambios) => actualizar(contacto.id, cambios)} />
        ) : (
          <div className="card placeholder">Elige un contacto para ver su perfil, la conversación y el briefing de llamada.</div>
        )}
      </div>
    </div>
  );
}

function Ficha({ c, onChange }) {
  const sb = supabaseBrowser();
  const [mensajes, setMensajes] = useState([]);
  const [llamadas, setLlamadas] = useState([]);
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [tab, setTab] = useState('conversacion');
  const fin = useRef(null);
  const tel = soloDigitos(c.telefono);
  const horasSinResponder = horasDesde(c.last_inbound_at);
  const fueraDeVentana = c.canal_origen && ['whatsapp', 'instagram', 'messenger'].includes(c.canal_origen) && (horasSinResponder === null || horasSinResponder >= 24);

  async function cargarMensajes() {
    const [{ data: m }, { data: l }] = await Promise.all([
      sb.from('messages').select('*').eq('contact_id', c.id).order('created_at', { ascending: true }).limit(300),
      sb.from('calls').select('*').eq('contact_id', c.id).order('created_at', { ascending: false }),
    ]);
    setMensajes(m || []);
    setLlamadas(l || []);
  }

  useEffect(() => {
    cargarMensajes();
    const t = setInterval(cargarMensajes, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [c.id]);

  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }); }, [mensajes.length, tab]);

  async function enviar(e) {
    e.preventDefault();
    if (!texto.trim()) return;
    setOcupado(true); setAviso('');
    try {
      await api('enviar_mensaje', { contact_id: c.id, texto: texto.trim(), autor: 'humano' });
      setTexto('');
      await cargarMensajes();
    } catch (err) { setAviso(err.message); }
    setOcupado(false);
  }

  async function sugerir() {
    setOcupado(true); setAviso('');
    try {
      const r = await api('sugerir_respuesta', { contact_id: c.id });
      setTexto(r.respuesta || '');
      if (!r.respuesta) setAviso('La IA no sugirió respuesta para este momento.');
    } catch (err) { setAviso(err.message); }
    setOcupado(false);
  }

  async function copiarBriefing() {
    setAviso('');
    try {
      const b = await api('briefing_llamada', { contact_id: c.id });
      await navigator.clipboard.writeText(b.instrucciones_voz);
      setAviso('Instrucciones de voz copiadas.');
    } catch (err) { setAviso(err.message); }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{c.nombre || 'Sin nombre'}</h2>
          <div className="sub">{CANAL[c.canal_origen]}{c.telefono ? ` · +${tel}` : ''}{c.ad_headline ? ` · Anuncio: ${c.ad_headline}` : c.ad_id ? ` · Anuncio ${c.ad_id}` : ''}</div>
        </div>
        <label className="switch" title="Si está apagada, la IA no responde y lo atiende un humano">
          <input type="checkbox" checked={c.ia_activa} onChange={(e) => onChange({ ia_activa: e.target.checked })} />
          <span>{c.ia_activa ? 'IA activa' : 'Humano'}</span>
        </label>
      </div>

      {c.opt_out && <div className="alert">Pidió no ser contactado. No le escribas.</div>}
      {!c.ia_activa && !c.opt_out && c.proximo_paso && <div className="alert">{c.proximo_paso}</div>}

      <div className="two">
        <div>
          <label>Etapa</label>
          <select value={c.etapa} onChange={(e) => onChange({ etapa: e.target.value })}>
            {ETAPAS.map((e) => <option key={e} value={e}>{etiqueta(e)}</option>)}
          </select>
        </div>
        <div>
          <label>Temperatura</label>
          <select value={c.temperatura || ''} onChange={(e) => onChange({ temperatura: e.target.value || null })}>
            <option value="">—</option><option value="frio">Frío</option><option value="tibio">Tibio</option><option value="caliente">Caliente</option>
          </select>
        </div>
      </div>

      {c.resumen_ia && <p className="resumen-box">{c.resumen_ia}</p>}
      {c.proximo_paso && c.ia_activa && <div className="when">Próximo paso: {c.proximo_paso}</div>}
      {c.llamada_programada_at && <div className="when">Llamada: {new Date(c.llamada_programada_at).toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}

      <div className="grid3">
        <Dato t="Edad" v={c.edad} />
        <Dato t="Renta" v={c.renta ? pesos(c.renta) : null} />
        <Dato t="Cargas" v={c.cargas ?? null} extra={c.edades_cargas} />
        <Dato t="Previsión" v={c.prevision_actual} />
        <Dato t="Plan actual" v={c.plan_actual} extra={c.costo_plan_actual ? pesos(c.costo_plan_actual) : null} />
        <Dato t="Comuna" v={c.comuna} />
        <Dato t="Clínica" v={c.clinica_preferida} />
        <Dato t="Le importa" v={c.necesidades} />
        <Dato t="Horario" v={c.horario_llamada} />
      </div>
      {c.preexistencias_mencionadas && <div className="note">Mencionó preexistencias: revisar en la llamada.</div>}

      <div className="tabs">
        {[['conversacion', 'Conversación'], ['llamada', 'Llamada'], ['notas', 'Notas']].map(([k, t]) => (
          <span key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}</span>
        ))}
      </div>

      {tab === 'conversacion' && (
        <>
          <div className="chat">
            {mensajes.length === 0 && <small className="muted">Sin mensajes todavía.</small>}
            {mensajes.map((m) => (
              <div key={m.id} className={'msg ' + m.autor}>
                <div className="bubble">{m.texto}</div>
                <small>{m.autor === 'cliente' ? '' : m.autor === 'ia' ? 'IA · ' : m.autor === 'humano' ? 'Tú · ' : ''}{new Date(m.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
              </div>
            ))}
            <div ref={fin} />
          </div>
          {fueraDeVentana && !c.opt_out && <div className="note">Pasaron más de 24 h desde su último mensaje: Meta solo permite plantillas aprobadas.</div>}
          <form className="composer" onSubmit={enviar}>
            <textarea id="mensaje" rows={2} placeholder="Escribe como humano…" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={c.opt_out} />
            <div className="btns">
              <button className="btn" type="button" onClick={sugerir} disabled={ocupado || c.opt_out}>Sugerir con IA</button>
              <button className="btn gold" type="submit" disabled={ocupado || c.opt_out || !texto.trim()}>Enviar</button>
            </div>
          </form>
        </>
      )}

      {tab === 'llamada' && (
        <div>
          <div className="btns">
            {tel && <a className="btn gold" href={`tel:+${tel}`}>Llamar yo</a>}
            <button className="btn" onClick={copiarBriefing}>Copiar instrucciones de voz</button>
          </div>
          <label htmlFor="cotizacion">Cotización para la llamada (opciones de plan)</label>
          <textarea id="cotizacion" rows={4} defaultValue={c.cotizacion || ''} placeholder="Ej: Opción 1: Plan X de Colmena, $95.000, red Clínica Atacama…"
            onBlur={(e) => e.target.value !== (c.cotizacion || '') && onChange({ cotizacion: e.target.value })} />
          <label>Llamadas</label>
          {llamadas.length === 0 && <small className="muted">Sin llamadas registradas.</small>}
          {llamadas.map((l) => (
            <div key={l.id} className="call">
              <b>{l.estado}{l.resultado ? ` · ${l.resultado}` : ''}</b>
              <small>{l.programada_at ? new Date(l.programada_at).toLocaleString('es-CL') : new Date(l.created_at).toLocaleString('es-CL')}{l.duracion_seg ? ` · ${Math.round(l.duracion_seg / 60)} min` : ''}</small>
              {l.resumen && <p>{l.resumen}</p>}
            </div>
          ))}
        </div>
      )}

      {tab === 'notas' && (
        <div>
          <label htmlFor="notas">Notas internas</label>
          <textarea id="notas" rows={5} defaultValue={c.notas || ''} onBlur={(e) => e.target.value !== (c.notas || '') && onChange({ notas: e.target.value })} />
          {c.motivo_descarte && <div className="note">Motivo de descarte: {c.motivo_descarte}</div>}
        </div>
      )}

      {aviso && <div className="err">{aviso}</div>}
    </div>
  );
}

function Dato({ t, v, extra }) {
  return (
    <div>
      <span>{t}</span>
      <b>{v === null || v === undefined || v === '' ? '—' : v}</b>
      {extra && <small className="muted">{extra}</small>}
    </div>
  );
}
