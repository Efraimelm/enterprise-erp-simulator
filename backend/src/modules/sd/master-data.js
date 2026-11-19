// Cadastros do SD: clientes (com áreas de venda) e condições comerciais (preços e descontos).
//
//   GET  /api/sd/customers                    SD.CUSTOMER.READ    (q, status, sales_area_id)
//   GET  /api/sd/customers/:id                SD.CUSTOMER.READ    (áreas de venda, pedidos, histórico)
//   POST /api/sd/customers                    SD.CUSTOMER.CREATE
//   PUT  /api/sd/customers/:id                SD.CUSTOMER.UPDATE
//   POST /api/sd/customers/:id/status         SD.CUSTOMER.UPDATE  { status, reason }
//   GET  /api/sd/prices | /api/sd/discounts   SD.PRICE.READ       (material_id, customer_id)
//   POST /api/sd/prices | /api/sd/discounts   SD.PRICE.UPDATE
//   PUT  /api/sd/prices/:id | /discounts/:id  SD.PRICE.UPDATE
//   GET  /api/sd/price-simulation             SD.PRICE.READ       mostra qual preço e desconto valem para um caso
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../middleware/auth.js';
import { history, like, pageSchema, parseId, scopePlants, zDate, zId, zMoney, zOptText, zText } from '../mm/common.js';
import { determineDiscount, determinePrice } from './pricing.js';

const STATUSES = ['ACTIVE', 'BLOCKED', 'INACTIVE'];
const UF = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const zUf = z.preprocess((v) => (v === '' ? null : typeof v === 'string' ? v.toUpperCase() : v), z.string().refine((s) => UF.has(s), 'UF inválida.').nullable().optional());
const zZip = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido.').nullable().optional());
const optId = z.preprocess((v) => (v === '' ? null : v), zId.nullable().optional());
const nullify = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));

const customerSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/, 'Use até 10 letras ou números.'),
  name: zText(80),
  legal_name: zText(120),
  tax_id: zOptText(20),
  street: zOptText(120), city: zOptText(60), state: zUf, zip: zZip,
  ship_to_street: zOptText(120), ship_to_city: zOptText(60), ship_to_state: zUf, ship_to_zip: zZip,
  contact_name: zOptText(80),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().email('E-mail inválido.').max(160).nullable().optional()),
  phone: zOptText(20),
  payment_term_id: optId,
  sales_area_ids: z.array(zId).max(50).default([]),
}).strict();

const validity = {
  valid_from: zDate,
  valid_to: zDate,
  is_active: z.boolean().default(true),
};
const checkValidity = (d) => d.valid_to >= d.valid_from;

const priceSchema = z.object({
  material_id: zId, sales_organization_id: zId, distribution_channel_id: optId, customer_id: optId, price: zMoney, ...validity,
}).strict().refine(checkValidity, { message: 'A validade final deve ser igual ou posterior à inicial.', path: ['valid_to'] });

const discountSchema = z.object({
  sales_organization_id: zId, distribution_channel_id: optId, customer_id: optId, material_id: optId,
  percent: z.coerce.number().min(0, 'Mínimo 0%.').max(100, 'Máximo 100%.'), description: zOptText(120), ...validity,
}).strict().refine(checkValidity, { message: 'A validade final deve ser igual ou posterior à inicial.', path: ['valid_to'] });

export const sdMasterRouter = Router();

/* ───────── Clientes ───────── */

async function setSalesAreas(trx, customerId, ids) {
  const unique = [...new Set(ids)];
  if (unique.length && Number((await trx('sales_areas').whereIn('id', unique).count({ n: '*' }))[0].n) !== unique.length) {
    throw badRequest('Área de vendas inexistente.', [{ field: 'sales_area_ids', message: 'Área de vendas inválida.' }]);
  }
  await trx('customer_sales_areas').where({ customer_id: customerId }).del();
  if (unique.length) await trx('customer_sales_areas').insert(unique.map((a) => ({ customer_id: customerId, sales_area_id: a })));
}

