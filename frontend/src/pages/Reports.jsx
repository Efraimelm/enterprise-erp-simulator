// Relatórios e BI: filtros, tabela, totais, gráfico simples, fórmula e exportação CSV.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, toQuery } from '../api.js';
import { Alert, Field, Pager, Select, codeName, fmtDate, fmtMoney, fmtQty, today, useLookup } from '../components/ui.jsx';

const fmtCell = (v, type) => {
  if (v === null || v === undefined) return '—';
  if (type === 'money') return fmtMoney(v);
  if (type === 'qty') return fmtQty(v);
  if (type === 'percent') return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (type === 'number') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  if (type === 'date') return fmtDate(v);
  if (type === 'bool') return v ? <span className="status warn">sim</span> : 'não';
  return String(v);
};

/** Dados do gráfico de cada relatório (barras horizontais simples, sem biblioteca). */
function chartData(name, data, totals) {
  if (!data) return null;
  if (name === 'sales-by-period') {
    const by = new Map();
    data.forEach((r) => by.set(r.periodo, (by.get(r.periodo) ?? 0) + r.liquido));
    return { title: 'Faturamento líquido por período', money: true, items: [...by.entries()].map(([label, value]) => ({ label, value })) };
  }
  if (name === 'receivables-aging') {
    const labels = { a_vencer: 'A vencer', d1_30: '1–30 dias', d31_60: '31–60 dias', d61_90: '61–90 dias', acima_90: '> 90 dias' };
    return { title: 'Em aberto por faixa de vencimento', money: true, items: Object.entries(labels).map(([k, label]) => ({ label, value: totals[k] ?? 0, warn: k !== 'a_vencer' })) };
  }
  if (name === 'purchases-by-supplier') return { title: 'Valor comprado por fornecedor', money: true, items: data.map((r) => ({ label: r.fornecedor, value: r.valor_bruto })) };
  if (name === 'stock-position') {
    const by = new Map();
    data.forEach((r) => by.set(r.categoria, (by.get(r.categoria) ?? 0) + r.valor));
    return { title: 'Valor do estoque por categoria (simulado)', money: true, items: [...by.entries()].map(([label, value]) => ({ label, value })) };
  }
  if (name === 'stock-turnover') return { title: 'Giro no período (maiores)', money: false, items: data.filter((r) => r.giro != null).sort((a, b) => b.giro - a.giro).slice(0, 10).map((r) => ({ label: `${r.material} · ${r.centro}`, value: r.giro })) };
  return null;
}

