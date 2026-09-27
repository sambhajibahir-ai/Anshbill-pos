import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { isValidGstin, STATES } from '../../../shared/gst.js';

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'must be a 10-digit mobile number').optional().nullable().or(z.literal('')),
  gstin: z.string().trim().toUpperCase().refine((g) => !g || isValidGstin(g), 'invalid GSTIN').optional().nullable(),
  stateCode: z.string().refine((s) => !s || STATES[s], 'unknown state code').optional().nullable(),
  address: z.string().trim().max(250).optional().nullable(),
});

const toCustomer = (c) => c && ({
  id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, stateCode: c.state_code, address: c.address,
});

export default function customerRoutes(db) {
  const r = Router();

  r.get('/', async (req, res) => {
    const qs = String(req.query.q || '').trim();
    const rows = qs
      ? await db`SELECT * FROM customers WHERE name ILIKE ${'%' + qs + '%'} OR phone ILIKE ${qs + '%'} OR gstin = ${qs.toUpperCase()} ORDER BY name LIMIT 20`
      : await db`SELECT * FROM customers ORDER BY id DESC LIMIT 200`;
    res.json(rows.map(toCustomer));
  });

  r.post('/', async (req, res) => {
    const b = customerSchema.parse(req.body);
    const stateCode = b.gstin ? b.gstin.slice(0, 2) : b.stateCode || null;
    const rows = await db`INSERT INTO customers (name, phone, gstin, state_code, address) VALUES (${b.name}, ${b.phone || null}, ${b.gstin || null}, ${stateCode}, ${b.address || null}) RETURNING *`;
    res.status(201).json(toCustomer(rows[0]));
  });

  r.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const b = customerSchema.parse(req.body);
    const stateCode = b.gstin ? b.gstin.slice(0, 2) : b.stateCode || null;
    const result = await db`UPDATE customers SET name=${b.name}, phone=${b.phone || null}, gstin=${b.gstin || null}, state_code=${stateCode}, address=${b.address || null} WHERE id=${id} RETURNING *`;
    if (!result.length) throw new HttpError(404, 'Customer not found');
    res.json(toCustomer(result[0]));
  });

  return r;
}
