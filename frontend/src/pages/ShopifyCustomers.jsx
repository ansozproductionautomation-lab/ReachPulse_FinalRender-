import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Search, Send, KeyRound, Users } from 'lucide-react';
import {
  clearAdminKey,
  downloadShopifyCustomersExcel,
  getAdminKey,
  getApprovedTemplates,
  getShopifyCustomerStats,
  getShopifyCustomers,
  sendShopifyTemplate,
  setAdminKey,
} from '../lib/shopifyCustomerApi';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'pending', label: 'Pending' },
  { id: 'sent', label: 'Sent' },
  { id: 'failed', label: 'Failed' },
];

const STATUS_STYLE = {
  Pending: 'bg-amber-50 text-amber-700',
  Processing: 'bg-blue-50 text-blue-700',
  Sent: 'bg-emerald-50 text-emerald-700',
  Failed: 'bg-red-50 text-red-700',
};

const MAX_SELECT = 100;

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value ?? '-'}</p>
    </div>
  );
}

function KeyPrompt({ onSave, error }) {
  const [value, setValue] = useState('');
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center">
      <KeyRound className="mx-auto text-emerald-700" size={26} />
      <h2 className="mt-3 text-sm font-bold text-gray-900">Admin key required</h2>
      <p className="mt-1 text-xs text-gray-500">
        Enter the SHOPIFY_CUSTOMERS_API_KEY from your backend .env. It is saved in this browser only.
      </p>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value.trim() && onSave(value)}
        className="mt-4 h-9 w-full rounded-md border border-gray-300 px-3 text-xs outline-none focus:border-emerald-600"
        placeholder="Admin key"
      />
      <button
        onClick={() => value.trim() && onSave(value)}
        className="mt-3 h-9 w-full rounded-md bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
      >
        Continue
      </button>
    </div>
  );
}

export default function ShopifyCustomers() {
  const [hasKey, setHasKey] = useState(Boolean(getAdminKey()));
  const [keyError, setKeyError] = useState('');

  const [stats, setStats] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const [templates, setTemplates] = useState([]);
  const [templateKey, setTemplateKey] = useState(''); // "name|language"
  const [selected, setSelected] = useState(() => new Set());

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleError = useCallback((err) => {
    if (err.status === 401 || err.status === 503) {
      clearAdminKey();
      setHasKey(false);
      setKeyError(err.message);
    } else {
      setError(err.message);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, statData] = await Promise.all([
        getShopifyCustomers({ status: tab, search: query, page, limit: 50 }),
        getShopifyCustomerStats(),
      ]);
      setCustomers(list.customers || []);
      setTotal(list.total || 0);
      setPages(list.pages || 1);
      setStats(statData.stats);
      setError('');
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [tab, query, page, handleError]);

  useEffect(() => { if (hasKey) load(); }, [hasKey, load]);

  useEffect(() => {
    if (!hasKey) return;
    getApprovedTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [hasKey]);

  const eligibleIds = useMemo(
    () => customers.filter((c) => c.whatsappOptIn && c.templateStatus !== 'Processing').map((c) => c._id),
    [customers]
  );

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECT) next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === eligibleIds.length ? new Set() : new Set(eligibleIds.slice(0, MAX_SELECT))
    );

  async function handleSend() {
    const [name, language] = templateKey.split('|');
    if (!name || selected.size === 0) return;
    if (!window.confirm(`Send "${name}" to ${selected.size} customer(s)?`)) return;

    setSending(true);
    setMessage('');
    setError('');
    try {
      const result = await sendShopifyTemplate({
        ids: [...selected],
        templateName: name,
        language,
      });
      setMessage(`Sent: ${result.sent}  |  Failed: ${result.failed}  |  Skipped: ${result.skipped}`);
      const firstError = result.results.find((r) => r.error)?.error;
      if (firstError) setError(firstError);
      setSelected(new Set());
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setSending(false);
    }
  }

  async function handleDownload() {
    try {
      await downloadShopifyCustomersExcel({ status: tab, search: query });
    } catch (err) {
      handleError(err);
    }
  }

  if (!hasKey) {
    return (
      <KeyPrompt
        error={keyError}
        onSave={(key) => { setAdminKey(key); setKeyError(''); setHasKey(true); }}
      />
    );
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center gap-2">
        <Users size={18} className="text-emerald-700" />
        <h1 className="text-base font-bold text-gray-900">Shopify Customers</h1>
        <button
          onClick={load}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total customers" value={stats?.total} />
        <StatCard label="New (last 7 days)" value={stats?.new} />
        <StatCard label="Pending" value={stats?.pending} />
        <StatCard label="Sent" value={stats?.sent} />
        <StatCard label="Failed" value={stats?.failed} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}
          className="relative"
        >
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, order"
            className="h-9 w-72 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-xs outline-none focus:border-emerald-600"
          />
        </form>

        <button
          onClick={handleDownload}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          <Download size={14} /> Download Excel
        </button>
      </div>

      <div className="mt-4 flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setPage(1); setSelected(new Set()); }}
            className={`h-8 rounded-md px-3 text-xs font-medium ${
              tab === t.id ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={eligibleIds.length > 0 && selected.size === Math.min(eligibleIds.length, MAX_SELECT)}
            onChange={toggleAll}
          />
          Select all opted-in ({selected.size} selected, max {MAX_SELECT})
        </label>

        <select
          value={templateKey}
          onChange={(e) => setTemplateKey(e.target.value)}
          className="ml-auto h-9 rounded-md border border-gray-300 bg-white px-2 text-xs"
        >
          <option value="">Select approved template</option>
          {templates.map((t) => (
            <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>

        <button
          onClick={handleSend}
          disabled={sending || !templateKey || selected.size === 0}
          className="flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={14} /> {sending ? 'Sending...' : 'Send template'}
        </button>
      </div>

      {message && <p className="mt-3 text-xs font-medium text-emerald-700">{message}</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2.5" />
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Phone</th>
              <th className="px-3 py-2.5">Last order</th>
              <th className="px-3 py-2.5">Product</th>
              <th className="px-3 py-2.5">Orders</th>
              <th className="px-3 py-2.5">Opt-in</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                  {loading ? 'Loading...' : 'No customers found.'}
                </td>
              </tr>
            )}
            {customers.map((c) => {
              const canSelect = c.whatsappOptIn && c.templateStatus !== 'Processing';
              return (
                <tr key={c._id} className="border-t border-gray-100">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      disabled={!canSelect}
                      checked={selected.has(c._id)}
                      onChange={() => toggle(c._id)}
                    />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-800">{c.name || '-'}</td>
                  <td className="px-3 py-2.5 text-gray-600">+{c.phone}</td>
                  <td className="px-3 py-2.5 text-gray-600">#{c.lastOrderNumber || '-'}</td>
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-gray-600" title={c.productName}>
                    {c.productName || '-'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{c.orderCount}</td>
                  <td className="px-3 py-2.5">{c.whatsappOptIn ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2.5">
                    <span
                      title={c.templateError || c.templateName}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[c.templateStatus] || ''}`}
                    >
                      {c.templateStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>{total} customer(s)</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-8 rounded-md border border-gray-200 bg-white px-3 disabled:opacity-40"
          >
            Prev
          </button>
          <span>Page {page} / {pages}</span>
          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="h-8 rounded-md border border-gray-200 bg-white px-3 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}