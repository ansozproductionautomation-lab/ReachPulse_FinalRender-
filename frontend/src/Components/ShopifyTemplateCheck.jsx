import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { API_BASE } from '../lib/apiBase';

const STATUS_STYLE = {
  APPROVED: 'bg-green-100 text-green-800',
  PENDING: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-red-100 text-red-800',
  NOT_FOUND: 'bg-red-100 text-red-800',
};

// Live check of the templates used by the Shopify automations (order confirmation,
// abandoned cart). Shows Approved / Pending / Rejected and what to fix.
export default function ShopifyTemplateCheck() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const verify = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/integrations/shopify/templates/verify`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
      setData(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { verify(); }, [verify]);

  return (
    <section className="mt-6 rounded-xl border border-slate-100 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Shopify template verification</h3>
          <p className="mt-1 text-xs text-slate-500">
            Checks in Meta that the templates used by your Shopify automations are approved and ready to send.
          </p>
        </div>
        <button
          type="button"
          onClick={verify}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Checking…' : 'Verify now'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {data && (
        <>
          <p className={`mt-3 text-xs font-semibold ${data.allReady ? 'text-green-700' : 'text-amber-700'}`}>
            {data.allReady
              ? 'All Shopify templates are ready.'
              : 'Some templates need attention before automations can send.'}
          </p>

          <ul className="mt-2 divide-y divide-slate-100">
            {data.templates.map((t) => (
              <li key={`${t.key}-${t.templateName}`} className="flex flex-col gap-1.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {t.ready
                    ? <CheckCircle2 size={16} className="text-green-600" />
                    : t.found ? <AlertTriangle size={16} className="text-amber-600" /> : <XCircle size={16} className="text-red-600" />}
                  <span className="text-sm font-semibold text-slate-800">{t.label}</span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.templateName}</code>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[t.status] || 'bg-slate-100 text-slate-700'}`}>
                    {t.status === 'NOT_FOUND' ? 'Not found' : t.status}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t.language} · header {t.headerFormat.toLowerCase()} · {t.bodyVars} variable{t.bodyVars === 1 ? '' : 's'}
                  </span>
                </div>
                {t.issues.map((text) => (
                  <p key={text} className="pl-6 text-xs text-red-700">{text}</p>
                ))}
                {t.warnings.map((text) => (
                  <p key={text} className="pl-6 text-xs text-amber-700">{text}</p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}