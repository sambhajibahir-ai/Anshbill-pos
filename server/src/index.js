process.env.TZ ||= 'Asia/Kolkata';

const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');

const db = openDb();
const app = createApp(db);
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`AnshBill POS API listening on http://localhost:${port}`);
});
