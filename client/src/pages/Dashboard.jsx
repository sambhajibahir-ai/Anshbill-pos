import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatINR } from '@shared/gst.js';
import { useApp } from '../App.jsx';
import { ErrorNote, Money, PAYMENT_LABELS, Stat } from '../components/ui.jsx';

export default function Dashboard() {
  const { user } = useApp();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/reports/dashboard').then(setD).catch((e) => setError(e.message)); }, []);

  if (error) return <ErrorNote error={error} />;
  if (!d) return <p className="muted">Loading…</p>;

  const max = Math.max(...d.last7.map((x) => x.total), 1);
  const t = d.today;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hello, {user.name.split(' ')[0]}</h1>
          <p className="muted">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <Link to="/billing" className="btn primary lg">+ New bill <kbd>F1</kbd></Link>
      </div>

      <div className="stats">
        <Stat label="Today's sales" value={formatINR(t.total)} sub={`${t.invoices} bills`} />
        <Stat label="Average bill" value={formatINR(t.avgBill)} />
        <Stat label="GST collected today" value={formatINR(t.cgst + t.sgst + t.igst)} sub={`on ${formatINR(t.taxable)} taxable`} />
        <Link to="/stock-alerts" className="stat-link">
          <Stat label="Stock alerts" tone={d.stock.outOfStock + d.stock.lowStock ? 'danger' : ''}
            value={(d.stock.outOfStock || 0) + (d.stock.lowStock || 0)}
            sub={`${d.stock.outOfStock || 0} out of stock · ${d.stock.lowStock || 0} low`} />
        </Link>
      </div>

      <div className="grid-2-1">
        <div className="card">
          <h3>Last 7 days</h3>
          <div className="bars" role="img" aria-label="Sales for the last 7 days">
            {d.last7.map((x) => (
              <div key={x.date} className="bar-col" title={`${x.date}: ${formatINR(x.total)} (${x.invoices} bills)`}>
                <span className="bar-val">{x.total ? formatINR(x.total).replace(/\.\d+$/, '') : ''}</span>
                <div className="bar" style={{ height: `${(x.total / max) * 100}%` }} />
                <span className="bar-label">{new Date(x.date).toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Inventory</h3>
          <div className="trow"><span>Active products</span><strong>{d.stock.products}</strong></div>
          <div className="trow"><span>Stock value (at cost)</span><Money v={d.stock.stockValue} /></div>
          <div className="trow"><span>Out of stock</span><strong className="text-danger">{d.stock.outOfStock || 0}</strong></div>
          <div className="trow"><span>Below reorder level</span><strong className="text-warn">{d.stock.lowStock || 0}</strong></div>
        </div>
      </div>

      <div className="card flush">
        <h3 className="pad">Recent invoices</h3>
        <table className="table">
          <thead><tr><th>Invoice</th><th>Time</th><th>Customer</th><th>Payment</th><th className="r">Total</th></tr></thead>
          <tbody>
            {d.recent.map((r) => (
              <tr key={r.id} className={r.status === 'cancelled' ? 'row-void' : ''}>
                <td><Link to={`/invoices/${r.id}`}>{r.invoiceNo}</Link></td>
                <td>{r.createdAt}</td>
                <td>{r.customerName || <span className="muted">Walk-in</span>}</td>
                <td>{PAYMENT_LABELS[r.paymentMode]}</td>
                <td className="r"><Money v={r.grandTotal} /></td>
              </tr>
            ))}
            {!d.recent.length && <tr><td colSpan={5} className="empty-row">No sales yet. <Link to="/billing">Create your first bill</Link>.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
