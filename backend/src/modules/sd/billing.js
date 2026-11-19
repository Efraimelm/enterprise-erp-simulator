// Faturamento (pela entrega), estorno, contas a receber e pagamentos (simulados).
//
//   GET  /api/sd/billing[/:id]                      SD.BILLING.READ
//   POST /api/sd/billing                            SD.BILLING.CREATE   { delivery_id, billing_date? } → fatura + título
//   POST /api/sd/billing/:id/cancel                 SD.BILLING.CANCEL   { reason } → documento de estorno
//   GET  /api/sd/receivables[/:id]                  SD.RECEIVABLE.READ  (status, overdue, customer_id)
//   POST /api/sd/receivables/:id/payments           SD.PAYMENT.POST     { amount, payment_date, method, notes? }
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, HttpError } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numbering.js';
import { money } from '../../lib/numbers.js';
import { withTransaction } from '../../lib/tx.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertPlant, findScoped, pageSchema, parseId, scopePlants, zDate, zId, zMoney, zOptText } from '../mm/common.js';
import { invalidStatus, refreshOrderStatus } from './sales-orders.js';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

async function billingDetail(req, id, trx = db) {
  const b = await findScoped(req, 'billing_documents', id, { trx, what: 'Documento de faturamento' });
  const [extra] = await trx('billing_documents as b').join('sales_orders as o', 'o.id', 'b.sales_order_id').join('deliveries as d', 'd.id', 'b.delivery_id')
    .join('customers as c', 'c.id', 'b.customer_id').join('plants as p', 'p.id', 'b.plant_id').join('users as u', 'u.id', 'b.created_by')
    .leftJoin('billing_documents as r', 'r.id', 'b.reference_billing_id')
    .where('b.id', id)
    .select('o.number as sales_order_number', 'd.number as delivery_number', 'c.code as customer_code', 'c.name as customer_name', 'p.code as plant_code',
      'u.username as created_by_username', 'r.number as reference_number');
  const items = await trx('billing_items as i').join('materials as m', 'm.id', 'i.material_id').join('sales_order_items as si', 'si.id', 'i.sales_order_item_id')
    .where('i.billing_document_id', id).select('i.*', 'm.code as material_code', 'm.description', 'm.base_unit', 'si.item_no as so_item_no').orderBy('si.item_no');
  const cancellation = await trx('billing_documents').where({ reference_billing_id: id }).first('id', 'number', 'created_at', 'reason');
  const receivable = await trx('accounts_receivable').where({ billing_document_id: id }).first();
  return { ...b, ...extra, items, cancellation: cancellation ?? null, receivable: receivable ?? null };
}

export const billingRouter = Router();

