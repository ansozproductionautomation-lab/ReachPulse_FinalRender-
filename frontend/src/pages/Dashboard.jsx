import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

import {
  Activity,
  CheckCheck,
  MessageSquare,
  Send,
  RefreshCw,
  CircleAlert,
  Layers,
  FileUp,
  PlusCircle,
  Rocket,
  Cloud,
  X,
} from "lucide-react";

/* ---------------- HELPERS ---------------- */

import { API_BASE } from '../lib/apiBase';
import ShopifyTemplateCheck from '../Components/ShopifyTemplateCheck';
import ShopifyActivityFeed from '../Components/ShopifyActivityFeed';
const BROADCAST_CHUNK = 100; // server accepts max 500 contacts per request
const MEDIA_FORMATS = ["IMAGE", "VIDEO", "DOCUMENT"];

const formatChange = (pct) =>
  pct === null || pct === undefined
    ? "No previous data"
    : `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}%`;

// CSV parser (quotes, BOM, \r\n sab handle karta hai)
const parseCSV = (text) => {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cur = "",
    q = false;

  const pushRow = () => {
    row.push(cur);
    cur = "";
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else cur += c;
  }
  pushRow();
  return rows;
};

const normalizePhone = (raw) => {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d; // India default
  return d.length >= 11 && d.length <= 15 ? d : null;
};

const processCSV = (text, existing) => {
  const rows = parseCSV(text);
  if (!rows.length) return { valid: [], invalid: 0, duplicates: 0 };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const phoneIdx = header.findIndex((h) =>
    /phone|mobile|number|whatsapp/.test(h)
  );
  const nameIdx = header.findIndex((h) => /name/.test(h));
  const hasHeader = phoneIdx !== -1;
  const pIdx = hasHeader ? phoneIdx : 1;
  const nIdx = hasHeader ? nameIdx : 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const seen = new Set(existing.map((c) => c.phone));
  const valid = [];
  let invalid = 0,
    duplicates = 0;

  dataRows.forEach((r) => {
    const phone = normalizePhone(r[pIdx]);
    if (!phone) return void invalid++;
    if (seen.has(phone)) return void duplicates++;
    seen.add(phone);
    valid.push({
      name: (nIdx >= 0 ? r[nIdx] : "")?.trim() || "—",
      phone,
    });
  });

  return { valid, invalid, duplicates };
};

/* ---------------- COMPONENT ---------------- */

