import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadCsv } from '../api.js';
import { useApp } from '../App.jsx';
import { ErrorNote, StockBadge } from '../components/ui.jsx';

export default function StockAlerts() {
  const { refreshAlerts } = useApp();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/products/alerts').then(setRows).catch((e) => setError(e.message));
    refreshAlerts();
  }, [refreshAlerts]);

  if (error) return <ErrorNote error={error} />;
  if (!rows) return <p className="muted">Loading…</p>;

  // Suggest topping up to twice the reorder level
  const suggest = (p) => Math.max(0, +(p.reorderLevel * 2 - p.stock).toFixed(3));

  const exportCsv = () => downloadCsv('reorder_list.csv', [
    ['Product', 'Barcode', 'Category', 'Unit', 'Stock', 'Reorder level', 'Suggested order qty'],
    ...rows.map((p) => [p.name, p.barcode, p.category, p.unit, p.stock, p.reorderLevel, suggest(p)]),
  ]);

  const out = rows.filter((p) => p.stock <= 0).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Stock alerts</h1>
          <p className="muted">{out} out of stock · {rows.length - out} at or below reorder level</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Download reorder list</button>
          <button className="btn" onClick={() => window.print()} disabled={!rows.length}>Print</button>
        </div>
      </div>
      <div className="card flush print-area">
        <table className="table">
          <thead>
            <tr><th>Product</th><th>Category</th><th className="r">In stock</th><th className="r">Reorder level</th><th className="r">Suggested order</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.stock <= 0 ? 'row-danger' : 'row-warn'}>
                <td><strong>{p.name}</strong><div className="muted small mono">{p.barcode}</div></td>
                <td>{p.category || '-'}</td>
                <td className="r num">{p.stock} {p.unit}</td>
                <td className="r num">{p.reorderLevel}</td>
                <td className="r num strong">{suggest(p)} {p.unit}</td>
                <td><StockBadge p={p} /></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="empty-row">All products are above their reorder levels. 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small no-print">
        Set each product's reorder level on the <Link to="/products">Products</Link> page. Record purchases with its <em>Stock</em> button.
      </p>
    </div>
  );
}
