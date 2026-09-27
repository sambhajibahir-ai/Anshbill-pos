import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { hashPassword, verifyPassword, signToken, requireAuth, requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';

const publicUser = ({ id, username, name, role, active }) => ({ id, username, name, role, active: !!active });

export default function authRoutes(db) {
  const r = Router();

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  r.post('/login', loginLimiter, (req, res) => {
    const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username.trim());
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Invalid username or password');
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  r.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.active) throw new HttpError(401, 'Account disabled');
    res.json(publicUser(user));
  });

  r.post('/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string(), newPassword: z.string().min(6, 'must be at least 6 characters'),
    }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(currentPassword, user.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
    res.json({ ok: true });
  });

  // ---- user management (admin) ----
  r.get('/users', requireAuth, requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser));
  });

  r.post('/users', requireAuth, requireAdmin, (req, res) => {
    const b = z.object({
      username: z.string().trim().min(3).regex(/^[a-zA-Z0-9_.]+$/, 'letters, digits, _ and . only'),
      name: z.string().trim().min(1),
      password: z.string().min(6, 'must be at least 6 characters'),
      role: z.enum(['admin', 'cashier']),
    }).parse(req.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(b.username, b.name, hashPassword(b.password), b.role);
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)));
  });

  r.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const b = z.object({
      name: z.string().trim().min(1).optional(),
      role: z.enum(['admin', 'cashier']).optional(),
      active: z.boolean().optional(),
      password: z.string().min(6).optional(),
    }).parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw new HttpError(404, 'User not found');
    if (id === req.user.id && (b.active === false || b.role === 'cashier')) {
      throw new HttpError(400, 'You cannot disable or demote your own account');
    }
    db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?').run(
      b.name ?? user.name, b.role ?? user.role, b.active === undefined ? user.active : Number(b.active),
      b.password ? hashPassword(b.password) : user.password_hash, id,
    );
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  return r;
}
