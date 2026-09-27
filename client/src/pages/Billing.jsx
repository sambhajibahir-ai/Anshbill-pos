import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, toPaise, toRupees } from '../api.js';
import { calcInvoice, formatINR, isValidGstin, STATES } from '@shared/gst.js';
import { useApp } from '../App.jsx';
import { ErrorNote, Money, PAYMENT_LABELS } from '../components/ui.jsx';
const CameraScanner = lazy(() => import('../components/CameraScanner.jsx'));

const DRAFT_KEY = 'anshbill.draft';
const emptyCustomer = { phone: '', name: '', gstin: '', stateCode: '' };

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null;
  } catch {
    return null;
  }
}

export default function Billing() {
  const { settings, refreshAlerts } = useApp();
  const navigate = useNavigate();
  const draft = useMemo(loadDraft, []);

  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState(draft?.cart || []); // [{productId, qty, discountPct}]
  const [customer, setCustomer] = useState(draft?.customer || emptyCustomer);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [flash, setFlash] = useState(null); // {type, text}
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [camera, setCamera] = useState(false);
  const scanRef = useRef(null);

  const loadProducts = useCallback(() => api('/products?limit=2000').then(setProducts).catch((e) => setError(e.message)), []);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, customer }));
  }, [cart, customer]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const byBarcode = useMemo(() => new Map(products.filter((p) => p.barcode).map((p) => [p.barcode, p])), [products]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\d+(\.\d+)?\*/, '');
    if (q.length < 2) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.barcode?.startsWith(q) || p.sku?.toLowerCase() === q).slice(0, 8);
  }, [query, products]);

  const flashTimer = useRef();
  const showFlash = (type, text) => {
    setFlash({ type, text });
    beep(type === 'error' ? 220 : 1200);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  };

  const addToCart = useCallback((p, qty = 1) => {
    setCart((c) => {
      const i = c.findIndex((x) => x.productId === p.id);
      if (i >= 0) {
        const next = [...c];
        next[i] = { ...next[i], qty: +(next[i].qty + qty).toFixed(3) };
        return [next[i], ...next.filter((_, j) => j !== i)];
      }
      return [{ productId: p.id, qty, discountPct: 0 }, ...c];
    });
    const inCart = (cart.find((x) => x.productId === p.id)?.qty || 0) + qty;
    if (inCart > p.stock) showFlash('warn', `${p.name}: only ${p.stock} ${p.unit} in stock`);
    else showFlash('ok', `Added ${p.name}`);
  }, [cart]);

  const handleCode = useCallback(async (raw) => {
    let text = raw.trim();
    if (!text) return;
    // "3*8901234567890" => quantity 3
    let qty = 1;
    const m = text.match(/^(\d+(?:\.\d+)?)\*(.+)$/);
    if (m) { qty = parseFloat(m[1]); text = m[2].trim(); }

    let p = byBarcode.get(text);
    if (!p) {
      try {
        p = await api(`/products/barcode/${encodeURIComponent(text)}`);
        setProducts((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, p]));
      } catch { /* not a barcode */ }
    }
    if (!p) {
      const q = text.toLowerCase();
      const matches = products.filter((x) => x.name.toLowerCase().includes(q) || x.sku?.toLowerCase() === q);
      if (matches.length === 1) p = matches[0];
    }
    if (!p) {
      showFlash('error', `No product found for "${text}"`);
      return;
    }
    addToCart(p, qty);
    setQuery('');
  }, [byBarcode, products, addToCart]);

  const onScanKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = byBarcode.get(query.trim().replace(/^\d+(\.\d+)?\*/, ''));
      if (!exact && suggestions[highlight] && !/^\d{8,}$/.test(query.trim())) {
        const m = query.match(/^(\d+(?:\.\d+)?)\*/);
        addToCart(suggestions[highlight], m ? parseFloat(m[1]) : 1);
        setQuery('');
      } else handleCode(query);
    } else if (e.key === 'Escape') setQuery('');
  };

  useEffect(() => setHighlight(0), [query]);

  const updateLine = (productId, patch) => setCart((c) => c.map((x) => (x.productId === productId ? { ...x, ...patch } : x)));
  const removeLine = (productId) => setCart((c) => c.filter((x) => x.productId !== productId));

  const clearBill = () => {
    setCart([]);
    setCustomer(emptyCustomer);
    setTendered('');
    setPaymentMode('cash');
    setError('');
    scanRef.current?.focus();
  };

  // Customer lookup by phone
  useEffect(() => {
    if (!/^[6-9]\d{9}$/.test(customer.phone)) return;
    let alive = true;
    api(`/customers?q=${customer.phone}`).then((list) => {
      const c = list.find((x) => x.phone === customer.phone);
      if (alive && c) {
        setCustomer((cur) => ({
          ...cur, name: cur.name || c.name, gstin: cur.gstin || c.gstin || '', stateCode: cur.stateCode || c.stateCode || '',
        }));
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [customer.phone]);

  const shopState = settings?.shop_state_code || '27';
  const gstinOk = !customer.gstin || isValidGstin(customer.gstin);
  const pos = customer.gstin && gstinOk ? customer.gstin.slice(0, 2).toUpperCase() : customer.stateCode || shopState;
  const interState = pos !== shopState;

  const lines = cart.map((c) => ({ ...c, product: byId.get(c.productId) })).filter((l) => l.product);
  const { lines: calc, totals } = calcInvoice(lines.map((l) => ({
    price: l.product.price, qty: Number(l.qty) || 0, discountPct: Number(l.discountPct) || 0,
    gstRate: l.product.gstRate, taxInclusive: l.product.taxInclusive,
  })), { interState });

  const tenderedPaise = toPaise(tendered);
  const change = tendered ? tenderedPaise - totals.grandTotal : 0;
  const quickCash = [...new Set([totals.grandTotal, ...[10000, 20000, 50000, 100000, 200000]
    .map((n) => Math.ceil(totals.grandTotal / n) * n)])].filter((v) => v > 0).slice(0, 5);

  const checkout = useCallback(async () => {
    setError('');
    if (!lines.length) return setError('Scan or add at least one item.');
    if (lines.some((l) => !(Number(l.qty) > 0))) return setError('Every item needs a quantity greater than 0.');
    if (!gstinOk) return setError('Customer GSTIN is not valid.');
    if (paymentMode === 'cash' && tendered && tenderedPaise < totals.grandTotal) return setError('Cash received is less than the bill total.');
    setSaving(true);
    try {
      const inv = await api('/invoices', {
        method: 'POST',
        body: {
          items: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), discountPct: Number(l.discountPct) || 0 })),
          customer: { ...customer, gstin: customer.gstin.toUpperCase() },
          paymentMode,
          amountTendered: paymentMode === 'cash' && tendered ? tenderedPaise : undefined,
        },
      });
      localStorage.removeItem(DRAFT_KEY);
      refreshAlerts();
      navigate(`/invoices/${inv.id}?new=1`);
    } catch (e) {
      setError(e.message);
      loadProducts();
    } finally {
      setSaving(false);
    }
  }, [lines, gstinOk, paymentMode, tendered, tenderedPaise, totals.grandTotal, customer, navigate, refreshAlerts, loadProducts]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus(); }
      if (e.key === 'F9') { e.preventDefault(); if (!saving) checkout(); }
      if (e.key === 'F4') { e.preventDefault(); document.getElementById('tendered')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkout, saving]);

  const onCameraCode = useCallback((code) => handleCode(code), [handleCode]);

  return (
    <div className="billing">
      <section className="bill-left">
        <div className="scan-bar">
          <div className="scan-input-wrap">
            <input
              ref={scanRef}
              autoFocus
              className="scan-input"
              placeholder="Scan barcode or type product name…  (F2)   tip: 3*barcode for qty 3"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onScanKey}
              aria-label="Scan or search product"
            />
            {suggestions.length > 0 && (
              <ul className="suggestions" role="listbox">
                {suggestions.map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === highlight} className={i === highlight ? 'active' : ''}
                    onMouseDown={(e) => { e.preventDefault(); addToCart(p); setQuery(''); scanRef.current?.focus(); }}>
                    <span>{p.name}</span>
                    <span className="muted small">{p.barcode}</span>
                    <span className={`small ${p.stock <= 0 ? 'text-danger' : 'muted'}`}>{p.stock} {p.unit}</span>
                    <strong className="num">{formatINR(p.price)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="btn" onClick={() => setCamera(true)} title="Scan with camera">📷 Camera</button>
        </div>
        {flash && <div className={`flash ${flash.type}`}>{flash.text}</div>}

        <div className="cart card">
          {lines.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">⌁</div>
              <p>Scan a barcode to start the bill.</p>
              <p className="muted small">USB and Bluetooth scanners work straight away. Click the box above and scan.</p>
            </div>
          ) : (
            <table className="table cart-table">
              <thead>
                <tr><th>#</th><th>Item</th><th className="r">Rate</th><th className="c">Qty</th><th className="c">Disc %</th><th className="r">GST</th><th className="r">Amount</th><th /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const over = Number(l.qty) > l.product.stock;
                  return (
                    <tr key={l.productId} className={over ? 'row-warn' : ''}>
                      <td className="muted">{lines.length - i}</td>
                      <td>
                        <div className="item-name">{l.product.name}</div>
                        <div className="muted small">
                          {l.product.barcode} · HSN {l.product.hsn || '-'}
                          {over && <span className="text-danger"> · only {l.product.stock} in stock</span>}
                        </div>
                      </td>
                      <td className="r num">{formatINR(l.product.price)}</td>
                      <td className="c">
                        <div className="qty">
                          <button onClick={() => Number(l.qty) > 1 && updateLine(l.productId, { qty: +(Number(l.qty) - 1).toFixed(3) })} aria-label="Decrease">−</button>
                          <input type="number" min="0" step={l.product.unit === 'pcs' ? 1 : 0.001} value={l.qty}
                            onChange={(e) => updateLine(l.productId, { qty: e.target.value })} aria-label="Quantity" />
                          <button onClick={() => updateLine(l.productId, { qty: +(Number(l.qty) + 1).toFixed(3) })} aria-label="Increase">+</button>
                        </div>
                        <div className="muted small">{l.product.unit}</div>
                      </td>
                      <td className="c">
                        <input className="disc" type="number" min="0" max="100" value={l.discountPct}
                          onChange={(e) => updateLine(l.productId, { discountPct: e.target.value })} aria-label="Discount percent" />
                      </td>
                      <td className="r small">{l.product.gstRate}%</td>
                      <td className="r num strong">{formatINR(calc[i].total)}</td>
                      <td><button className="icon-btn danger" onClick={() => removeLine(l.productId)} aria-label="Remove">×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <aside className="bill-right">
        <div className="card">
          <h3>Customer <span className="muted small">(optional)</span></h3>
          <div className="grid2">
            <label>Mobile
              <input inputMode="numeric" maxLength={10} value={customer.phone}
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label>Name
              <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </label>
            <label>GSTIN (B2B)
              <input className={gstinOk ? '' : 'invalid'} maxLength={15} value={customer.gstin}
                onChange={(e) => setCustomer({ ...customer, gstin: e.target.value.toUpperCase() })} />
            </label>
            <label>Place of supply
              <select value={pos} disabled={!!customer.gstin && gstinOk}
                onChange={(e) => setCustomer({ ...customer, stateCode: e.target.value })}>
                {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
              </select>
            </label>
          </div>
          {interState && <p className="small text-warn">Inter-state supply: IGST applies.</p>}
        </div>

        <div className="card totals">
          <Row label={`Items (${lines.length})`} v={totals.gross} />
          {totals.discount > 0 && <Row label="Discount" v={-totals.discount} />}
          <Row label="Taxable value" v={totals.taxable} />
          {interState ? <Row label="IGST" v={totals.igst} /> : (<><Row label="CGST" v={totals.cgst} /><Row label="SGST" v={totals.sgst} /></>)}
          {totals.roundOff !== 0 && <Row label="Round off" v={totals.roundOff} />}
          <div className="grand">
            <span>Total</span>
            <Money v={totals.grandTotal} />
          </div>
        </div>

        <div className="card">
          <div className="pay-modes">
            {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
              <button key={k} className={`btn ${paymentMode === k ? 'primary' : ''}`} onClick={() => setPaymentMode(k)}>{v}</button>
            ))}
          </div>
          {paymentMode === 'cash' && (
            <>
              <label>Cash received <span className="muted small">(F4)</span>
                <input id="tendered" type="number" min="0" step="1" value={tendered} placeholder={toRupees(totals.grandTotal)}
                  onChange={(e) => setTendered(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && checkout()} />
              </label>
              <div className="quick-cash">
                {quickCash.map((v) => <button key={v} className="btn sm" onClick={() => setTendered(toRupees(v))}>{formatINR(v)}</button>)}
              </div>
              {tendered && (
                <div className={`change ${change < 0 ? 'text-danger' : ''}`}>
                  {change < 0 ? 'Short by' : 'Return change'} <Money v={Math.abs(change)} />
                </div>
              )}
            </>
          )}
          {paymentMode === 'credit' && <p className="small text-warn">Credit sales need the customer's mobile number.</p>}
          <ErrorNote error={error} />
          <button className="btn primary block lg" disabled={saving || !lines.length} onClick={checkout}>
            {saving ? 'Saving…' : `Complete sale ${formatINR(totals.grandTotal)}`} <kbd>F9</kbd>
          </button>
          <button className="btn ghost block" onClick={clearBill} disabled={!lines.length && !customer.phone}>Clear bill</button>
        </div>
      </aside>

      {camera && <Suspense fallback={null}><CameraScanner onDetected={onCameraCode} onClose={() => { setCamera(false); scanRef.current?.focus(); }} /></Suspense>}
    </div>
  );
}

let audioCtx;
function beep(freq) {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.05;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.08);
  } catch { /* audio not available */ }
}

const Row = ({ label, v }) => (
  <div className="trow"><span>{label}</span><Money v={v} /></div>
);
