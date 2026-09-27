import { useEffect } from 'react';
import { formatINR } from '@shared/gst.js';

export const Money = ({ v, className }) => <span className={`num ${className || ''}`}>{formatINR(v || 0)}</span>;

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export const ErrorNote = ({ error }) => (error ? <div className="alert error">{error}</div> : null);

export function StockBadge({ p }) {
  if (p.stock <= 0) return <span className="badge danger">Out of stock</span>;
  if (p.stock <= p.reorderLevel) return <span className="badge warn">Low</span>;
  return <span className="badge ok">In stock</span>;
}

export const PAYMENT_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit' };