const Dashboard = () => {
  const [selectedPeriod, setSelectedPeriod] = useState("7");

  const fileInputRef = useRef(null);
  // Saved contact list (shared with the Contacts page, stored in MongoDB)
  const [audience, setAudience] = useState([]);
  const [audienceFile, setAudienceFile] = useState("");

  // Only valid numbers are used for broadcast: [{ name, phone }]
  const contacts = audience
    .filter((c) => c.status === "Valid")
    .map((c) => ({
      name: c.name,
      phone: String(c.phone || "").replace(/\D/g, ""),
    }))
    .filter((c) => c.phone.length >= 11);
  const [importPreview, setImportPreview] = useState(null);

  const [showBroadcast, setShowBroadcast] = useState(false);
  const [form, setForm] = useState({ name: "", template: "", vars: [] });
  const [sending, setSending] = useState(null); // { total, done }

  const navigate = useNavigate();
  const mediaRef = useRef(null);

  // live data from backend
  const [data, setData] = useState(null);
  const [statsError, setStatsError] = useState("");
  const [health, setHealth] = useState(null);
  const [socketOnline, setSocketOnline] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [liveCampaigns, setLiveCampaigns] = useState({});
  const [approved, setApproved] = useState([]);
  const [templatesError, setTemplatesError] = useState("");

  /* ---------- SAVED CONTACTS ---------- */

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/audience`);
        const json = await response.json();
        if (response.ok && json.success) {
          setAudience(json.contacts || []);
          setAudienceFile(json.fileName || "");
        }
      } catch (error) {
        console.error("Could not load saved contacts:", error.message);
      }
    })();
  }, []);

  /* ---------- LIVE STATS ---------- */

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE}/api/dashboard/stats?days=${selectedPeriod}`
      );
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.message || "Could not load dashboard stats.");
      }
      setData(json);
      setStatsError("");
      setLastSync(new Date());
    } catch (error) {
      setStatsError(
        error.message === "Failed to fetch"
          ? "Could not reach the backend. Check that the server is running and CORS is configured."
          : error.message
      );
    }
  }, [selectedPeriod]);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/health`);
      setHealth(await response.json());
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadHealth();

    const poll = setInterval(() => {
      loadStats();
      loadHealth();
    }, 30000);

    let debounce;
    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(loadStats, 600);
    };

    const socket = io(API_BASE, { transports: ["websocket", "polling"] });
    socket.on("connect", () => setSocketOnline(true));
    socket.on("disconnect", () => setSocketOnline(false));
    socket.on("message:new", refresh);
    socket.on("message:status", refresh);
    socket.on("campaign:progress", (campaign) =>
      setLiveCampaigns((prev) => ({ ...prev, [campaign.id]: campaign }))
    );
    socket.on("campaign:done", (campaign) => {
      setLiveCampaigns((prev) => {
        const next = { ...prev };
        delete next[campaign.id];
        return next;
      });
      refresh();
    });

    return () => {
      clearInterval(poll);
      clearTimeout(debounce);
      socket.disconnect();
    };
  }, [loadStats, loadHealth]);

  // Approved templates for the broadcast modal
  const openBroadcast = async () => {
    setShowBroadcast(true);
    setTemplatesError("");
    try {
      const response = await fetch(`${API_BASE}/api/templates`);
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.message || "Could not load templates.");
      }
      const list = (json.templates || [])
        .filter((item) => item.status === "APPROVED")
        .map((item) => {
          const comps = item.components || [];
          const body = comps.find((c) => c.type === "BODY");
          const header = comps.find((c) => c.type === "HEADER");
          const varCount = new Set(
            [...String(body?.text || "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])
          ).size;
          return {
            key: `${item.name}|${item.language}`,
            name: item.name,
            language: item.language,
            headerFormat: header?.format || "NONE",
            varCount,
            body: body?.text || "",
          };
        });
      setApproved(list);
      setForm((f) => ({ ...f, template: f.template || list[0]?.key || "" }));
    } catch (error) {
      setTemplatesError(error.message);
    }
  };

  /* ---------- CSV IMPORT ---------- */

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Sirf .csv file select karo");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = processCSV(String(reader.result), contacts);
      setImportPreview({ fileName: file.name, ...result });
    };
    reader.readAsText(file);
    e.target.value = ""; // same file dobara select ho sake
  };

  const confirmImport = async () => {
    const stamp = Date.now();
    const records = importPreview.valid.map((c, index) => ({
      id: stamp + index,
      initials: (c.name === "—" ? "" : c.name)
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || "")
        .join("")
        .toUpperCase(),
      name: c.name,
      company: "Imported",
      phone: `+${c.phone}`,
      email: "—",
      country: "Unknown",
      status: "Valid",
      selected: true,
    }));

    const next = [...records, ...audience];
    const fileName = importPreview.fileName;

    setAudience(next);
    setAudienceFile(fileName);
    setImportPreview(null);

    // Save to database so the list is still there after refresh
    try {
      const response = await fetch(`${API_BASE}/api/audience`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: next, fileName }),
      });
      if (!response.ok) throw new Error("Save failed");
    } catch {
      alert("Contacts import ho gaye, lekin database me save nahi hue. Backend check karo.");
    }
  };

  /* ---------- BROADCAST ---------- */

  const selectedTemplate = approved.find((t) => t.key === form.template);

  const startBroadcast = async () => {
    if (!form.name.trim()) return alert("Campaign name daalo");
    if (!selectedTemplate) return alert("Ek approved template select karo");
    if (!contacts.length) return alert("Pehle CSV import karo");

    const tpl = selectedTemplate;
    const vars = form.vars.slice(0, tpl.varCount);
    if (vars.length < tpl.varCount || vars.some((v) => !String(v || "").trim())) {
      return alert(`Is template ke ${tpl.varCount} variable(s) bharo.`);
    }

    const total = contacts.length;
    let sent = 0;
    let failed = 0;
    let firstError = "";

    try {
      // IMAGE / VIDEO / DOCUMENT header needs the file on every send
      let headerMedia = null;
      if (MEDIA_FORMATS.includes(tpl.headerFormat)) {
        const file = mediaRef.current?.files?.[0];
        if (!file) return alert(`Is template ke liye ${tpl.headerFormat.toLowerCase()} file chuno.`);

        const kind = tpl.headerFormat.toLowerCase();
        const upload = await fetch(
          `${API_BASE}/api/media/upload?kind=${kind}&filename=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          }
        );
        const uploaded = await upload.json().catch(() => ({}));
        if (!upload.ok || !uploaded.mediaId) {
          throw new Error(uploaded.message || "Media upload failed.");
        }
        headerMedia = { id: uploaded.mediaId, kind, filename: file.name };
      }

      setShowBroadcast(false);
      setSending({ total, done: 0 });

      for (let i = 0; i < contacts.length; i += BROADCAST_CHUNK) {
        const chunk = contacts.slice(i, i + BROADCAST_CHUNK);

        const response = await fetch(`${API_BASE}/api/campaign/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignName: form.name.trim(),
            template: { name: tpl.name, language: tpl.language },
            ...(headerMedia ? { headerMedia } : {}),
            contacts: chunk.map((c) => ({
              phone: c.phone,
              name: c.name,
              // {{name}} in a value is replaced with each contact's name
              parameters: vars.map((v) =>
                String(v).replaceAll("{{name}}", c.name && c.name !== "—" ? c.name : "Customer")
              ),
            })),
          }),
        });

        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.success) {
          throw new Error(json.message || "Campaign send failed.");
        }

        sent += json.sent || 0;
        failed += json.failed || 0;
        if (!firstError) {
          firstError = (json.results || []).find((r) => r.status === "failed")?.error || "";
        }
        setSending({ total, done: Math.min(total, i + chunk.length) });
      }
    } catch (error) {
      alert(error.message || "Broadcast failed.");
    } finally {
      setSending(null);
      setForm({ name: "", template: form.template, vars: [] });
      loadStats();
      if (sent + failed > 0) {
        alert(
          `Broadcast complete: ${sent} sent, ${failed} failed.` +
            (firstError ? `\nFirst error: ${firstError}` : "")
        );
      }
    }
  };

  /* ---------- STATS ---------- */

  const d = data || {};
  const liveList = Object.values(liveCampaigns);
  const sendingNow = liveList.length
    ? liveList.reduce((sum, c) => sum + Math.max(0, c.total - c.done), 0)
    : sending
    ? sending.total - sending.done
    : 0;
  const sendingLabel = liveList[0]?.name || (sending ? "Broadcast" : "No active campaign");
  const changeUp = (d.sentChangePct ?? 0) >= 0;

  const stats = [
    {
      title: "MESSAGES SENT",
      value: String(d.sent ?? 0),
      icon: Send,
      iconBg: "bg-indigo-100",
      iconColor: "text-emerald-700",
      badge: formatChange(d.sentChangePct),
      badgeBg: changeUp ? "bg-green-200" : "bg-red-100",
      badgeColor: changeUp ? "text-green-800" : "text-red-700",
      description: `vs previous ${selectedPeriod} days`,
    },
    {
      title: "MESSAGES READ",
      value: String(d.read ?? 0),
      icon: CheckCheck,
      iconBg: "bg-indigo-100",
      iconColor: "text-blue-700",
      badge: `${d.readRate ?? 0}% read rate`,
      badgeBg: "bg-blue-100",
      badgeColor: "text-blue-800",
      description: `${d.delivered ?? 0} delivered`,
    },
    {
      title: "CONVERSATIONS",
      value: String(d.conversations ?? 0),
      icon: MessageSquare,
      iconBg: "bg-indigo-100",
      iconColor: "text-indigo-700",
      badge: `${d.replyRate ?? 0}% reply rate`,
      badgeBg: "bg-green-200",
      badgeColor: "text-green-800",
      description: `${d.replied ?? 0} of ${d.recipients ?? 0} contacts replied`,
    },
    {
      title: "SENDING NOW",
      value: String(sendingNow),
      icon: RefreshCw,
      iconBg: "bg-green-200",
      iconColor: "text-green-800",
      valueColor: "text-green-700",
      badge: sendingLabel,
      badgeBg: "bg-indigo-100",
      badgeColor: "text-indigo-800",
      description: "Active campaign",
    },
    {
      title: "FAILED / BOUNCE",
      value: String(d.failed ?? 0),
      icon: CircleAlert,
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      badge: `${d.failRate ?? 0}% fail rate`,
      badgeBg: "bg-red-100",
      badgeColor: "text-red-700",
      description: "Rejected or undelivered",
    },
    {
      title: "CLOUD QUEUE",
      value: String(d.queued ?? 0),
      icon: Layers,
      iconBg: "bg-indigo-100",
      iconColor: "text-indigo-700",
      badge: "Awaiting delivery",
      badgeBg: "bg-indigo-100",
      badgeColor: "text-indigo-800",
      description: "Sent in last 15 min, not delivered yet",
    },
  ];

  const gatewayHealthy = Boolean(
    health?.ok && health.whatsappConfigured && health.database === "connected"
  );

  const periods = [
    { label: "Last 7 Days", value: "7" },
    { label: "Last 30 Days", value: "30" },
    { label: "Last 90 Days", value: "90" },
  ];

  return (
    <div className="min-h-screen bg-[#f8f9ff] p-5 md:p-6">
      {/* TOP SECTION */}
      <section className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        {/* TITLE */}
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-200 px-2.5 py-1 text-[11px] font-medium text-green-800">
              <span className="h-2 w-2 rounded-full bg-green-600" />
              Direct Cloud API {health?.apiVersion || "—"}
            </span>

            <span className="font-mono text-[11px] tracking-wide text-slate-500">
              WABA-ID: {health?.wabaId || "not configured"}
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-[32px]">
            Campaign Dashboard
          </h1>

          <p className="mt-1 max-w-lg text-sm leading-5 text-slate-600">
            Real-time WhatsApp transmission intelligence,
            <br className="hidden md:block" />
            audience reach, and conversation conversions.
          </p>
        </div>

        {/* ACTIONS */}
        <div className="flex flex-wrap items-center gap-2">
          {/* hidden CSV input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="hidden"
          />

          {/* DATE FILTER */}
          <div className="flex rounded-xl bg-[#eef0ff] p-1">
            {periods.map((period) => (
              <button
                key={period.value}
                onClick={() => setSelectedPeriod(period.value)}
                className={`min-w-[65px] rounded-lg px-3 py-2 text-xs font-medium transition ${
                  selectedPeriod === period.value
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-slate-600 hover:bg-white/60"
                }`}
              >
                {period.label.split(" ").slice(0, 1).join(" ")}
                <br />
                <span className="font-semibold">
                  {period.label.split(" ")[1]} {period.label.split(" ")[2]}
                </span>
              </button>
            ))}
          </div>

          {/* IMPORT CONTACTS */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-[#eef0ff] px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-indigo-100"
          >
            <FileUp size={16} className="text-emerald-700" />
            <span>
              Import
              <br />
              Contacts
            </span>
          </button>

          {/* CREATE TEMPLATE */}
          <button
            onClick={() => navigate("/yourtemplates")}
            className="flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-[#e4e8fc] px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-indigo-200"
          >
            <PlusCircle size={16} className="text-emerald-700" />
            <span>
              Create
              <br />
              Template
            </span>
          </button>

          {/* LAUNCH BROADCAST */}
          <button
            onClick={openBroadcast}
            className="flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-green-800"
          >
            <Rocket size={18} />
            <span>
              Launch
              <br />
              Broadcast
            </span>
          </button>
        </div>
      </section>

      {/* CONNECTION STATUS BAR */}
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ring-4 ${
                gatewayHealthy
                  ? "bg-green-700 ring-green-100"
                  : "bg-red-600 ring-red-100"
              }`}
            />
            <span className="font-medium text-slate-700">
              {gatewayHealthy
                ? "WhatsApp Cloud API Connected"
                : health
                ? "WhatsApp API not configured"
                : "Backend offline"}
            </span>
          </div>
          <span className="hidden text-slate-300 sm:inline">•</span>
          <span>Database: {health?.database || "unknown"}</span>
          <span className="hidden text-slate-300 sm:inline">•</span>
          <span>
            Webhook: {health?.webhookConfigured ? "token set" : "not configured"}
          </span>
          <span className="hidden text-slate-300 sm:inline">•</span>
          <span>Contacts: {contacts.length}</span>
        </div>

        <div
          className={`flex items-center gap-1.5 text-xs font-medium ${
            socketOnline ? "text-green-700" : "text-amber-600"
          }`}
        >
          <RefreshCw size={13} />
          <span>
            {socketOnline ? "Live" : "Reconnecting"}
            {lastSync ? ` · synced ${lastSync.toLocaleTimeString()}` : ""}
          </span>
        </div>
      </section>

      {statsError && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
          {statsError}
        </div>
      )}

      {/* ANALYTICS CARDS */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <div
              key={stat.title}
              className="group min-w-0 rounded-xl border border-slate-100 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-md"
            >
              {/* CARD HEADER */}
              <div className="flex min-h-[38px] items-start justify-between gap-2">
                <h3 className="max-w-[125px] text-[11px] font-medium leading-[15px] tracking-wide text-slate-600">
                  {stat.title}
                </h3>

                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stat.iconBg} ${stat.iconColor}`}
                >
                  <Icon size={17} strokeWidth={2} />
                </div>
              </div>

              {/* VALUE */}
              <div
                className={`mt-4 whitespace-nowrap text-[29px] font-bold leading-none tracking-tight ${
                  stat.valueColor || "text-slate-950"
                }`}
              >
                {stat.value}
              </div>

              {/* FOOTER */}
              <div className="mt-4 flex min-h-[43px] flex-wrap items-start gap-1.5">
                <span
                  className={`inline-block max-w-full rounded px-1.5 py-1 text-[10px] font-semibold leading-3 ${stat.badgeBg} ${stat.badgeColor}`}
                >
                  {stat.badge}
                </span>

                <span className="min-w-0 flex-1 text-[10px] leading-4 text-slate-500">
                  {stat.description}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* BOTTOM INFORMATION */}
      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-700">
            <Activity size={20} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Gateway Performance
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              API connection and message delivery health monitoring.
            </p>
          </div>

          <span
            className={`ml-auto rounded-full px-2 py-1 text-[10px] font-semibold ${
              gatewayHealthy
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-700"
            }`}
          >
            {gatewayHealthy ? "Healthy" : "Check config"}
          </span>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
            <Cloud size={20} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Cloud Queue Status
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Monitor queued messages and active broadcast workloads.
            </p>
          </div>

          <span className="ml-auto rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-semibold text-indigo-800">
            {d.queued ?? 0} pending
          </span>
        </div>
      </section>

      {/* SHOPIFY TEMPLATE VERIFICATION */}
      <ShopifyTemplateCheck />

      {/* SHOPIFY ACTIVITY (customers, checkouts, orders) */}
      <ShopifyActivityFeed />

      {/* RECENT FAILURES */}
      {d.recentFailures?.length > 0 && (
        <section className="mt-6 rounded-xl border border-red-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Recent failed messages
          </h3>
          <div className="mt-3 divide-y divide-slate-100 text-xs">
            {d.recentFailures.map((item, index) => (
              <div key={index} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-mono text-slate-600">+{item.waId}</span>
                <span className="text-slate-500">{item.templateName || "message"}</span>
                <span className="max-w-[55%] text-red-600">{item.errorMessage || "Failed"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* IMPORT PREVIEW MODAL */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                Import Contacts
              </h2>
              <button onClick={() => setImportPreview(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {importPreview.fileName}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-green-100 p-3 text-green-800">
                <div className="text-xl font-bold">
                  {importPreview.valid.length}
                </div>
                Valid
              </div>
              <div className="rounded-lg bg-amber-100 p-3 text-amber-800">
                <div className="text-xl font-bold">
                  {importPreview.duplicates}
                </div>
                Duplicate
              </div>
              <div className="rounded-lg bg-red-100 p-3 text-red-700">
                <div className="text-xl font-bold">
                  {importPreview.invalid}
                </div>
                Invalid
              </div>
            </div>

            {importPreview.valid.length > 0 && (
              <div className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-slate-100 text-xs">
                {importPreview.valid.slice(0, 5).map((c) => (
                  <div
                    key={c.phone}
                    className="flex justify-between border-b border-slate-50 px-3 py-2"
                  >
                    <span>{c.name}</span>
                    <span className="font-mono text-slate-500">
                      +{c.phone}
                    </span>
                  </div>
                ))}
                {importPreview.valid.length > 5 && (
                  <div className="px-3 py-2 text-slate-400">
                    +{importPreview.valid.length - 5} aur...
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setImportPreview(null)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                disabled={!importPreview.valid.length}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Import {importPreview.valid.length} contacts
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LAUNCH BROADCAST MODAL */}
      {showBroadcast && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                Launch Broadcast
              </h2>
              <button onClick={() => setShowBroadcast(false)}>
                <X size={18} />
              </button>
            </div>

            <label className="mt-4 block text-xs font-medium text-slate-600">
              Campaign name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Diwali Offer"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-green-600"
            />

            <label className="mt-3 block text-xs font-medium text-slate-600">
              Approved template
            </label>
            <select
              value={form.template}
              onChange={(e) => setForm({ ...form, template: e.target.value, vars: [] })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {approved.length === 0 && <option value="">No approved templates</option>}
              {approved.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            {templatesError && (
              <p className="mt-1 text-[11px] text-red-600">{templatesError}</p>
            )}

            {selectedTemplate && (
              <p className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                {selectedTemplate.body}
              </p>
            )}

            {Array.from({ length: selectedTemplate?.varCount || 0 }).map((_, index) => (
              <input
                key={index}
                value={form.vars[index] || ""}
                onChange={(e) => {
                  const vars = [...form.vars];
                  vars[index] = e.target.value;
                  setForm({ ...form, vars });
                }}
                placeholder={`Value for {{${index + 1}}}  (use {{name}} for contact name)`}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-green-600"
              />
            ))}

            {MEDIA_FORMATS.includes(selectedTemplate?.headerFormat) && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-600">
                  {selectedTemplate.headerFormat.toLowerCase()} for header
                </label>
                <input
                  ref={mediaRef}
                  type="file"
                  accept={
                    selectedTemplate.headerFormat === "IMAGE"
                      ? "image/jpeg,image/png"
                      : selectedTemplate.headerFormat === "VIDEO"
                      ? "video/mp4"
                      : "application/pdf"
                  }
                  className="mt-1 w-full text-xs"
                />
              </div>
            )}

            <div className="mt-3 rounded-lg bg-[#eef0ff] p-3 text-xs text-slate-700">
              Audience: <b>{contacts.length}</b> contacts
              {contacts.length === 0 && (
                <span className="text-red-600">
                  {" "}
                  — pehle CSV import karo
                </span>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowBroadcast(false)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={startBroadcast}
                disabled={contacts.length === 0 || !selectedTemplate}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Send Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;