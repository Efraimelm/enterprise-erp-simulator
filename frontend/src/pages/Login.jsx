import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.must_change_password ? '/trocar-senha' : '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(username, password);
      navigate(u.must_change_password ? '/trocar-senha' : location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="shellbar-logo">ERP</span>
          <div>
            <h1>Enterprise ERP Simulator</h1>
            <p className="hint">Simulador educacional inspirado em processos do SAP S/4HANA. Não é um produto SAP.</p>
          </div>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="username">Usuário</label>
          <input id="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="hint small">Empresa de demonstração: Comércio Forte Ltda (dados fictícios).</p>
      </form>
    </div>
  );
}
