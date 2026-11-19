// Componentes e utilidades reaproveitados pelas telas de MM (e, depois, SD).
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, toQuery } from '../api.js';

/* ── Formatação (pt-BR) ── */
export const fmtMoney = (v, currency = 'BRL') =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency });
export const fmtQty = (v, unit) =>
  v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
export const fmtDate = (v) => {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
  return new Date(v).toLocaleString('pt-BR');
};
export const today = (plusDays = 0) => new Date(Date.now() + plusDays * 86400_000).toISOString().slice(0, 10);

/* ── Status ── */
export const STATUS = {
  ACTIVE: ['Ativo', 'ok'], BLOCKED: ['Bloqueado', 'bad'], INACTIVE: ['Inativo', 'off'],
  DRAFT: ['Rascunho', 'off'], PENDING_APPROVAL: ['Aguardando aprovação', 'warn'], APPROVED: ['Aprovado', 'ok'],
  SENT: ['Enviado ao fornecedor', 'ok'], PARTIALLY_RECEIVED: ['Parcialmente recebido', 'warn'], RECEIVED: ['Recebido', 'ok'],
  CANCELLED: ['Cancelado', 'off'], REJECTED: ['Rejeitada', 'bad'], CONVERTED: ['Convertida em pedido', 'ok'],
};
export function Status({ value }) {
  const [label, cls] = STATUS[value] ?? [value, 'off'];
  return <span className={`status ${cls}`}>{label}</span>;
}

/* ── Modal ── */
export function Modal({ title, onClose, children, wide, actions }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="card-header">
          <h3>{title}</h3>
          <button className="btn btn-small" onClick={onClose} aria-label="Fechar">Fechar</button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/* ── Campos ── */
export function Field({ label, error, required, children, hint }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label>
        <span>{label}{required && <span className="req" aria-hidden> *</span>}</span>
        {children}
      </label>
      {hint && !error && <span className="hint small">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder = 'Selecione…', disabled }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : isNaN(e.target.value) ? e.target.value : Number(e.target.value))}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Alert({ error, ok }) {
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (ok) return <div className="alert success" role="status">{ok}</div>;
  return null;
}

/** Mensagem de erro amigável, incluindo os erros por campo e por item (items.0.quantity). */
export function errorText(err) {
  if (!(err instanceof ApiError) || !err.details?.length) return err.message;
  const extra = err.details.filter((d) => d.field?.startsWith('items.')).map((d) => {
    const [, idx, field] = d.field.split('.');
    return `Item ${Number(idx) + 1} (${field}): ${d.message}`;
  });
  return [err.message, ...extra].join(' ');
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button className="btn btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima</button>
    </div>
  );
}

/** Lista paginada com filtros. Recarrega quando os filtros mudam. */
export function useList(path, initialFilters = {}, pageSize = 20) {
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api(`${path}${toQuery({ ...filters, page, pageSize })}`).then(setData).catch((e) => setError(e.message));
  }, [path, filters, page, pageSize]);
  useEffect(() => { load(); }, [load]);
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  return { data, error, filters, setFilter, page, setPage, pageSize, reload: load };
}

/* ── Listas de apoio (cache simples em memória) ── */
const cache = new Map();
export function useLookup(path) {
  const [rows, setRows] = useState(() => cache.get(path) ?? []);
  useEffect(() => {
    if (cache.has(path)) return;
    api(path).then((r) => { cache.set(path, r.data); setRows(r.data); }).catch(() => {});
  }, [path]);
  return rows;
}
export const clearLookups = () => cache.clear();
export const codeName = (r) => ({ value: r.id, label: `${r.code} – ${r.name ?? r.description}` });