const salesAreasOf = (customerId) =>
  db('customer_sales_areas as ca').join('sales_areas as a', 'a.id', 'ca.sales_area_id')
    .join('sales_organizations as o', 'o.id', 'a.sales_organization_id').join('distribution_channels as c', 'c.id', 'a.distribution_channel_id')
    .join('divisions as d', 'd.id', 'a.division_id')
    .where('ca.customer_id', customerId)
    .select('a.id', 'a.sales_organization_id', 'a.distribution_channel_id', 'a.division_id', 'o.code as sales_org_code', 'c.code as channel_code', 'c.name as channel_name', 'd.code as division_code', 'd.name as division_name')
    .orderBy(['o.code', 'c.code', 'd.code']);

sdMasterRouter.get('/customers', requirePermission('SD.CUSTOMER.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, q: z.string().trim().max(80).optional(), status: z.enum(STATUSES).optional(), sales_area_id: zId.optional() }).parse(req.query);
  const base = db('customers as c').where((qb) => {
    if (f.q) qb.where((w) => w.where('c.code', 'like', like(f.q)).orWhere('c.name', 'like', like(f.q)).orWhere('c.city', 'like', like(f.q)));
    if (f.status) qb.where('c.status', f.status);
    if (f.sales_area_id) qb.whereIn('c.id', db('customer_sales_areas').where('sales_area_id', f.sales_area_id).select('customer_id'));
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone().leftJoin('payment_terms as t', 't.id', 'c.payment_term_id')
    .select('c.*', 't.code as payment_term_code', 't.name as payment_term_name').orderBy('c.code').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

sdMasterRouter.get('/customers/:id', requirePermission('SD.CUSTOMER.READ'), async (req, res) => {
  const id = parseId(req.params.id, 'Cliente');
  const customer = await db('customers as c').leftJoin('payment_terms as t', 't.id', 'c.payment_term_id').where('c.id', id)
    .first('c.*', 't.code as payment_term_code', 't.name as payment_term_name', 't.days as payment_term_days');
  if (!customer) throw notFound('Cliente não encontrado.');
  const orders = req.user.permissions.has('SD.SALES_ORDER.READ')
    ? await scopePlants(db('sales_orders as o'), req, 'o.plant_id').join('plants as p', 'p.id', 'o.plant_id').where('o.customer_id', id)
      .select('o.id', 'o.number', 'o.status', 'o.total_gross', 'o.currency', 'o.created_at', 'p.code as plant_code').orderBy('o.id', 'desc').limit(50)
    : [];
  res.json({ data: { ...customer, sales_areas: await salesAreasOf(id), orders, history: await history('customers', id) } });
});

sdMasterRouter.post('/customers', requirePermission('SD.CUSTOMER.CREATE'), async (req, res) => {
  const { sales_area_ids: areas, ...body } = customerSchema.parse(req.body);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('customers').insert({ ...nullify(body), created_by: req.user.id, updated_by: req.user.id });
    await setSalesAreas(trx, newId, areas);
    await audit(req, { action: 'CREATE', entity: 'customers', entityId: newId, result: 'SUCCESS', details: { novo: body, areas } }, trx);
    return newId;
  });
  res.status(201).json({ data: { ...(await db('customers').where({ id }).first()), sales_areas: await salesAreasOf(id) } });
});

sdMasterRouter.put('/customers/:id', requirePermission('SD.CUSTOMER.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Cliente');
  const { sales_area_ids: areas, ...body } = customerSchema.parse(req.body);
  await db.transaction(async (trx) => {
    const before = await trx('customers').where({ id }).forUpdate().first();
    if (!before) throw notFound('Cliente não encontrado.');
    if (body.code !== before.code) throw badRequest('O código do cliente não pode ser alterado.', [{ field: 'code', message: 'Código fixo.' }]);
    await trx('customers').where({ id }).update({ ...nullify(body), updated_by: req.user.id });
    await setSalesAreas(trx, id, areas);
    await audit(req, { action: 'UPDATE', entity: 'customers', entityId: id, result: 'SUCCESS', details: { alteracoes: diff(before, body), areas } }, trx);
  });
  res.json({ data: { ...(await db('customers').where({ id }).first()), sales_areas: await salesAreasOf(id) } });
});

sdMasterRouter.post('/customers/:id/status', requirePermission('SD.CUSTOMER.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Cliente');
  const { status, reason } = z.object({ status: z.enum(STATUSES), reason: z.string().trim().min(3, 'Informe o motivo.').max(255) }).strict().parse(req.body);
  await db.transaction(async (trx) => {
    const before = await trx('customers').where({ id }).forUpdate().first('status');
    if (!before) throw notFound('Cliente não encontrado.');
    await trx('customers').where({ id }).update({ status, updated_by: req.user.id });
    await audit(req, { action: 'STATUS', entity: 'customers', entityId: id, result: 'SUCCESS', details: { de: before.status, para: status, motivo: reason } }, trx);
  });
  res.json({ data: await db('customers').where({ id }).first() });
});

