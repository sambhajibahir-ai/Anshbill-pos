import { useEffect, useState } from 'react';
import { api, downloadCsv, todayStr, toRupees } from '../api.js';
import { formatINR } from '@shared/gst.js';
import { useApp } from '../App.jsx';
import { ErrorNote, Money, PAYMENT_LABELS, Stat } from '../components/ui.jsx';

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return todayStr(d); };

export default function Reports() {
  const { settings } = useApp();
  const [mode, setMode] = useState('daily');
  const [date, setDate] = useState(todayStr());
  const [range, setRange] = useState({ from: daysAgo(6), to: todayStr() });
  const [r, setR] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    const url = mode === 'daily' ? `/reports/daily?date=${date}` : `/reports/range?from=${range.from}&to=${range.to}`;
    api(url).then(setR).catch((e) => setError(e.message));
  }, [mode, date, range]);

  const exportCsv = () => {
    const s = r.summary;
    const rows = [
      [`${settings.shop_name} - Sales report ${r.from} to ${r.to}`], [],
      ['Summary'], ['Invoices', s.invoices], ['Gross', toRupees(s.gross)], ['Discount', toRupees(s.discount)],
      ['Taxable value', toRupees(s.taxable)], ['CGST', toRupees(s.cgst)], ['SGST', toRupees(s.sgst)], ['IGST', toRupees(s.igst)],
      ['Round off', toRupees(s.roundOff)], ['Net sales', toRupees(s.total)], ['Cancelled invoices', r.cancelled.count], [],
      ['Payment mode', 'Bills', 'Amount'], ...r.byPayment.map((p) => [PAYMENT_LABELS[p.mode], p.count, toRupees(p.total)]), [],
      ['GST rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
      ...r.gstByRate.map((g) => [g.rate, toRupees(g.taxable), toRupees(g.cgst), toRupees(g.sgst), toRupees(g.igst), toRupees(g.total)]), [],
      ['HSN', 'GST %', 'Qty', 'Taxable', 'CGST', 'SGST', 'IGST'],
      ...r.hsn.map((h) => [h.hsn, h.rate, h.qty, toRupees(h.taxable), toRupees(h.cgst), toRupees(h.sgst), toRupees(h.igst)]), [],
      ['Top products', 'Qty', 'Amount'], ...r.topProducts.map((p) => [p.name, p.qty, toRupees(p.total)]),
    ];
    if (r.days) rows.push([], ['Date', 'Bills', 'Taxable', 'Tax', 'Total'], ...r.days.map((d) => [d.date, d.invoices, toRupees(d.taxable), toRupees(d.tax), toRupees(d.total)]));
    downloadCsv(`sales_report_${r.from}_${r.to}.csv`, rows);
  };

  return (
    <div>
      <div className="page-head no-print">
        <h1>Sales reports</h1>
        <div className="actions">
          <button className="btn" onClick={exportCsv} disabled={!r}>Export CSV</button>
          <button className="btn" onClick={() => window.print()} disabled={!r}>Print</button>
        </div>
      </div>
      <div className="filters card no-print">
        <div className="seg">
          <button className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>Daily</button>
          <button className={mode === 'range' ? 'active' : ''} onClick={() => setMode('range')}>Date range</button>
        </div>
        {mode === 'daily' ? (
          <>
            <button className="btn sm" onClick={() => setDate(daysAgo(1))}>Yesterday</button>
            <button className="btn sm" onClick={() => setDate(todayStr())}>Today</button>
            <label>Date<input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} /></label>
          </>
        ) : (
          <>
            <button className="btn sm" onClick={() => setRange({ from: daysAgo(6), to: todayStr() })}>7 days</button>
            <button className="btn sm" onClick={() => setRange({ from: todayStr().slice(0, 8) + '01', to: todayStr() })}>This month</button>
            <label>From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
            <label>To<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          </>
        )}
      </div>
      <ErrorNote error={error} />
      {r && <Report r={r} settings={settings} />}
    </div>
  );
}

