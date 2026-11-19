// Editor de itens de documentos (requisição e pedido de compra).
import { Select, codeName, fmtMoney } from './ui.jsx';

export default function ItemsEditor({ items, onChange, materials, slocs, taxCodes, columns }) {
  const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, { material_id: '', quantity: '', storage_location_id: '', ...(columns.needDate ? { need_date: columns.needDate } : {}) }]);
  const unitOf = (id) => materials.find((m) => m.id === id)?.base_unit ?? '';

  return (
    <div className="items-editor">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th><th>Material</th><th>Quantidade</th><th>Depósito</th>
              {columns.needDate && <th>Necessidade</th>}
              {columns.price && <th>Preço unit.</th>}
              {columns.tax && <th>Imposto</th>}
              {columns.price && <th>Líquido</th>}
              <th aria-label="Remover" />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>{it.item_no ?? (i + 1) * 10}</td>
                <td className="min-w"><Select value={it.material_id} onChange={(v) => set(i, { material_id: v })} options={materials.map(codeName)} /></td>
                <td>
                  <input type="number" min="0" step="0.001" className="input-qty" value={it.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label={`Quantidade do item ${i + 1}`} />
                  <span className="hint small"> {unitOf(it.material_id)}</span>
                </td>
                <td><Select value={it.storage_location_id} placeholder="Padrão" onChange={(v) => set(i, { storage_location_id: v })} options={slocs.map((s) => ({ value: s.id, label: s.code }))} /></td>
                {columns.needDate && <td><input type="date" value={it.need_date} onChange={(e) => set(i, { need_date: e.target.value })} aria-label={`Data de necessidade do item ${i + 1}`} /></td>}
                {columns.price && (
                  <td><input type="number" min="0" step="0.01" className="input-qty" placeholder="automático" value={it.unit_price ?? ''} onChange={(e) => set(i, { unit_price: e.target.value })} aria-label={`Preço do item ${i + 1}`} /></td>
                )}
                {columns.tax && <td><Select value={it.tax_code_id} placeholder="Sem imposto" onChange={(v) => set(i, { tax_code_id: v })} options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} (${t.rate}%)` }))} /></td>}
                {columns.price && <td className="nowrap">{it.unit_price && it.quantity ? fmtMoney(it.unit_price * it.quantity) : <span className="hint small">ao salvar</span>}</td>}
                <td><button type="button" className="btn btn-small btn-danger" onClick={() => remove(i)} aria-label={`Remover item ${i + 1}`}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-small" onClick={add}>+ Item</button>
    </div>
  );
}

/** Converte os itens do formulário no formato da API (campos vazios viram "não informado"). */
export function itemsPayload(items, { price, tax, needDate } = {}) {
  return items.map((it) => ({
    ...(it.item_no ? { item_no: it.item_no } : {}),
    material_id: it.material_id,
    quantity: it.quantity,
    storage_location_id: it.storage_location_id || null,
    ...(needDate ? { need_date: it.need_date } : {}),
    ...(price && it.unit_price !== '' && it.unit_price != null ? { unit_price: it.unit_price } : {}),
    ...(tax ? { tax_code_id: it.tax_code_id || null } : {}),
  }));
}
