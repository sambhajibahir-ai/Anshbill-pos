import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, downloadCsv, todayStr, toRupees } from '../api.js';
import { ErrorNote, Money, PAYMENT_LABELS } from '../components/ui.jsx';

export default function Invoices() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ from: todayStr(), to: todayStr(), q: '', status: '', paymentMode: '' });
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const t = setTimeout(() => api(`/invoices?${qs}`).then(setRows).catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [filters]);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const paid = rows.filter((r) => r.status === 'paid');
  const total = paid.reduce((s, r) => s + r.grandTotal, 0);

  const exportCsv = () => downloadCsv(`invoices_${filters.from}_${filters.to}.csv`, [
    ['Invoice No', 'Date', 'Customer', 'Phone', 'Items', 'Payment', 'Status', 'Total', 'Cashier'],
    ...rows.map((r) => [r.invoiceNo, r.createdAt, r.customerName, r.customerPhone, r.itemCount,
      r.paymentMode, r.status, toRupees(r.grandTotal), r.cashier]),
  ]);

  return (
    <div>
      <div className="page-head">
        <h1>Invoices</h1>
        <div className="actions">
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
          <Link className="btn primary" to="/billing">New bill</Link>
        </div>
      </div>
      <div className="filters card">
        <label>From<input type="date" value={filters.from} onChange={set('from')} /></label>
        <label>To<input type="date" value={filters.to} onChange={set('to')} /></label>
        <label className="grow">Search<input placeholder="Invoice no, customer name or phone" value={filters.q} onChange={set('q')} /></label>
        <label>Payment
          <select value={filters.paymentMode} onChange={set('paymentMode')}>
            <option value="">All</option>
            {Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Status
          <select value={filters.status} onChange={set('status')}>
            <option value="">All</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <ErrorNote error={error} />
      <p className="muted small">{paid.length} paid invoices · <strong><Money v={total} /></strong></p>
      <div className="card flush">
        <table className="table hover">
          <thead>
            <tr><th>Invoice</th><th>Date & time</th><th>Customer</th><th className="c">Items</th><th>Payment</th><th>Cashier</th><th className="r">Total</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/invoices/${r.id}`)} className={r.status === 'cancelled' ? 'row-void' : ''}>
                <td><strong>{r.invoiceNo}</strong> {r.status === 'cancelled' && <span className="badge danger">Cancelled</span>}</td>
                <td>{r.createdAt}</td>
                <td>{r.customerName || <span className="muted">Walk-in</span>} <span className="muted small">{r.customerPhone}</span></td>
                <td className="c">{r.itemCount}</td>
                <td>{PAYMENT_LABELS[r.paymentMode]}</td>
                <td>{r.cashier}</td>
                <td className="r"><Money v={r.grandTotal} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="empty-row">No invoices for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
