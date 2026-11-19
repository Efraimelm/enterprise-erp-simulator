import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Select, codeName, errorText, fmtDate, fmtMoney, fmtQty, useLookup } from '../../components/ui.jsx';

export default function Mrp() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const plants = useLookup('/org/plants?pageSize=100');
  const [plantId, setPlantId] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState({}); // chave → quantidade
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const key = (s) => `${s.material_id}:${s.plant_id}`;

  async function run() {
    setBusy(true); setMsg({});
    try {
      const r = await api('/mm/mrp/run', { method: 'POST', body: plantId ? { plant_id: plantId } : {} });
      setResult(r);
      setSelected(Object.fromEntries(r.data.map((s) => [key(s), s.suggested_qty])));
    } catch (e) { setMsg({ error: errorText(e) }); } finally { setBusy(false); }
  }

  async function convert() {
    const items = result.data.filter((s) => selected[key(s)] !== undefined && Number(selected[key(s)]) > 0)
      .map((s) => ({ material_id: s.material_id, plant_id: s.plant_id, quantity: selected[key(s)] }));
    if (!items.length) return;
    if (!window.confirm(`Criar requisição(ões) de compra com ${items.length} item(ns)? Elas ainda passam por aprovação.`)) return;
    try {
      const r = await api('/mm/mrp/convert', { method: 'POST', body: { items } });
      setMsg({ ok: `Requisição(ões) criada(s): ${r.data.map((p) => p.number).join(', ')}. Aguardando aprovação.` });
      setResult(null);
    } catch (e) { setMsg({ error: errorText(e) }); }
  }

  const toggle = (s, on) => setSelected((sel) => { const n = { ...sel }; if (on) n[key(s)] = s.suggested_qty; else delete n[key(s)]; return n; });

  return (
    <>
      <div className="page-header">
        <h1>MRP simplificado</h1>
        <p className="hint">
          Planejamento de reposição <strong>simplificado</strong> (não é o MRP do SAP): sugere compra quando a cobertura
          (disponível + pedidos em aberto + requisições abertas) fica no ponto de reposição ou abaixo dele. Repõe até o estoque máximo.
          Não considera datas, lead time nem previsão de demanda.
        </p>
      </div>
      <Alert error={msg.error} ok={msg.ok} />
      <section className="card">
        <div className="toolbar">
          <Field label="Centro"><Select value={plantId} placeholder="Todos do meu escopo" onChange={setPlantId} options={plants.map(codeName)} /></Field>
          <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Calculando…' : 'Executar MRP'}</button>
          {msg.ok && <button className="btn" onClick={() => navigate('/mm/requisicoes')}>Ver requisições</button>}
        </div>
        {result && (
          <>
            <p className="hint">Executado em {fmtDate(result.meta.run_at)} · {result.data.length} sugestão(ões) · valor estimado {fmtMoney(result.meta.total_estimated_value)}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th aria-label="Selecionar" /><th>Material</th><th>Centro</th><th>Disponível</th><th>Pedidos abertos</th><th>Requisições abertas</th><th>Cobertura</th><th>Ponto</th><th>Máximo</th><th>Comprar</th><th>Melhor fornecedor</th><th>Valor estimado</th></tr></thead>
                <tbody>
                  {result.data.length === 0 && <tr><td colSpan={12} className="empty">Nenhuma necessidade: todos os materiais estão cobertos.</td></tr>}
                  {result.data.map((s) => (
                    <tr key={key(s)} className={s.below_min ? 'row-warn' : ''}>
                      <td><input type="checkbox" checked={selected[key(s)] !== undefined} onChange={(e) => toggle(s, e.target.checked)} aria-label={`Selecionar ${s.material_code}`} /></td>
                      <td><strong>{s.material_code}</strong> – {s.description}{s.below_min && <div className="hint small">abaixo do estoque mínimo</div>}</td>
                      <td>{s.plant_code}</td><td>{fmtQty(s.available_qty)}</td><td>{fmtQty(s.open_po_qty)}</td><td>{fmtQty(s.open_pr_qty)}</td>
                      <td>{fmtQty(s.coverage_qty)}</td><td>{fmtQty(s.reorder_point)}</td><td>{fmtQty(s.max_stock)}</td>
                      <td><input type="number" min="0" step="1" className="input-qty" disabled={selected[key(s)] === undefined} value={selected[key(s)] ?? s.suggested_qty} onChange={(e) => setSelected({ ...selected, [key(s)]: e.target.value })} aria-label={`Quantidade de ${s.material_code}`} /> {s.base_unit}</td>
                      <td>{s.supplier ? `${s.supplier.code} (${fmtMoney(s.supplier.net_price)})` : '—'}</td><td className="nowrap">{fmtMoney(s.estimated_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.data.length > 0 && can('MM.PURCHASE_REQ.CREATE') && (
              <button className="btn btn-primary" onClick={convert}>Converter selecionadas em requisições</button>
            )}
          </>
        )}
      </section>
    </>
  );
}
