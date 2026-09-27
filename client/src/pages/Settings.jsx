import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { isValidGstin, STATES } from '@shared/gst.js';
import { useApp } from '../App.jsx';
import { ErrorNote, Modal } from '../components/ui.jsx';

export default function Settings() {
  return (
    <div>
      <div className="page-head"><h1>Settings</h1></div>
      <ShopSettings />
      <div className="grid-2">
        <Users />
        <ChangePassword />
      </div>
    </div>
  );
}

function ShopSettings() {
  const { settings, setSettings } = useApp();
  const [f, setF] = useState(settings);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });
  const gstinOk = !f.shop_gstin || isValidGstin(f.shop_gstin);

  const save = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    try {
      const s = await api('/settings', { method: 'PUT', body: f });
      setSettings(s); setF(s); setMsg('Saved.');
    } catch (err) { setError(err.message); }
  };

  return (
    <form className="card form grid3" onSubmit={save}>
      <h3 className="span3">Shop & invoice</h3>
      <label className="span2">Shop name<input value={f.shop_name} onChange={set('shop_name')} required /></label>
      <label>Invoice prefix<input value={f.invoice_prefix} maxLength={4} onChange={(e) => setF({ ...f, invoice_prefix: e.target.value.toUpperCase() })} /></label>
      <label className="span3">Address<textarea rows={2} value={f.shop_address} onChange={set('shop_address')} /></label>
      <label>Phone<input value={f.shop_phone} onChange={set('shop_phone')} /></label>
      <label>Email<input type="email" value={f.shop_email} onChange={set('shop_email')} /></label>
      <label>GSTIN
        <input className={gstinOk ? '' : 'invalid'} value={f.shop_gstin} maxLength={15}
          onChange={(e) => setF({ ...f, shop_gstin: e.target.value.toUpperCase(), ...(isValidGstin(e.target.value) && { shop_state_code: e.target.value.slice(0, 2) }) })} />
      </label>
      <label>Home state (for CGST/SGST)
        <select value={f.shop_state_code} onChange={set('shop_state_code')} disabled={!!f.shop_gstin && gstinOk}>
          {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
        </select>
      </label>
      <label className="span2">Invoice footer<input value={f.invoice_footer} onChange={set('invoice_footer')} /></label>
      <label className="check span3"><input type="checkbox" checked={f.allow_negative_stock === '1'} onChange={set('allow_negative_stock')} />
        Allow billing when stock is insufficient (stock goes negative)</label>
      <div className="span3"><ErrorNote error={error} />{msg && <div className="alert success">{msg}</div>}</div>
      <div className="span3 actions end"><button className="btn primary" disabled={!gstinOk}>Save settings</button></div>
    </form>
  );
}

function Users() {
  const { user: me } = useApp();
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api('/auth/users').then(setUsers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (u) => {
    try { await api(`/auth/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); load(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="card">
      <div className="row-between"><h3>Users</h3><button className="btn sm primary" onClick={() => setAdding(true)}>+ Add user</button></div>
      <ErrorNote error={error} />
      <table className="table compact">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'row-void'}>
              <td>{u.name}</td><td>{u.username}</td><td className="cap">{u.role}</td>
              <td className="r">{u.id !== me.id && <button className="btn sm ghost" onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && <AddUser onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddUser({ onClose, onSaved }) {
  const [f, setF] = useState({ name: '', username: '', password: '', role: 'cashier' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try { await api('/auth/users', { method: 'POST', body: f }); onSaved(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title="Add user" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Full name<input autoFocus value={f.name} onChange={set('name')} required /></label>
        <label>Username<input value={f.username} onChange={set('username')} required /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} required minLength={6} /></label>
        <label>Role<select value={f.role} onChange={set('role')}><option value="cashier">Cashier (billing only)</option><option value="admin">Admin (full access)</option></select></label>
        <ErrorNote error={error} />
        <div className="actions end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Add user</button></div>
      </form>
    </Modal>
  );
}

function ChangePassword() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    if (f.newPassword !== f.confirm) return setError('The new passwords do not match.');
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      setMsg('Password changed.'); setF({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { setError(err.message); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card form" onSubmit={submit}>
      <h3>Change my password</h3>
      <label>Current password<input type="password" value={f.currentPassword} onChange={set('currentPassword')} required /></label>
      <label>New password<input type="password" value={f.newPassword} onChange={set('newPassword')} required minLength={6} /></label>
      <label>Confirm new password<input type="password" value={f.confirm} onChange={set('confirm')} required /></label>
      <ErrorNote error={error} />{msg && <div className="alert success">{msg}</div>}
      <div className="actions end"><button className="btn primary">Change password</button></div>
    </form>
  );
}
