import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatINR } from '@shared/gst.js';
import { useApp } from '../App.jsx';
import Barcode from '../components/Barcode.jsx';

export default function Labels() {
  const [params] = useSearchParams();
  const { settings } = useApp();
  const [items, setItems] = useState([]);

  useEffect(() => {
    const ids = (params.get('ids') || '').split(',').filter(Boolean);
    Promise.all(ids.map((id) => api(`/products/${id}`))).then((ps) => setItems(ps.map((p) => ({ p, copies: 1 }))));
  }, [params]);

  const labels = items.flatMap(({ p, copies }) => Array.from({ length: copies }, (_, i) => ({ p, key: `${p.id}-${i}` })));

  return (
    <div>
      <div className="page-head no-print">
        <div>
          <Link to="/products" className="muted small">← Products</Link>
          <h1>Barcode labels</h1>
        </div>
        <button className="btn primary" onClick={() => window.print()} disabled={!labels.length}>Print {labels.length} labels</button>
      </div>
      <div className="card no-print">
        <table className="table">
          <thead><tr><th>Product</th><th>Barcode</th><th className="c">Copies</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.p.id}>
                <td>{it.p.name}</td><td className="mono">{it.p.barcode}</td>
                <td className="c">
                  <input type="number" min="0" max="500" className="disc" value={it.copies}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, copies: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="print-area labels-sheet">
        {labels.map(({ p, key }) => (
          <div className="label" key={key}>
            <div className="label-shop">{settings?.shop_name}</div>
            <div className="label-name">{p.name}</div>
            <Barcode value={p.barcode} height={32} width={1.3} fontSize={10} />
            <div className="label-price">MRP {formatINR(p.price)} <small>{p.taxInclusive ? 'incl. taxes' : '+ GST'}</small></div>
          </div>
        ))}
      </div>
    </div>
  );
}
