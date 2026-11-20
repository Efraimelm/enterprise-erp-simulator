// CSV pronto para o Excel em pt-BR: UTF-8 com BOM, separador ";" e decimal com vírgula (ou ponto).
export function toCsv(columns, rows, { decimal = 'comma' } = {}) {
  const cell = (v, type) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'sim' : 'não';
    if (typeof v === 'number' || type === 'number' || type === 'money' || type === 'qty' || type === 'percent') {
      const n = Number(v);
      if (Number.isNaN(n)) return '';
      const s = String(type === 'money' ? n.toFixed(2) : n);
      return decimal === 'comma' ? s.replace('.', ',') : s;
    }
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => cell(c.label, 'text')).join(';');
  const body = rows.map((r) => columns.map((c) => cell(r[c.key], c.type)).join(';'));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}
