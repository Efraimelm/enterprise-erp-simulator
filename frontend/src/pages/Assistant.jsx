// Assistente de IA: só consulta, com as permissões de quem pergunta, sempre com a fonte.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Alert } from '../components/ui.jsx';

export default function Assistant() {
  const [caps, setCaps] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => { api('/assistant/capabilities').then((r) => setCaps(r.data)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(message) {
    const q = (message ?? text).trim();
    if (q.length < 3 || busy) return;
    setText(''); setError(''); setBusy(true);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    try {
      const r = (await api('/assistant/chat', { method: 'POST', body: { message: q, history } })).data;
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, sources: r.sources, denied: r.denied, mode: r.mode, fallback: r.fallback_reason }]);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-header">
        <h1>Assistente</h1>
        <p className="hint">
          Pergunte sobre estoque, compras e vendas. O assistente <strong>só consulta</strong> (não aprova, não altera estoque, não confirma vendas),
          usa apenas os dados que <strong>você</strong> tem permissão para ver e sempre mostra a fonte.
          {caps && <> Modo: <strong>{caps.mode === 'LLM' ? `IA (${caps.model})` : 'determinista (sem chave de IA configurada)'}</strong>.</>}
        </p>
      </div>
      <Alert error={error} />
      <div className="chat">
        <section className="card chat-log" aria-live="polite">
          {messages.length === 0 && caps && (
            <div className="hint">
              <p>Experimente:</p>
              <div className="chips-wrap">{caps.examples.map((e) => <button key={e} className="chip chip-btn" onClick={() => send(e)}>{e}</button>)}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="msg-body">{m.content}</div>
              {m.role === 'assistant' && (
                <>
                  {m.fallback && <div className="hint small">{m.fallback}</div>}
                  {m.sources?.length > 0 && (
                    <details className="sources" open>
                      <summary>Fonte ({m.sources.length})</summary>
                      <ul>{m.sources.map((s) => (
                        <li key={s.tool}><code>{s.tool}</code> · {s.endpoint}{s.documents.length > 0 && <div className="hint small">Documentos: {s.documents.slice(0, 15).join(', ')}{s.documents.length > 15 ? '…' : ''}</div>}</li>
                      ))}</ul>
                    </details>
                  )}
                  {m.denied?.length > 0 && <div className="hint small">Sem permissão: {m.denied.map((d) => d.tool).join(', ')}</div>}
                  <div className="hint small">{m.mode === 'LLM' ? 'Redigido por IA a partir das ferramentas' : 'Resposta determinista (sem IA)'}</div>
                </>
              )}
            </div>
          ))}
          {busy && <div className="msg assistant"><div className="msg-body hint">Consultando…</div></div>}
          <div ref={endRef} />
        </section>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: Quais pedidos de venda ainda não foram entregues no CF10?" aria-label="Pergunta" maxLength={500} />
          <button className="btn btn-primary" disabled={busy || text.trim().length < 3}>Perguntar</button>
        </form>
        {caps && (
          <details className="card">
            <summary>O que você pode perguntar</summary>
            <ul>{caps.tools.map((t) => <li key={t.name} className={t.allowed ? '' : 'hint'}>{t.allowed ? '✓' : '✕'} {t.description}{!t.allowed && ' (sem permissão)'}</li>)}</ul>
          </details>
        )}
      </div>
    </>
  );
}