billingRouter.get('/billing', requirePermission('SD.BILLING.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, plant_id: zId.optional(), customer_id: zId.optional(), type: z.enum(['INVOICE', 'CANCELLATION']).optional(), status: z.enum(['ACTIVE', 'CANCELLED']).optional() }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('billing_documents as b'), req, 'b.plant_id').where((qb) => {
    for (const k of ['plant_id', 'customer_id', 'type', 'status']) if (f[k]) qb.where(`b.${k}`, f[k]);
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone().join('customers as c', 'c.id', 'b.customer_id').join('sales_orders as o', 'o.id', 'b.sales_order_id').join('deliveries as d', 'd.id', 'b.delivery_id')
    .select('b.*', 'c.name as customer_name', 'o.number as sales_order_number', 'd.number as delivery_number')
    .orderBy('b.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

billingRouter.get('/billing/:id', requirePermission('SD.BILLING.READ'), async (req, res) => {
  res.json({ data: await billingDetail(req, parseId(req.params.id, 'Documento de faturamento')) });
});

billingRouter.post('/billing', requirePermission('SD.BILLING.CREATE'), async (req, res) => {
  const body = z.object({ delivery_id: zId, billing_date: zDate.optional() }).strict().parse(req.body);
  const data = await withTransaction(async (trx) => {
    const d = await findScoped(req, 'deliveries', body.delivery_id, { trx, lock: true, what: 'Entrega' });
    if (d.status !== 'POSTED') throw invalidStatus(d.number, d.status, 'faturar (a saída de mercadoria precisa estar lançada)');
    const already = await trx('billing_documents').where({ delivery_id: d.id, type: 'INVOICE', status: 'ACTIVE' }).first('number');
    if (already) throw new HttpError(409, 'ALREADY_BILLED', `A entrega ${d.number} já foi faturada na fatura ${already.number}.`);
    const so = await trx('sales_orders').where({ id: d.sales_order_id }).forUpdate().first();
    const delItems = (await trx('delivery_items').where({ delivery_id: d.id })).filter((i) => i.picked_qty > 0);
    const soItems = await trx('sales_order_items').where({ sales_order_id: so.id });

    const rows = delItems.map((di) => {
      const si = soItems.find((s) => s.id === di.sales_order_item_id);
      const list = money(di.picked_qty * si.unit_price);
      const discount = money((list * si.discount_pct) / 100);
      const net = money(list - discount);
      return {
        sales_order_item_id: si.id, delivery_item_id: di.id, material_id: di.material_id, quantity: di.picked_qty,
        unit_price: si.unit_price, discount_amount: discount, net_amount: net, tax_rate: si.tax_rate, tax_amount: money((net * si.tax_rate) / 100),
      };
    });
    const totalNet = money(rows.reduce((s, r) => s + r.net_amount, 0));
    const totalTax = money(rows.reduce((s, r) => s + r.tax_amount, 0));
    const billingDate = body.billing_date ?? today();
    const number = await nextNumber(trx, 'BILLING');
    const [id] = await trx('billing_documents').insert({
      number, type: 'INVOICE', sales_order_id: so.id, delivery_id: d.id, customer_id: so.customer_id, plant_id: so.plant_id, currency: so.currency,
      billing_date: billingDate, total_net: totalNet, total_tax: totalTax, total_gross: money(totalNet + totalTax), created_by: req.user.id,
    });
    await trx('billing_items').insert(rows.map((r) => ({ ...r, billing_document_id: id })));
    for (const r of rows) await trx('sales_order_items').where({ id: r.sales_order_item_id }).update({ billed_qty: trx.raw('billed_qty + ?', [r.quantity]) });

    const days = so.payment_term_id ? (await trx('payment_terms').where({ id: so.payment_term_id }).first('days'))?.days ?? 0 : 0;
    await trx('accounts_receivable').insert({
      billing_document_id: id, customer_id: so.customer_id, plant_id: so.plant_id, currency: so.currency,
      amount: money(totalNet + totalTax), issue_date: billingDate, due_date: addDays(billingDate, days),
    });
    const status = await refreshOrderStatus(trx, so.id);
    await audit(req, { action: 'BILLING', entity: 'billing_documents', entityId: id, result: 'SUCCESS', details: { numero: number, entrega: d.number, pedido: so.number, total: money(totalNet + totalTax), status_pedido: status } }, trx);
    return billingDetail(req, id, trx);
  });
  res.status(201).json({ data });
});

billingRouter.post('/billing/:id/cancel', requirePermission('SD.BILLING.CANCEL'), async (req, res) => {
  const id = parseId(req.params.id, 'Documento de faturamento');
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Informe o motivo.').max(255) }).strict().parse(req.body);
  const data = await withTransaction(async (trx) => {
    const b = await findScoped(req, 'billing_documents', id, { trx, lock: true, what: 'Documento de faturamento' });
    if (b.type !== 'INVOICE' || b.status !== 'ACTIVE') throw invalidStatus(b.number, `${b.type}/${b.status}`, 'estornar');
    const ar = await trx('accounts_receivable').where({ billing_document_id: id }).forUpdate().first();
    if (ar && ar.paid_amount > 0) throw new HttpError(409, 'HAS_PAYMENTS', `O título da fatura ${b.number} já recebeu pagamento: não é possível estornar.`);
    const items = await trx('billing_items').where({ billing_document_id: id });
    const number = await nextNumber(trx, 'BILLING');
    const [cancelId] = await trx('billing_documents').insert({
      number, type: 'CANCELLATION', status: 'ACTIVE', sales_order_id: b.sales_order_id, delivery_id: b.delivery_id, customer_id: b.customer_id,
      plant_id: b.plant_id, reference_billing_id: b.id, currency: b.currency, billing_date: today(),
      total_net: -b.total_net, total_tax: -b.total_tax, total_gross: -b.total_gross, reason, created_by: req.user.id,
    });
    await trx('billing_items').insert(items.map(({ id: _id, billing_document_id: _b, ...i }) => ({
      ...i, billing_document_id: cancelId, quantity: -i.quantity, discount_amount: -i.discount_amount, net_amount: -i.net_amount, tax_amount: -i.tax_amount,
    })));
    for (const i of items) await trx('sales_order_items').where({ id: i.sales_order_item_id }).update({ billed_qty: trx.raw('billed_qty - ?', [i.quantity]) });
    await trx('billing_documents').where({ id }).update({ status: 'CANCELLED', reason });
    if (ar) await trx('accounts_receivable').where({ id: ar.id }).update({ status: 'CANCELLED' });
    await refreshOrderStatus(trx, b.sales_order_id);
    await audit(req, { action: 'CANCEL', entity: 'billing_documents', entityId: id, result: 'SUCCESS', details: { fatura: b.number, estorno: number, motivo: reason } }, trx);
    return billingDetail(req, cancelId, trx);
  });
  res.json({ data });
});

/* ───────── Contas a receber (simulado) ───────── */

const withComputed = (r) => ({
  ...r,
  open_amount: money(r.amount - r.paid_amount),
  overdue: ['OPEN', 'PARTIALLY_PAID'].includes(r.status) && r.due_date < today(),
});

billingRouter.get('/receivables', requirePermission('SD.RECEIVABLE.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, status: z.enum(['OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']).optional(), overdue: z.enum(['true', 'false']).optional(), open: z.enum(['true', 'false']).optional(), customer_id: zId.optional(), plant_id: zId.optional() }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('accounts_receivable as r'), req, 'r.plant_id').where((qb) => {
    if (f.status) qb.where('r.status', f.status);
    if (f.customer_id) qb.where('r.customer_id', f.customer_id);
    if (f.plant_id) qb.where('r.plant_id', f.plant_id);
    if (f.open === 'true' || f.overdue === 'true') qb.whereIn('r.status', ['OPEN', 'PARTIALLY_PAID']);
    if (f.overdue === 'true') qb.where('r.due_date', '<', today());
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const [{ open_total: openTotal }] = await base.clone().whereIn('r.status', ['OPEN', 'PARTIALLY_PAID']).sum({ open_total: db.raw('r.amount - r.paid_amount') });
  const rows = await base.clone().join('billing_documents as b', 'b.id', 'r.billing_document_id').join('customers as c', 'c.id', 'r.customer_id').join('sales_orders as o', 'o.id', 'b.sales_order_id')
    .select('r.*', 'b.number as billing_number', 'c.code as customer_code', 'c.name as customer_name', 'o.number as sales_order_number')
    .orderBy([{ column: 'r.due_date', order: 'asc' }, { column: 'r.id', order: 'asc' }]).limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data: rows.map(withComputed), page: f.page, pageSize: f.pageSize, total: Number(total), meta: { open_total: money(openTotal ?? 0) } });
});

billingRouter.get('/receivables/:id', requirePermission('SD.RECEIVABLE.READ'), async (req, res) => {
  const r = await findScoped(req, 'accounts_receivable', parseId(req.params.id, 'Título'), { what: 'Título' });
  const [extra] = await db('accounts_receivable as r').join('billing_documents as b', 'b.id', 'r.billing_document_id').join('customers as c', 'c.id', 'r.customer_id')
    .join('sales_orders as o', 'o.id', 'b.sales_order_id').where('r.id', r.id)
    .select('b.number as billing_number', 'b.sales_order_id', 'o.number as sales_order_number', 'c.code as customer_code', 'c.name as customer_name');
  const payments = await db('payments as p').join('users as u', 'u.id', 'p.created_by').where('p.receivable_id', r.id).select('p.*', 'u.username as created_by_username').orderBy('p.id');
  res.json({ data: { ...withComputed(r), ...extra, payments } });
});

billingRouter.post('/receivables/:id/payments', requirePermission('SD.PAYMENT.POST'), async (req, res) => {
  const id = parseId(req.params.id, 'Título');
  const body = z.object({
    amount: zMoney.refine((v) => v > 0, 'O valor deve ser maior que zero.'),
    payment_date: zDate.refine((d) => d <= today(), 'A data do pagamento não pode estar no futuro.'),
    method: z.enum(['PIX', 'BOLETO', 'TRANSFER'], { message: 'Forma de pagamento inválida.' }),
    notes: zOptText(255),
  }).strict().parse(req.body);
  const data = await withTransaction(async (trx) => {
    const r = await findScoped(req, 'accounts_receivable', id, { trx, lock: true, what: 'Título' });
    if (!['OPEN', 'PARTIALLY_PAID'].includes(r.status)) throw invalidStatus(`título ${id}`, r.status, 'receber pagamento');
    const open = money(r.amount - r.paid_amount);
    if (body.amount > open + 1e-9) throw badRequest(`Valor acima do saldo em aberto (${open.toFixed(2)}).`, [{ field: 'amount', message: `Máximo ${open.toFixed(2)}.` }]);
    const number = await nextNumber(trx, 'PAYMENT');
    await trx('payments').insert({ number, receivable_id: id, amount: body.amount, payment_date: body.payment_date, method: body.method, notes: body.notes ?? null, created_by: req.user.id });
    const paid = money(r.paid_amount + body.amount);
    const status = paid + 1e-9 >= r.amount ? 'PAID' : 'PARTIALLY_PAID';
    await trx('accounts_receivable').where({ id }).update({ paid_amount: paid, status });
    await audit(req, { action: 'PAYMENT', entity: 'accounts_receivable', entityId: id, result: 'SUCCESS', details: { pagamento: number, valor: body.amount, forma: body.method, status } }, trx);
    const updated = await trx('accounts_receivable').where({ id }).first();
    return { ...withComputed(updated), payment_number: number };
  });
  res.status(201).json({ data });
});
