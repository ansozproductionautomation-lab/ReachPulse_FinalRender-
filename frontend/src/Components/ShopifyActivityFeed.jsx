import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { RefreshCw, UserPlus, ShoppingCart, Package } from 'lucide-react';
import { API_BASE } from '../lib/apiBase';

const KIND = {
  customer: { label: 'Customer', icon: UserPlus, cls: 'bg-blue-100 text-blue-800' },
  checkout: { label: 'Checkout', icon: ShoppingCart, cls: 'bg-amber-100 text-amber-800' },
  order: { label: 'Order', icon: Package, cls: 'bg-green-100 text-green-800' },
};

const OUTCOME = {
  queued: { label: 'Message queued', cls: 'bg-green-100 text-green-800' },
  added: { label: 'Contact added', cls: 'bg-green-100 text-green-800' },
  exists: { label: 'Already saved', cls: 'bg-slate-100 text-slate-700' },
  converted: { label: 'Order placed', cls: 'bg-green-100 text-green-800' },
  skipped: { label: 'Skipped', cls: 'bg-amber-100 text-amber-800' },
  error: { label: 'Error', cls: 'bg-red-100 text-red-800' },
};

function timeAgo(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

// Live list of what arrives from Shopify (new customers, checkouts, orders)
// and what ReachPulse did with each one.
export default function ShopifyActivityFeed() {
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({ customers: 0, checkouts: 0, orders: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/integrations/shopify/events?limit=15`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
      setEvents(body.events || []);
      setCounts(body.counts || { customers: 0, checkouts: 0, orders: 0 });
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30000);
    const socket = io(API_BASE, { transports: ['websocket', 'polling'] });
    socket.on('shopify:event', () => {
      clearTimeout(debounce.current);
      debounce.current = setTimeout(load, 500);
    });
    return () => {
      clearInterval(poll);
      clearTimeout(debounce.current);
      socket.disconnect();
    };
  }, [load]);

  return (
    <section className="mt-6 rounded-xl border border-slate-100 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Shopify activity</h3>
          <p className="mt-1 text-xs text-slate-500">
            New customers, checkouts and orders from your Shopify store, and what ReachPulse did with them.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">{counts.customers} new customers</span>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">{counts.checkouts} checkouts</span>
        <span className="rounded-full bg-green-50 px-3 py-1 text-green-800">{counts.orders} orders</span>
        <span className="self-center text-[11px] font-normal text-slate-500">last 24 hours</span>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {!error && events.length === 0 && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          Nothing received from Shopify yet. Add the webhooks (customer creation, checkout, order) in Shopify, or send a test event.
        </p>
      )}

      <ul className="mt-2 divide-y divide-slate-100">
        {events.map((item) => {
          const kind = KIND[item.kind] || KIND.order;
          const outcome = OUTCOME[item.outcome] || OUTCOME.skipped;
          const Icon = kind.icon;
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${kind.cls}`}>
                <Icon size={12} /> {kind.label}
              </span>
              <span className="text-sm font-semibold text-slate-800">{item.name || 'Unknown customer'}</span>
              <span className="text-xs text-slate-500">
                {item.hasPhone ? item.phoneMasked : 'no phone number'}
                {item.ref ? ` · ${item.ref}` : ''}
                {item.amount ? ` · ${item.amount}` : ''}
                {item.itemCount ? ` · ${item.itemCount} item${item.itemCount === 1 ? '' : 's'}` : ''}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${outcome.cls}`}>{outcome.label}</span>
              {item.note && <span className="text-xs text-slate-500">{item.note}</span>}
              <span className="ml-auto text-[11px] text-slate-400">{timeAgo(item.updatedAt)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}