/* ───────── Condições comerciais ───────── */

function conditionRoutes(path, table, schema, entityLabel) {
  sdMasterRouter.get(`/${path}`, requirePermission('SD.PRICE.READ'), async (req, res) => {
    const f = z.object({ ...pageSchema, material_id: zId.optional(), customer_id: zId.optional(), active: z.enum(['true', 'false']).optional() }).parse(req.query);
    const base = db(`${table} as x`).where((qb) => {
      if (f.material_id) qb.where('x.material_id', f.material_id);
      if (f.customer_id) qb.where('x.customer_id', f.customer_id);
      if (f.active === 'true') qb.where('x.is_active', true);
    });
    const [{ total }] = await base.clone().count({ total: '*' });
    const data = await base.clone()
      .leftJoin('materials as m', 'm.id', 'x.material_id').join('sales_organizations as o', 'o.id', 'x.sales_organization_id')
      .leftJoin('distribution_channels as c', 'c.id', 'x.distribution_channel_id').leftJoin('customers as cu', 'cu.id', 'x.customer_id')
      .select('x.*', 'm.code as material_code', 'm.description as material_description', 'o.code as sales_org_code', 'c.code as channel_code', 'c.name as channel_name', 'cu.code as customer_code', 'cu.name as customer_name')
      .orderBy([{ column: 'm.code', order: 'asc' }, { column: 'x.id', order: 'desc' }]).limit(f.pageSize).offset((f.page - 1) * f.pageSize);
    res.json({ data: data.map((r) => ({ ...r, is_active: !!r.is_active })), page: f.page, pageSize: f.pageSize, total: Number(total) });
  });

  sdMasterRouter.post(`/${path}`, requirePermission('SD.PRICE.UPDATE'), async (req, res) => {
    const body = schema.parse(req.body);
    const id = await db.transaction(async (trx) => {
      const [newId] = await trx(table).insert({ ...nullify(body), created_by: req.user.id, updated_by: req.user.id });
      await audit(req, { action: 'CREATE', entity: table, entityId: newId, result: 'SUCCESS', details: { novo: body } }, trx);
      return newId;
    });
    res.status(201).json({ data: await db(table).where({ id }).first() });
  });

  sdMasterRouter.put(`/${path}/:id`, requirePermission('SD.PRICE.UPDATE'), async (req, res) => {
    const id = parseId(req.params.id, entityLabel);
    const body = schema.parse(req.body);
    await db.transaction(async (trx) => {
      const before = await trx(table).where({ id }).forUpdate().first();
      if (!before) throw notFound(`${entityLabel} não encontrado.`);
      await trx(table).where({ id }).update({ ...nullify(body), updated_by: req.user.id });
      await audit(req, { action: 'UPDATE', entity: table, entityId: id, result: 'SUCCESS', details: { alteracoes: diff(before, body) } }, trx);
    });
    res.json({ data: await db(table).where({ id }).first() });
  });
}
conditionRoutes('prices', 'product_prices', priceSchema, 'Preço');
conditionRoutes('discounts', 'price_discounts', discountSchema, 'Desconto');

sdMasterRouter.get('/price-simulation', requirePermission('SD.PRICE.READ'), async (req, res) => {
  const f = z.object({ material_id: zId, sales_organization_id: zId, distribution_channel_id: zId, customer_id: zId, date: zDate.optional() }).parse(req.query);
  const ctx = { materialId: f.material_id, salesOrgId: f.sales_organization_id, channelId: f.distribution_channel_id, customerId: f.customer_id, date: f.date ?? new Date().toISOString().slice(0, 10) };
  res.json({ data: { price: await determinePrice(db, ctx), discount: await determineDiscount(db, ctx), date: ctx.date } });
});
