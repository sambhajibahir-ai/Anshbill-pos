import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { hashPassword, verifyPassword, signToken, requireAuth, requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';

const publicUser = ({ id, username, name, role, active }) => ({ id, username, name, role, active: !!active });

export default function authRoutes(db) {
  const r = Router();

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  r.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const rows = await db`SELECT * FROM users WHERE LOWER(username) = LOWER(${username.trim()}) AND active = 1`;
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Invalid username or password');
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  r.get('/me', requireAuth, async (req, res) => {
    const rows = await db`SELECT * FROM users WHERE id = ${req.user.id}`;
    const user = rows[0];
    if (!user || !user.active) throw new HttpError(401, 'Account disabled');
    res.json(publicUser(user));
  });

  r.post('/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string(), newPassword: z.string().min(6, 'must be at least 6 characters'),
    }).parse(req.body);
    const rows = await db`SELECT * FROM users WHERE id = ${req.user.id}`;
    const user = rows[0];
    if (!verifyPassword(currentPassword, user.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    await db`UPDATE users SET password_hash = ${hashPassword(newPassword)} WHERE id = ${user.id}`;
    res.json({ ok: true });
  });

  // ---- user management (admin) ----
  r.get('/users', requireAuth, requireAdmin, async (req, res) => {
    const rows = await db`SELECT * FROM users ORDER BY id`;
    res.json(rows.map(publicUser));
  });

  r.post('/users', requireAuth, requireAdmin, async (req, res) => {
    const b = z.object({
      username: z.string().trim().min(3).regex(/^[a-zA-Z0-9_.]+$/, 'letters, digits, _ and . only'),
      name: z.string().trim().min(1),
      password: z.string().min(6, 'must be at least 6 characters'),
      role: z.enum(['admin', 'cashier']),
    }).parse(req.body);
    const rows = await db`INSERT INTO users (username, name, password_hash, role) VALUES (${b.username}, ${b.name}, ${hashPassword(b.password)}, ${b.role}) RETURNING *`;
    res.status(201).json(publicUser(rows[0]));
  });

  r.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const b = z.object({
      name: z.string().trim().min(1).optional(),
      role: z.enum(['admin', 'cashier']).optional(),
      active: z.boolean().optional(),
      password: z.string().min(6).optional(),
    }).parse(req.body);
    const rows = await db`SELECT * FROM users WHERE id = ${id}`;
    const user = rows[0];
    if (!user) throw new HttpError(404, 'User not found');
    if (id === req.user.id && (b.active === false || b.role === 'cashier')) {
      throw new HttpError(400, 'You cannot disable or demote your own account');
    }
    const updated = await db`UPDATE users SET name = ${b.name ?? user.name}, role = ${b.role ?? user.role}, active = ${b.active === undefined ? user.active : Number(b.active)}, password_hash = ${b.password ? hashPassword(b.password) : user.password_hash} WHERE id = ${id} RETURNING *`;
    res.json(publicUser(updated[0]));
  });

  return r;
}
