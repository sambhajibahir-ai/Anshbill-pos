const TOKEN_KEY = 'atbsoftware.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

let backendBaseUrl = '/api';

if (typeof window !== 'undefined' && window.desktopAPI?.getBackendPort) {
  window.desktopAPI.getBackendPort().then((port) => {
    if (port) {
      backendBaseUrl = `http://127.0.0.1:${port}/api`;
    }
  }).catch(() => {});
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  let base = backendBaseUrl;
  if (typeof window !== 'undefined' && window.desktopAPI?.getBackendPort && base === '/api') {
    const port = await window.desktopAPI.getBackendPort().catch(() => null);
    if (port) {
      base = `http://127.0.0.1:${port}/api`;
      backendBaseUrl = base;
    }
  }

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('atbsoftware:logout'));
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** "12.50" -> 1250 paise */
export const toPaise = (v) => Math.round((parseFloat(v) || 0) * 100);
/** 1250 -> "12.50" */
export const toRupees = (p) => (p / 100).toFixed(2);

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
