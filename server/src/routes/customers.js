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

  r.get('/', (req, res) => {
    const q = String(req.query.q || '').trim();
    const rows = q
      ? db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR gstin = ? ORDER BY name LIMIT 20')
        .all(`%${q}%`, `${q}%`, q.toUpperCase())
      : db.prepare('SELECT * FROM customers ORDER BY id DESC LIMIT 200').all();
    res.json(rows.map(toCustomer));
  });

  r.post('/', (req, res) => {
    const b = customerSchema.parse(req.body);
    const stateCode = b.gstin ? b.gstin.slice(0, 2) : b.stateCode || null;
    const { lastInsertRowid } = db.prepare('INSERT INTO customers (name, phone, gstin, state_code, address) VALUES (?, ?, ?, ?, ?)')
      .run(b.name, b.phone || null, b.gstin || null, stateCode, b.address || null);
    res.status(201).json(toCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(lastInsertRowid)));
  });

  r.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const b = customerSchema.parse(req.body);
    const stateCode = b.gstin ? b.gstin.slice(0, 2) : b.stateCode || null;
    const { changes } = db.prepare('UPDATE customers SET name=?, phone=?, gstin=?, state_code=?, address=? WHERE id=?')
      .run(b.name, b.phone || null, b.gstin || null, stateCode, b.address || null, id);
    if (!changes) throw new HttpError(404, 'Customer not found');
    res.json(toCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(id)));
  });

  return r;
}
