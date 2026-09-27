import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { getSettings } from '../db.js';
import { isValidGstin, STATES } from '../../../shared/gst.js';

const schema = z.object({
  shop_name: z.string().trim().min(1).max(100),
  shop_address: z.string().trim().max(300),
  shop_phone: z.string().trim().max(30),
  shop_email: z.string().trim().max(100),
  shop_gstin: z.string().trim().toUpperCase().refine((g) => !g || isValidGstin(g), 'invalid GSTIN'),
  shop_state_code: z.string().refine((s) => STATES[s], 'unknown state code'),
  invoice_prefix: z.string().trim().regex(/^[A-Z0-9]{1,4}$/, '1-4 capital letters/digits'),
  invoice_footer: z.string().trim().max(300),
  allow_negative_stock: z.enum(['0', '1']),
}).partial();

export default function settingsRoutes(db) {
  const r = Router();

  r.get('/', async (req, res) => res.json(await getSettings(db)));

  r.put('/', requireAdmin, async (req, res) => {
    const b = schema.parse(req.body);
    // Shop GSTIN fixes the home state for CGST/SGST vs IGST.
    if (b.shop_gstin) b.shop_state_code = b.shop_gstin.slice(0, 2);
    for (const [k, v] of Object.entries(b)) {
      await db`INSERT INTO settings (key, value) VALUES (${k}, ${v}) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`;
    }
    res.json(await getSettings(db));
  });

  return r;
}
