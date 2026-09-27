import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatINR, STATES } from '@shared/gst.js';
import { useApp } from '../App.jsx';
import { ErrorNote, Modal, PAYMENT_LABELS } from '../components/ui.jsx';

const fmt = (p) => formatINR(p, { symbol: false });
const qtyFmt = (q) => (Number.isInteger(q) ? q : q.toFixed(3));

export default function InvoiceView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const navigate = useNavigate();
  const { settings, isAdmin, refreshAlerts } = useApp();
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [format, setFormat] = useState(() => localStorage.getItem('anshbill.printFormat') || 'a4');
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => { api(`/invoices/${id}`).then(setInv).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => { localStorage.setItem('anshbill.printFormat', format); }, [format]);

  useEffect(() => {
    if (!isNew) return;
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'F1') { e.preventDefault(); navigate('/billing'); }
      if (e.key === 'p' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNew, navigate]);

  if (error) return <ErrorNote error={error} />;
  if (!inv) return <p className="muted">Loading…</p>;

  const cancelled = inv.status === 'cancelled';

  return (
    <div>
      <div className="page-head no-print">
        <div>
          <Link to="/invoices" className="muted small">← Invoices</Link>
          <h1>{inv.invoiceNo} {cancelled && <span className="badge danger">Cancelled</span>}</h1>
        </div>
        <div className="actions">
          <div className="seg">
            <button className={format === 'a4' ? 'active' : ''} onClick={() => setFormat('a4')}>A4 invoice</button>
            <button className={format === 'thermal' ? 'active' : ''} onClick={() => setFormat('thermal')}>80mm receipt</button>
          </div>
          <button className="btn primary" onClick={() => window.print()}>Print</button>
          {isAdmin && !cancelled && <button className="btn danger-outline" onClick={() => setCancelOpen(true)}>Cancel invoice</button>}
        </div>
      </div>

      {isNew && (
        <div className="alert success no-print sale-done">
          <div>
            <strong>Sale complete: {formatINR(inv.totals.grandTotal)}</strong>
            {inv.change > 0 && <span> · Return change <strong>{formatINR(inv.change)}</strong></span>}
          </div>
          <button className="btn primary" onClick={() => navigate('/billing')}>New bill <kbd>Enter</kbd></button>
        </div>
      )}
      {cancelled && <div className="alert error no-print">Cancelled: {inv.cancelReason}</div>}

      <div className="print-area">
        {format === 'a4' ? <A4Invoice inv={inv} s={settings} /> : <ThermalReceipt inv={inv} s={settings} />}
      </div>

      {cancelOpen && (
        <CancelDialog inv={inv} onClose={() => setCancelOpen(false)}
          onDone={(updated) => { setInv(updated); setCancelOpen(false); refreshAlerts(); }} />
      )}
    </div>
  );
}

function CancelDialog({ inv, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone(await api(`/invoices/${inv.id}/cancel`, { method: 'POST', body: { reason } }));
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={`Cancel ${inv.invoiceNo}?`} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">Stock for all items goes back to inventory. The invoice stays on record as cancelled, which GST record-keeping requires.</p>
        <label>Reason<input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></label>
        <ErrorNote error={error} />
        <div className="actions end">
          <button type="button" className="btn ghost" onClick={onClose}>Keep invoice</button>
          <button className="btn danger">Cancel invoice</button>
        </div>
      </form>
    </Modal>
  );
}

