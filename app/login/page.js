'use client';
import { useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function entrar(e) {
    e.preventDefault();
    setError('');
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) setError('Correo o clave incorrectos');
    else window.location.href = '/';
  }

  return (
    <form className="login" onSubmit={entrar}>
      <h1>Asesor IA</h1>
      <label>Correo</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label>Clave</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <div className="btns"><button className="btn gold" type="submit">Entrar</button></div>
      {error && <div className="err">{error}</div>}
    </form>
  );
}