function Report({ r, settings }) {
  const s = r.summary;
  const hourMax = Math.max(...r.hourly.map((h) => h.total), 1);
  return (
    <div className="print-area report">
      <div className="print-only report-title">
        <h2>{settings.shop_name}</h2>
        <p>Sales report: {r.from === r.to ? r.from : `${r.from} to ${r.to}`}</p>
      </div>
      <div className="stats">
        <Stat label="Net sales" value={formatINR(s.total)} sub={`${s.invoices} bills · avg ${formatINR(s.avgBill)}`} />
        <Stat label="Taxable value" value={formatINR(s.taxable)} sub={`discount ${formatINR(s.discount)}`} />
        <Stat label="GST collected" value={formatINR(s.tax)} sub={s.igst ? `IGST ${formatINR(s.igst)}` : `CGST + SGST`} />
        <Stat label="Est. gross margin" value={formatINR(s.grossMargin)}
          sub={s.taxable ? `${((s.grossMargin / s.taxable) * 100).toFixed(1)}% of taxable` : '-'} tone={s.grossMargin < 0 ? 'danger' : ''} />
      </div>
      {r.cancelled.count > 0 && (
        <p className="small text-warn">{r.cancelled.count} cancelled invoice(s) worth {formatINR(r.cancelled.total)} are left out of these figures.</p>
      )}

      <div className="grid-2">
        <div className="card">
          <h3>Payment modes</h3>
          <table className="table compact">
            <thead><tr><th>Mode</th><th className="r">Bills</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {r.byPayment.map((p) => (
                <tr key={p.mode}><td>{PAYMENT_LABELS[p.mode]}</td><td className="r">{p.count}</td><td className="r"><Money v={p.total} /></td></tr>
              ))}
              {!r.byPayment.length && <tr><td colSpan={3} className="empty-row">No sales</td></tr>}
            </tbody>
          </table>
          {r.byCashier.length > 1 && (
            <>
              <h3>By cashier</h3>
              <table className="table compact">
                <tbody>
                  {r.byCashier.map((c) => <tr key={c.name}><td>{c.name}</td><td className="r">{c.count}</td><td className="r"><Money v={c.total} /></td></tr>)}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="card">
          <h3>GST summary by rate</h3>
          <table className="table compact">
            <thead><tr><th>Rate</th><th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th></tr></thead>
            <tbody>
              {r.gstByRate.map((g) => (
                <tr key={g.rate}><td>{g.rate}%</td><td className="r"><Money v={g.taxable} /></td><td className="r"><Money v={g.cgst} /></td>
                  <td className="r"><Money v={g.sgst} /></td><td className="r"><Money v={g.igst} /></td></tr>
              ))}
            </tbody>
            {r.gstByRate.length > 0 && (
              <tfoot><tr><th>Total</th><th className="r"><Money v={s.taxable} /></th><th className="r"><Money v={s.cgst} /></th>
                <th className="r"><Money v={s.sgst} /></th><th className="r"><Money v={s.igst} /></th></tr></tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Top selling products</h3>
          <table className="table compact">
            <thead><tr><th>#</th><th>Product</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {r.topProducts.map((p, i) => (
                <tr key={p.productId}><td>{i + 1}</td><td>{p.name}</td><td className="r">{+p.qty.toFixed(3)} {p.unit}</td><td className="r"><Money v={p.total} /></td></tr>
              ))}
              {!r.topProducts.length && <tr><td colSpan={4} className="empty-row">No sales</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Sales by hour</h3>
          {r.hourly.length ? (
            <div className="hbars">
              {r.hourly.map((h) => (
                <div key={h.hour} className="hbar-row">
                  <span className="muted small">{String(h.hour).padStart(2, '0')}:00</span>
                  <div className="hbar-track"><div className="hbar" style={{ width: `${(h.total / hourMax) * 100}%` }} /></div>
                  <span className="small num">{formatINR(h.total)} · {h.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No sales</p>}
        </div>
      </div>

      <div className="card">
        <h3>HSN-wise summary <span className="muted small">(for GSTR-1)</span></h3>
        <table className="table compact">
          <thead><tr><th>HSN</th><th className="r">GST %</th><th className="r">Qty</th><th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th></tr></thead>
          <tbody>
            {r.hsn.map((h) => (
              <tr key={`${h.hsn}-${h.rate}`}><td>{h.hsn}</td><td className="r">{h.rate}</td><td className="r">{+h.qty.toFixed(3)}</td>
                <td className="r"><Money v={h.taxable} /></td><td className="r"><Money v={h.cgst} /></td>
                <td className="r"><Money v={h.sgst} /></td><td className="r"><Money v={h.igst} /></td></tr>
            ))}
            {!r.hsn.length && <tr><td colSpan={7} className="empty-row">No sales</td></tr>}
          </tbody>
        </table>
      </div>

      {r.days && (
        <div className="card">
          <h3>Day-wise sales</h3>
          <table className="table compact">
            <thead><tr><th>Date</th><th className="r">Bills</th><th className="r">Taxable</th><th className="r">GST</th><th className="r">Total</th></tr></thead>
            <tbody>
              {r.days.map((d) => (
                <tr key={d.date}><td>{d.date}</td><td className="r">{d.invoices}</td><td className="r"><Money v={d.taxable} /></td>
                  <td className="r"><Money v={d.tax} /></td><td className="r"><Money v={d.total} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
