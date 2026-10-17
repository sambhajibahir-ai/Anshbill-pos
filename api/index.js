import { openDb, initDb } from '../server/src/db.js';
import { createApp } from '../server/src/app.js';

process.env.TZ ||= 'Asia/Kolkata';

let app;
let initPromise;

export default async function handler(req, res) {
  if (!app) {
    // Deduplicate concurrent cold-start requests — only init once.
    if (!initPromise) {
      initPromise = (async () => {
        const db = openDb();   // throws if DATABASE_URL is missing
        await initDb(db);
        app = createApp(db);
      })();
    }
    try {
      await initPromise;
    } catch (err) {
      initPromise = null;      // allow retry on next request
      console.error('Startup error:', err);
      res.status(500).json({ error: 'Server failed to initialise. Check environment variables.' });
      return;
    }
  }
  return app(req, res);
}