function A4Invoice({ inv, s }) {
  const t = inv.totals;
  return (
    <article className={`invoice a4 ${inv.status === 'cancelled' ? 'void' : ''}`}>
      <header className="inv-head">
        <div>
          <h2>{s.shop_name}</h2>
          <p className="pre">{s.shop_address}</p>
          {s.shop_phone && <p>Phone: {s.shop_phone}{s.shop_email && ` · ${s.shop_email}`}</p>}
          {s.shop_gstin && <p><strong>GSTIN: {s.shop_gstin}</strong></p>}
          <p>State: {STATES[s.shop_state_code]} ({s.shop_state_code})</p>
        </div>
        <div className="inv-title">
          <h3>TAX INVOICE</h3>
          <table>
            <tbody>
              <tr><td>Invoice No</td><td><strong>{inv.invoiceNo}</strong></td></tr>
              <tr><td>Date</td><td>{inv.createdAt}</td></tr>
              <tr><td>Place of supply</td><td>{inv.placeOfSupplyName} ({inv.placeOfSupply})</td></tr>
              <tr><td>Payment</td><td>{PAYMENT_LABELS[inv.paymentMode]}</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      <section className="bill-to">
        <strong>Bill to:</strong> {inv.customer.name || 'Walk-in customer'}
        {inv.customer.phone && ` · ${inv.customer.phone}`}
        {inv.customer.gstin && <> · GSTIN: <strong>{inv.customer.gstin}</strong></>}
      </section>

      <table className="inv-items">
        <thead>
          <tr>
            <th>#</th><th>Item</th><th>HSN</th><th className="r">Qty</th><th className="r">Rate</th>
            <th className="r">Disc</th><th className="r">Taxable</th><th className="r">GST %</th>
            {inv.interState ? <th className="r">IGST</th> : <><th className="r">CGST</th><th className="r">SGST</th></>}
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td><td>{it.name}</td><td>{it.hsn || '-'}</td>
              <td className="r">{qtyFmt(it.qty)} {it.unit}</td><td className="r">{fmt(it.price)}</td>
              <td className="r">{it.discount ? fmt(it.discount) : '-'}</td><td className="r">{fmt(it.taxable)}</td>
              <td className="r">{it.gstRate}</td>
              {inv.interState ? <td className="r">{fmt(it.igst)}</td> : <><td className="r">{fmt(it.cgst)}</td><td className="r">{fmt(it.sgst)}</td></>}
              <td className="r">{fmt(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inv-bottom">
        <div>
          <table className="hsn-table">
            <thead>
              <tr><th>HSN</th><th className="r">Taxable</th><th className="r">Rate</th>
                {inv.interState ? <th className="r">IGST</th> : <><th className="r">CGST</th><th className="r">SGST</th></>}
              </tr>
            </thead>
            <tbody>
              {inv.hsnSummary.map((h, i) => (
                <tr key={i}>
                  <td>{h.hsn}</td><td className="r">{fmt(h.taxable)}</td><td className="r">{h.gstRate}%</td>
                  {inv.interState ? <td className="r">{fmt(h.igst)}</td> : <><td className="r">{fmt(h.cgst)}</td><td className="r">{fmt(h.sgst)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="words"><strong>Amount in words:</strong> {inv.amountInWords}</p>
        </div>
        <table className="inv-totals">
          <tbody>
            <tr><td>Gross</td><td>{fmt(t.gross)}</td></tr>
            {t.discount > 0 && <tr><td>Discount</td><td>-{fmt(t.discount)}</td></tr>}
            <tr><td>Taxable value</td><td>{fmt(t.taxable)}</td></tr>
            {inv.interState ? <tr><td>IGST</td><td>{fmt(t.igst)}</td></tr>
              : <><tr><td>CGST</td><td>{fmt(t.cgst)}</td></tr><tr><td>SGST</td><td>{fmt(t.sgst)}</td></tr></>}
            {t.roundOff !== 0 && <tr><td>Round off</td><td>{fmt(t.roundOff)}</td></tr>}
            <tr className="gt"><td>Grand total</td><td>{formatINR(t.grandTotal)}</td></tr>
          </tbody>
        </table>
      </div>

      <footer className="inv-foot">
        <p>{s.invoice_footer}</p>
        <div className="sign">For {s.shop_name}<br /><br /><br />Authorised signatory</div>
      </footer>
      <p className="tiny muted">Computer-generated invoice · Billed by {inv.cashier} · AnshBill POS</p>
    </article>
  );
}

function ThermalReceipt({ inv, s }) {
  const t = inv.totals;
  return (
    <article className={`invoice thermal ${inv.status === 'cancelled' ? 'void' : ''}`}>
      <div className="c">
        <strong className="shop">{s.shop_name}</strong>
        <div className="pre">{s.shop_address}</div>
        {s.shop_phone && <div>Ph: {s.shop_phone}</div>}
        {s.shop_gstin && <div>GSTIN: {s.shop_gstin}</div>}
        <div className="dash" />
        <strong>TAX INVOICE</strong>
      </div>
      <div className="kv"><span>{inv.invoiceNo}</span><span>{inv.createdAt}</span></div>
      {inv.customer.name && <div>Customer: {inv.customer.name} {inv.customer.phone}</div>}
      {inv.customer.gstin && <div>GSTIN: {inv.customer.gstin}</div>}
      <div className="dash" />
      {inv.items.map((it, i) => (
        <div key={i} className="t-item">
          <div>{it.name}</div>
          <div className="kv">
            <span>{qtyFmt(it.qty)} × {fmt(it.price)}{it.discountPct ? ` -${it.discountPct}%` : ''} ({it.gstRate}%)</span>
            <span>{fmt(it.total)}</span>
          </div>
        </div>
      ))}
      <div className="dash" />
      <div className="kv"><span>Taxable</span><span>{fmt(t.taxable)}</span></div>
      {inv.interState ? <div className="kv"><span>IGST</span><span>{fmt(t.igst)}</span></div> : (
        <><div className="kv"><span>CGST</span><span>{fmt(t.cgst)}</span></div><div className="kv"><span>SGST</span><span>{fmt(t.sgst)}</span></div></>
      )}
      {t.discount > 0 && <div className="kv"><span>You saved</span><span>{fmt(t.discount)}</span></div>}
      {t.roundOff !== 0 && <div className="kv"><span>Round off</span><span>{fmt(t.roundOff)}</span></div>}
      <div className="kv big"><span>TOTAL</span><span>{formatINR(t.grandTotal)}</span></div>
      <div className="kv"><span>Paid by {PAYMENT_LABELS[inv.paymentMode]}</span>
        <span>{inv.amountTendered != null && fmt(inv.amountTendered)}</span></div>
      {inv.change > 0 && <div className="kv"><span>Change</span><span>{fmt(inv.change)}</span></div>}
      <div className="dash" />
      <div className="c small">{s.invoice_footer}</div>
    </article>
  );
}
