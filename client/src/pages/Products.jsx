import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadCsv, toPaise, toRupees } from '../api.js';
import { formatINR, GST_RATES } from '@shared/gst.js';
import { useApp } from '../App.jsx';
import { ErrorNote, Modal, StockBadge } from '../components/ui.jsx';
import Barcode from '../components/Barcode.jsx';
const CameraScanner = lazy(() => import('../components/CameraScanner.jsx'));

const UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'box', 'pack', 'dozen', 'm'];

export default function Products() {
  const { isAdmin, refreshAlerts } = useApp();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // product | {} for new
  const [stockFor, setStockFor] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams({ limit: 2000, ...(showInactive && { includeInactive: 1 }) });
    api(`/products?${qs}`).then(setProducts).catch((e) => setError(e.message));
    api('/products/categories').then(setCategories).catch(() => {});
  }, [showInactive]);
  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category)
      && (!s || p.name.toLowerCase().includes(s) || p.barcode === s || p.sku?.toLowerCase() === s || p.hsn === s));
  }, [products, q, category]);

  const saved = () => { setEditing(null); setStockFor(null); load(); refreshAlerts(); };

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportCsv = () => downloadCsv('products.csv', [
    ['Name', 'Barcode', 'SKU', 'HSN', 'Category', 'Unit', 'Price', 'Cost', 'GST %', 'Tax inclusive', 'Stock', 'Reorder level'],
    ...filtered.map((p) => [p.name, p.barcode, p.sku, p.hsn, p.category, p.unit, toRupees(p.price), toRupees(p.cost),
      p.gstRate, p.taxInclusive ? 'Yes' : 'No', p.stock, p.reorderLevel]),
  ]);

  return (
    <div>
      <div className="page-head">
        <h1>Products</h1>
        <div className="actions">
          {selected.size > 0 && (
            <button className="btn" onClick={() => navigate(`/labels?ids=${[...selected].join(',')}`)}>
              Print labels ({selected.size})
            </button>
          )}
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          {isAdmin && <button className="btn primary" onClick={() => setEditing({})}>+ Add product</button>}
        </div>
      </div>
      <div className="filters card">
        <label className="grow">Search<input placeholder="Name, barcode, SKU or HSN" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label>Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>{categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
      </div>
      <ErrorNote error={error} />
      <div className="card flush">
        <table className="table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all"
                checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())} /></th>
              <th>Product</th><th>Barcode</th><th>HSN</th><th className="r">Price</th><th className="r">GST</th>
              <th className="r">Stock</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'row-void'}>
                <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} /></td>
                <td><strong>{p.name}</strong><div className="muted small">{p.category}{p.sku && ` · SKU ${p.sku}`}</div></td>
                <td className="mono small">{p.barcode}</td>
                <td>{p.hsn || '-'}</td>
                <td className="r num">{formatINR(p.price)}<div className="muted small">{p.taxInclusive ? 'incl. GST' : '+ GST'}</div></td>
                <td className="r">{p.gstRate}%</td>
                <td className="r num">{p.stock} <span className="muted small">{p.unit}</span><div className="muted small">reorder at {p.reorderLevel}</div></td>
                <td><StockBadge p={p} /></td>
                <td className="r nowrap">
                  <button className="btn sm ghost" onClick={() => setHistoryFor(p)}>History</button>
                  {isAdmin && <button className="btn sm" onClick={() => setStockFor(p)}>Stock</button>}
                  {isAdmin && <button className="btn sm" onClick={() => setEditing(p)}>Edit</button>}
                </td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={9} className="empty-row">No products found.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <ProductForm product={editing} categories={categories} onClose={() => setEditing(null)} onSaved={saved} />}
      {stockFor && <StockForm product={stockFor} onClose={() => setStockFor(null)} onSaved={saved} />}
      {historyFor && <StockHistory product={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function ProductForm({ product, categories, onClose, onSaved }) {
  const isNew = !product.id;
  const [f, setF] = useState({
    name: product.name || '', barcode: product.barcode || '', sku: product.sku || '', hsn: product.hsn || '',
    unit: product.unit || 'pcs', price: product.price != null ? toRupees(product.price) : '',
    cost: product.cost != null ? toRupees(product.cost) : '', gstRate: product.gstRate ?? 18,
    taxInclusive: product.taxInclusive ?? true, reorderLevel: product.reorderLevel ?? 5,
    category: product.category || '', active: product.active ?? true, openingStock: '',
  });
  const [error, setError] = useState('');
  const [scan, setScan] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const body = {
      name: f.name, barcode: f.barcode || null, sku: f.sku || null, hsn: f.hsn || null, unit: f.unit,
      price: toPaise(f.price), cost: toPaise(f.cost), gstRate: Number(f.gstRate), taxInclusive: f.taxInclusive,
      reorderLevel: Number(f.reorderLevel) || 0, category: f.category || null, active: f.active,
      ...(isNew && { openingStock: Number(f.openingStock) || 0 }),
    };
    try {
      await api(isNew ? '/products' : `/products/${product.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved();
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal title={isNew ? 'Add product' : `Edit ${product.name}`} onClose={onClose} wide>
      <form onSubmit={submit} className="form grid3">
        <label className="span3">Product name *<input autoFocus value={f.name} onChange={set('name')} required /></label>
        <label className="span2">Barcode <span className="muted small">(leave empty to auto-generate)</span>
          <div className="input-row">
            <input value={f.barcode} onChange={set('barcode')} placeholder="Scan the product's barcode" />
            <button type="button" className="btn" onClick={() => setScan(true)} title="Scan with camera">📷</button>
          </div>
        </label>
        <label>SKU<input value={f.sku} onChange={set('sku')} /></label>
        <label>HSN code<input value={f.hsn} onChange={set('hsn')} inputMode="numeric" maxLength={8} placeholder="4/6/8 digits" /></label>
        <label>Category<input list="cats" value={f.category} onChange={set('category')} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label>Unit<select value={f.unit} onChange={set('unit')}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label>Selling price (₹) *<input type="number" step="0.01" min="0" value={f.price} onChange={set('price')} required /></label>
        <label>GST rate
          <select value={f.gstRate} onChange={set('gstRate')}>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select>
        </label>
        <label className="check"><input type="checkbox" checked={f.taxInclusive} onChange={set('taxInclusive')} /> Price includes GST (MRP)</label>
        <label>Purchase cost (₹)<input type="number" step="0.01" min="0" value={f.cost} onChange={set('cost')} /></label>
        <label>Reorder level<input type="number" step="any" min="0" value={f.reorderLevel} onChange={set('reorderLevel')} /></label>
        {isNew ? <label>Opening stock<input type="number" step="any" min="0" value={f.openingStock} onChange={set('openingStock')} /></label>
          : <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>}
        {f.barcode && <div className="span3 c"><Barcode value={f.barcode} /></div>}
        <div className="span3"><ErrorNote error={error} /></div>
        <div className="span3 actions end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">{isNew ? 'Add product' : 'Save changes'}</button>
        </div>
      </form>
      {scan && <Suspense fallback={null}><CameraScanner onDetected={(c) => { setF((x) => ({ ...x, barcode: c })); setScan(false); }} onClose={() => setScan(false)} /></Suspense>}
    </Modal>
  );
}

function StockForm({ product, onClose, onSaved }) {
  const [mode, setMode] = useState('purchase');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState(toRupees(product.cost));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/products/${product.id}/stock`, {
        method: 'POST',
        body: { change: Number(qty), reason: mode, note, ...(mode === 'purchase' && { cost: toPaise(cost) }) },
      });
      onSaved();
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal title={`Update stock: ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p>Current stock: <strong>{product.stock} {product.unit}</strong></p>
        <div className="seg">
          <button type="button" className={mode === 'purchase' ? 'active' : ''} onClick={() => setMode('purchase')}>Stock in (purchase)</button>
          <button type="button" className={mode === 'adjustment' ? 'active' : ''} onClick={() => setMode('adjustment')}>Adjustment (±)</button>
        </div>
        <label>{mode === 'purchase' ? 'Quantity received' : 'Change (use negative for damage/loss)'}
          <input autoFocus type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </label>
        {mode === 'purchase' && <label>Purchase cost per unit (₹)<input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} /></label>}
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'purchase' ? 'Supplier / bill no.' : 'Reason'} /></label>
        {qty && <p className="muted">New stock: <strong>{+(product.stock + Number(qty)).toFixed(3)} {product.unit}</strong></p>}
        <ErrorNote error={error} />
        <div className="actions end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function StockHistory({ product, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api(`/products/${product.id}/movements`).then(setRows); }, [product.id]);
  return (
    <Modal title={`Stock history: ${product.name}`} onClose={onClose} wide>
      {!rows ? <p className="muted">Loading…</p> : (
        <table className="table">
          <thead><tr><th>Date</th><th>Type</th><th className="r">Change</th><th>Reference</th><th>By</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.created_at}</td><td className="cap">{m.reason}</td>
                <td className={`r num ${m.change < 0 ? 'text-danger' : 'text-ok'}`}>{m.change > 0 ? '+' : ''}{m.change}</td>
                <td>{m.ref || m.note || '-'}</td><td>{m.user_name || '-'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="empty-row">No stock movements yet.</td></tr>}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