function Bars({ chart }) {
  if (!chart || !chart.items.length) return null;
  const max = Math.max(...chart.items.map((i) => Math.abs(i.value)), 1);
  return (
    <figure className="bars" aria-label={chart.title}>
      <figcaption>{chart.title}</figcaption>
      {chart.items.map((i) => (
        <div key={i.label} className="bar-row">
          <span className="bar-label" title={i.label}>{i.label}</span>
          <span className="bar-track"><span className={`bar ${i.warn && i.value > 0 ? 'warn' : ''}`} style={{ width: `${(Math.abs(i.value) / max) * 100}%` }} /></span>
          <span className="bar-value">{chart.money ? fmtMoney(i.value) : Number(i.value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span>
        </div>
      ))}
    </figure>
  );
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [filters, setFilters] = useState({ from: today(-89), to: today(), plant_id: '', group: 'month' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const plants = useLookup('/org/plants?pageSize=100');
  const name = params.get('r');

  useEffect(() => { api('/reports').then((r) => setList(r.data)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (list?.length && !name) setParams({ r: list[0].name }, { replace: true }); }, [list, name, setParams]);
  const current = list?.find((r) => r.name === name);

  const query = useMemo(() => toQuery({
    ...(current?.period ? { from: filters.from, to: filters.to } : {}),
    plant_id: filters.plant_id,
    ...(name === 'sales-by-period' ? { group: filters.group } : {}),
  }), [current, filters, name]);

  useEffect(() => {
    if (!current) return;
    setError(''); setResult(null);
    const sep = query ? '&' : '?';
    // Para o gráfico usamos todas as linhas; a tabela pagina no cliente.
    api(`/reports/${name}${query}${sep}all=true`).then(setResult).catch((e) => setError(e.message));
    setPage(1);
  }, [current, name, query]);

  const pageSize = 50;
  const rows = result?.data.slice((page - 1) * pageSize, page * pageSize) ?? [];
  const chart = result ? chartData(name, result.data, result.totals) : null;
  const groups = useMemo(() => [...new Set((list ?? []).map((r) => r.group))], [list]);

  return (
    <>
      <div className="page-header">
        <h1>Relatórios e BI</h1>
        <p className="hint">
          Indicadores calculados no ERP, com a fórmula de cada um. Os mesmos dados alimentam o resumo do n8n, o assistente e o Power BI
          (consultas prontas em <code>analytics/</code>). Avaliações de estoque e financeiro são <strong>simuladas</strong>.
        </p>
      </div>
      <Alert error={error} />
      {list && list.length === 0 && <p className="empty">Você não tem permissão para nenhum relatório.</p>}
      <div className="org-layout">
        <nav className="subnav" aria-label="Relatórios">
          {groups.map((g) => (
            <div key={g}>
              <div className="sidenav-group-title">{g}</div>
              {list.filter((r) => r.group === g).map((r) => (
                <button key={r.name} className={`subnav-item subnav-button ${r.name === name ? 'active' : ''}`} onClick={() => setParams({ r: r.name })}>{r.title}</button>
              ))}
            </div>
          ))}
        </nav>
        {current && (
          <section className="card">
            <div className="card-header">
              <div><h2>{current.title}</h2><p className="hint small">{current.definition}</p></div>
              <a className="btn btn-small" href={`/api/reports/${name}${query}${query ? '&' : '?'}format=csv`} download>Exportar CSV (Excel)</a>
            </div>
            <div className="toolbar">
              {current.period && <Field label="De"><input type="date" value={filters.from} max={filters.to} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>}
              {current.period && <Field label="Até"><input type="date" value={filters.to} max={today()} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>}
              <Field label="Centro"><Select value={filters.plant_id} placeholder="Todos do meu escopo" onChange={(v) => setFilters({ ...filters, plant_id: v })} options={plants.map(codeName)} /></Field>
              {name === 'sales-by-period' && (
                <Field label="Agrupar por"><Select value={filters.group} placeholder="Mês" onChange={(v) => setFilters({ ...filters, group: v || 'month' })} options={[{ value: 'month', label: 'Mês' }, { value: 'day', label: 'Dia' }]} /></Field>
              )}
            </div>
            {!result && !error && <p className="empty" role="status">Calculando…</p>}
            {result && (
              <>
                <div className="kpi-strip">
                  {Object.entries(result.totals).filter(([, v]) => typeof v === 'number').map(([k, v]) => (
                    <div key={k} className="kpi"><span className="kpi-value">{/valor|liquido|bruto|imposto|a_vencer|d\d|acima|total/.test(k) && !/^(titulos|linhas|pedidos|fornecedores|atrasados|abaixo)/.test(k) ? fmtMoney(v) : fmtQty(v)}</span><span className="kpi-label">{k.replaceAll('_', ' ')}</span></div>
                  ))}
                </div>
                <Bars chart={chart} />
                <div className="table-wrap">
                  <table>
                    <thead><tr>{result.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {result.data.length === 0 && <tr><td colSpan={result.columns.length} className="empty">Sem dados para os filtros escolhidos.</td></tr>}
                      {rows.map((r, i) => <tr key={i}>{result.columns.map((c) => <td key={c.key} className={['money', 'qty', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{fmtCell(r[c.key], c.type)}</td>)}</tr>)}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} pageSize={pageSize} total={result.data.length} onPage={setPage} />
                <p className="hint small">Gerado em {fmtDate(result.meta.generated_at)} · escopo: {result.meta.scope}</p>
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
