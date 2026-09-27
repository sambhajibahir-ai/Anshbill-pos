import { openDb, initDb } from '../server/src/db.js';
import { createApp } from '../server/src/app.js';

process.env.TZ ||= 'Asia/Kolkata';

let app;

export default async function handler(req, res) {
  if (!app) {
    const db = openDb();
    await initDb(db);
    app = createApp(db);
  }
  return app(req, res);
}
