import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { requireAuth } from './auth.js';
import { HttpError } from './errors.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import customerRoutes from './routes/customers.js';
import invoiceRoutes from './routes/invoices.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';

export function createApp(db) {
  const app = express();
  app.set('db', db);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'desktop-offline' }));
  app.use('/api/auth', authRoutes(db));
  app.use('/api', requireAuth);
  app.use('/api/products', productRoutes(db));
  app.use('/api/customers', customerRoutes(db));
  app.use('/api/invoices', invoiceRoutes(db));
  app.use('/api/reports', reportRoutes(db));
  app.use('/api/settings', settingsRoutes(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ZodError) {
      const i = err.issues[0];
      return res.status(400).json({ error: `${i.path.join('.') || 'input'}: ${i.message}` });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (String(err.message).includes('UNIQUE constraint failed')) {
      const field = err.message.split('.').pop() || 'field';
      return res.status(409).json({ error: `A record with this ${field} already exists` });
    }
    console.error('[Desktop Server Error]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
