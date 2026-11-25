// Single source of truth for the backend URL.
// On Render set VITE_API_BASE_URL (build-time) to your backend service URL.
const PROD_FALLBACK = 'https://reachpulse-finalrender.onrender.com';

const raw =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? PROD_FALLBACK : 'http://localhost:5000');

// Strip trailing slashes so `${API_BASE}/api/...` never becomes `//api/...`.
export const API_BASE = String(raw).trim().replace(/\/+$/, '');