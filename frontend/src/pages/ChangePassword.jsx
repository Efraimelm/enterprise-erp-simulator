import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function ChangePassword() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next !== confirm) return setErrors(['A confirmação não confere com a nova senha.']);
    setBusy(true);
    setErrors([]);
    try {
      await changePassword(current, next);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(err instanceof ApiError && err.details.length ? err.details.map((d) => d.message) : [err.message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Troque sua senha</h1>
        <p className="hint">
          {user.must_change_password
            ? 'Por segurança, a senha provisória precisa ser trocada antes do primeiro acesso.'
            : 'Defina uma nova senha.'}
        </p>
        <p className="hint small">Mínimo de 12 caracteres, misturando pelo menos 3 tipos: minúsculas, maiúsculas, números e símbolos.</p>
        {errors.length > 0 && (
          <div className="alert error" role="alert">
            {errors.map((m) => <div key={m}>{m}</div>)}
          </div>
        )}
        <div className="field">
          <label htmlFor="current">Senha atual</label>
          <input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="next">Nova senha</label>
          <input id="next" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirme a nova senha</label>
          <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
        <button type="button" className="btn btn-block" onClick={logout}>Sair</button>
      </form>
    </div>
  );
}
