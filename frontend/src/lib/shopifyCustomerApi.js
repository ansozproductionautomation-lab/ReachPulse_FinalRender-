import { API_BASE } from './apiBase';

const KEY_STORAGE = 'reachpulse_admin_key';

export const getAdminKey = () => {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
};
export const setAdminKey = (key) => {
  try { localStorage.setItem(KEY_STORAGE, key.trim()); } catch { /* storage blocked */ }
};
export const clearAdminKey = () => {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* storage blocked */ }
};

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAdminKey()}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || data.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response;
}

const toQuery = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  });
  return q.toString();
};

export const getShopifyCustomers = async (params = {}) =>
  (await request(`/api/shopify-customers?${toQuery(params)}`)).json();

export const getShopifyCustomerStats = async () =>
  (await request('/api/shopify-customers/stats')).json();

export const sendShopifyTemplate = async (body) =>
  (await request('/api/shopify-customers/send-template', {
    method: 'POST',
    body: JSON.stringify(body),
  })).json();

// The export is protected by the admin key, so a plain <a href> cannot be used.
export async function downloadShopifyCustomersExcel(params = {}) {
  const response = await request(`/api/shopify-customers/export?${toQuery(params)}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `shopify-customers-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Approved templates come from the existing /api/templates endpoint (no admin key needed).
export async function getApprovedTemplates() {
  const response = await fetch(`${API_BASE}/api/templates`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Could not load templates.');
  return (data.templates || []).filter((t) => t.status === 'APPROVED');
}