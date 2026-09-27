import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Billing from './pages/Billing.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceView from './pages/InvoiceView.jsx';
import Products from './pages/Products.jsx';
import StockAlerts from './pages/StockAlerts.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Labels from './pages/Labels.jsx';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const [booting, setBooting] = useState(!!getToken());

  const refreshAlerts = useCallback(() => {
    api('/products/alerts').then((a) => setAlertCount(a.length)).catch(() => {});
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const [me, s] = await Promise.all([api('/auth/me'), api('/settings')]);
      setUser(me);
      setSettings(s);
      refreshAlerts();
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setBooting(false);
    }
  }, [refreshAlerts]);

  useEffect(() => {
    if (getToken()) loadSession();
    const onLogout = () => setUser(null);
    window.addEventListener('anshbill:logout', onLogout);
    return () => window.removeEventListener('anshbill:logout', onLogout);
  }, [loadSession]);

  const logout = () => { setToken(null); setUser(null); };

  if (booting) return <div className="boot">Loading AnshBill…</div>;
  if (!user) return <Login onLogin={(token) => { setToken(token); loadSession(); }} />;

  const isAdmin = user.role === 'admin';
  const ctx = { user, isAdmin, settings, setSettings, alertCount, refreshAlerts };

  return (
    <AppContext.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar no-print">
          <div className="brand">
            <span className="brand-mark">AB</span>
            <div>
              <strong>AnshBill</strong>
              <small>POS</small>
            </div>
          </div>
          <nav>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/billing">New Bill <kbd>F1</kbd></NavLink>
            <NavLink to="/invoices">Invoices</NavLink>
            <NavLink to="/products">Products</NavLink>
            <NavLink to="/stock-alerts">
              Stock Alerts {alertCount > 0 && <span className="badge danger">{alertCount}</span>}
            </NavLink>
            <NavLink to="/reports">Reports</NavLink>
            {isAdmin && <NavLink to="/settings">Settings</NavLink>}
          </nav>
          <div className="sidebar-foot">
            <div className="who">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <button className="btn ghost sm" onClick={logout}>Log out</button>
          </div>
        </aside>
        <main className="main">
          <GlobalShortcuts />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoices/:id" element={<InvoiceView />} />
            <Route path="/products" element={<Products />} />
            <Route path="/labels" element={<Labels />} />
            <Route path="/stock-alerts" element={<StockAlerts />} />
            <Route path="/reports" element={<Reports />} />
            {isAdmin && <Route path="/settings" element={<Settings />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AppContext.Provider>
  );
}

function GlobalShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        navigate('/billing');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return null;
}
