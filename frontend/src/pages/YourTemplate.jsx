import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  CheckCircle2,
  FileText,
  Copy,
  Pencil,
  MoreVertical,
  ExternalLink,
  Phone,
  Code2,
  X,
  CheckCheck,
  Send,
  MessageSquareText,
  CalendarDays,
  Trash2,
  Image as ImageIcon,
  Video as VideoIcon,
  UploadCloud,
  Loader2,
} from "lucide-react";

/* ================= MEDIA STORAGE (IndexedDB) =================
   Files localStorage me nahi jaati (size limit ~5MB), isliye
   image / video / document IndexedDB me save hoti hai.
   Page refresh ke baad bhi preview wapas dikhega.
=============================================================== */

const DB_NAME = "reachpulse_media";
const STORE = "files";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putBlob(key, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getBlob(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ================= MEDIA HELPERS ================= */

const MEDIA_RULES = {
  image: {
    label: "Image",
    accept: "image/jpeg,image/png,image/webp",
    maxMB: 5,
    hint: "JPG, PNG, WEBP (max 5 MB)",
  },
  video: {
    label: "Video",
    accept: "video/mp4,video/3gpp",
    maxMB: 16,
    hint: "MP4, 3GP (max 16 MB)",
  },
  document: {
    label: "Document",
    accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv",
    maxMB: 100,
    hint: "PDF, DOC, XLS, PPT, TXT, CSV (max 100 MB)",
  },
};

const DOC_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"];

const getExt = (name = "") =>
  name.includes(".") ? name.split(".").pop().toLowerCase() : "";

const formatSize = (bytes) => {
  if (!bytes) return "";
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function validateFile(kind, file) {
  const rule = MEDIA_RULES[kind];
  const ext = getExt(file.name);

  const typeOk =
    kind === "image"
      ? file.type.startsWith("image/")
      : kind === "video"
      ? file.type.startsWith("video/")
      : DOC_EXTENSIONS.includes(ext);

  if (!typeOk) return `Galat file type. Allowed: ${rule.hint}`;
  if (file.size > rule.maxMB * 1024 * 1024) {
    return `File bahut badi hai. ${rule.label} ka max size ${rule.maxMB} MB hai.`;
  }
  return "";
}

// Purane templates (jinme sirf `image` URL tha) bhi chalte rahein
function getMedia(template) {
  if (template.media) return template.media;
  if (template.image) {
    return { kind: "image", source: "url", url: template.image, name: "image" };
  }
  return null;
}

// Stored media se displayable src nikalta hai.
// Save ke turant baad media.src (memory ka link) milta hai -> preview instantly dikhta hai.
// Refresh ke baad media.src nahi hota, tab file IndexedDB se wapas padhi jaati hai.
function useMediaSrc(media) {
  const [state, setState] = useState({ src: "", missing: false });
  const key = media
    ? media.src || (media.source === "url" ? media.url : media.mediaId)
    : "";

  useEffect(() => {
    if (!media || media.src || media.source === "url") return undefined;

    let cancelled = false;
    let objectUrl = "";
    setState({ src: "", missing: false });

    getBlob(media.mediaId)
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setState({ src: objectUrl, missing: false });
        } else {
          setState({ src: "", missing: true });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ src: "", missing: true });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!media) return { src: "", missing: false };
  if (media.src) return { src: media.src, missing: false };
  if (media.source === "url") return { src: media.url, missing: false };
  return state;
}

/* ================= MEDIA VIEW (image / video / document) ================= */

function MediaView({ kind, src, name, size, alt, missing }) {
  if (missing) {
    return (
      <div className="flex h-32 w-full flex-col items-center justify-center gap-1 bg-slate-100 px-4 text-center text-[11px] text-slate-500">
        <FileText size={18} />
        {name || "Media"} ka preview nahi mil raha. Template edit karke file dobara upload karo.
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex h-32 w-full items-center justify-center gap-2 bg-slate-100 text-[11px] text-slate-400">
        <Loader2 size={14} className="animate-spin" />
        Loading media...
      </div>
    );
  }

  if (kind === "image") {
    return (
      <img
        src={src}
        alt={alt || name || "Template header"}
        className="max-h-56 w-full bg-slate-100 object-cover"
      />
    );
  }

  if (kind === "video") {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className="max-h-56 w-full bg-black object-contain"
      />
    );
  }

  // document
  const ext = getExt(name).toUpperCase() || "DOC";

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      download={name}
      className="flex items-center gap-3 bg-slate-100 p-3 hover:bg-slate-200/70"
      title="Open / download document"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm">
        <FileText size={22} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-slate-800">
          {name || "Document"}
        </p>
        <p className="text-[10px] text-slate-500">
          {ext}
          {size ? ` • ${formatSize(size)}` : ""}
        </p>
      </div>

      <ExternalLink size={14} className="shrink-0 text-slate-400" />
    </a>
  );
}

function MediaPreview({ media, alt }) {
  const { src, missing } = useMediaSrc(media);

  return (
    <MediaView
      kind={media.kind}
      src={src}
      missing={missing}
      name={media.name}
      size={media.size}
      alt={alt}
    />
  );
}

/* ================= DATA ================= */

const initialTemplates = [];

const badgeStyles = {
  Marketing: "bg-emerald-50 text-emerald-700",
  Utility: "bg-blue-50 text-blue-700",
  Authentication: "bg-violet-50 text-violet-700",
  Approved: "bg-green-100 text-green-800",
  Pending: "bg-amber-100 text-amber-800",
  Rejected: "bg-red-100 text-red-700",
  Paused: "bg-slate-100 text-slate-600",
};

function Badge({ children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

/* ================= TEMPLATE CARD ================= */

function TemplateCard({
  template,
  onEdit,
  onDuplicate,
  onPreview,
  onDelete,
  onCampaign,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const media = getMedia(template);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText("{{1}}");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-emerald-200 hover:shadow-md sm:p-4">
      {/* CARD HEADER */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-all text-xs font-bold text-slate-800 sm:text-sm">
            {template.name}
          </h3>

          <div className="mt-2 flex flex-wrap gap-1">
            <Badge className={badgeStyles[template.category]}>
              {template.category}
            </Badge>

            <Badge className="bg-slate-100 text-slate-600">
              {template.language}
            </Badge>

            <Badge className={badgeStyles[template.status]}>
              <CheckCircle2 className="mr-1" size={11} />
              {template.status}
            </Badge>

            {media && (
              <Badge className="gap-1 bg-slate-100 text-slate-600">
                {media.kind === "image" && <ImageIcon size={11} />}
                {media.kind === "video" && <VideoIcon size={11} />}
                {media.kind === "document" && <FileText size={11} />}
                {MEDIA_RULES[media.kind].label}
              </Badge>
            )}
          </div>
        </div>

        <div className="relative flex shrink-0 items-center gap-1">
          <button
            onClick={() => onEdit(template)}
            title="Edit template"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-emerald-700"
          >
            <Pencil size={15} />
          </button>

          <button
            onClick={() => onDuplicate(template)}
            title="Duplicate template"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-emerald-700"
          >
            <Copy size={15} />
          </button>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            title="More options"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <MoreVertical size={16} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <button
                onClick={() => {
                  onPreview(template);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-slate-50"
              >
                <Code2 size={14} /> Preview JSON
              </button>

              <button
                onClick={() => {
                  onDuplicate(template);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-slate-50"
              >
                <Copy size={14} /> Duplicate
              </button>

              <button
                onClick={() => {
                  onDelete(template);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* WHATSAPP MESSAGE PREVIEW */}
      <div className="rounded-xl border border-emerald-100 bg-[#f0f7f1] p-2.5 sm:p-3">
        <div className="mx-auto max-w-[340px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <MessageSquareText size={13} />
            </div>

            <div>
              <p className="text-[10px] font-semibold text-slate-800">
                Your Business
              </p>
              <p className="text-[9px] text-slate-400">
                WhatsApp message preview
              </p>
            </div>
          </div>

          {media && (
            <MediaPreview
              media={media}
              alt={`${template.name} template header`}
            />
          )}

          <div className="p-3">
            {template.header && (
              <h4 className="mb-2 text-xs font-bold text-slate-800">
                {template.header}
              </h4>
            )}

            <p className="whitespace-pre-wrap break-words text-[11px] leading-[1.65] text-slate-700">
              {template.body}
            </p>

            {template.footer && (
              <p className="mt-2 text-[9px] text-slate-400">
                {template.footer}
              </p>
            )}

            <p className="mt-2 text-right text-[9px] text-slate-400">
              10:42 AM
            </p>
          </div>

          <div className="border-t border-slate-100 p-2">
            {(template.buttons || []).map(normalizeButton).map((button, index) => {
              const isCopy = button.text.toLowerCase().includes("copy");
              const Icon =
                button.type === "URL" ? ExternalLink
                : button.type === "PHONE_NUMBER" ? Phone
                : isCopy ? Copy
                : CheckCheck;
              return (
                <button
                  key={`${button.text}-${index}`}
                  onClick={isCopy ? copyCode : undefined}
                  title={button.type === "URL" ? button.url : button.type === "PHONE_NUMBER" ? button.phone : undefined}
                  className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-100 py-2 text-[10px] font-semibold text-emerald-700 last:mb-0 hover:bg-emerald-50"
                >
                  <Icon size={12} />
                  {isCopy && copied ? "Copied!" : button.text}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ANALYTICS */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-[#f2f4ff] p-2">
          <p className="text-[9px] leading-3 text-slate-500">
            Total Broadcasts
          </p>
          <p className="mt-1 text-sm font-bold text-slate-800">
            {template.broadcasts}
          </p>
          <p className="text-[9px] text-emerald-700">All campaigns</p>
        </div>

        <div className="rounded-md bg-[#f2f4ff] p-2">
          <p className="text-[9px] leading-3 text-slate-500">
            Delivery Rate
          </p>
          <p className="mt-1 text-sm font-bold text-slate-800">
            {template.delivery}
          </p>
          <p className="text-[9px] text-emerald-700">Delivery metric</p>
        </div>

        <div className="rounded-md bg-[#f2f4ff] p-2">
          <p className="text-[9px] leading-3 text-slate-500">
            Health Rating
          </p>
          <p className="mt-1 text-sm font-bold text-emerald-700">
            {template.health}
          </p>
          <p className="text-[9px] text-slate-500">Template health</p>
        </div>
      </div>

      {/* FOOTER */}
      <div className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[9px] text-slate-500">
          <span>Created: {template.created}</span>
          <span>Modified: {template.modified}</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onPreview(template)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Code2 size={13} />
            Preview JSON
          </button>

          <button
            onClick={() => onCampaign(template)}
            disabled={template.status !== "Approved" || template.source !== "meta"}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-700 px-2 py-2 text-[10px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Send size={13} />
            Send Campaign
          </button>
        </div>
      </div>
    </article>
  );
}


import { API_BASE } from '../lib/apiBase';

const LANGUAGE_TO_META = {
  "English (US)": "en_US",
  "English (UK)": "en_GB",
  Hindi: "hi",
};

const LANGUAGE_FROM_META = {
  en_US: "English (US)",
  en_GB: "English (UK)",
  hi: "Hindi",
};

/* ================= BUTTON HELPERS ================= */

const BUTTON_TYPE_LABEL = {
  QUICK_REPLY: "Quick reply",
  URL: "Website link",
  PHONE_NUMBER: "Call button",
};

// Old drafts store buttons as plain strings; Meta buttons carry a type.
function normalizeButton(button) {
  if (typeof button === "string") {
    return { type: "QUICK_REPLY", text: button, url: "", phone: "" };
  }
  return {
    type: button?.type || "QUICK_REPLY",
    text: button?.text || "",
    url: button?.url || "",
    phone: button?.phone || button?.phone_number || "",
  };
}

function validateButtons(list) {
  const out = [];
  for (const raw of list || []) {
    const button = normalizeButton(raw);
    const text = button.text.trim();

    if (!text) return { error: "Every button needs a label (or remove the empty button)." };
    if (text.length > 25) return { error: `Button label "${text}" is longer than 25 characters.` };

    if (button.type === "URL") {
      const url = button.url.trim();
      if (!/^https:\/\/[^\s{}]+$/i.test(url)) {
        return { error: `Button "${text}": enter a full https:// link without variables.` };
      }
      out.push({ type: "URL", text, url });
    } else if (button.type === "PHONE_NUMBER") {
      const digits = button.phone.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) {
        return { error: `Button "${text}": enter the phone number with country code, e.g. +919876543210.` };
      }
      out.push({ type: "PHONE_NUMBER", text, phone: `+${digits}` });
    } else {
      out.push({ type: "QUICK_REPLY", text });
    }
  }
  if (out.filter((b) => b.type === "URL").length > 2) return { error: "Use at most 2 website buttons." };
  if (out.filter((b) => b.type === "PHONE_NUMBER").length > 1) return { error: "Use at most 1 call button." };
  if (out.length > 10) return { error: "Use at most 10 buttons." };
  return { buttons: out };
}

/* ================= STARTER TEMPLATES =================
   Names, variable order and variable count match what the backend sends
   (order_confirmation: name, order no., total. abandoned_cart: name, checkout link).
   Rules followed so Meta approves them: text never starts/ends with a variable,
   every variable has an example, links are fixed https links.
======================================================== */

function buildStarterTemplates({ storeName, storeUrl, phone }) {
  const store = storeName;
  const shop = { type: "URL", text: "Visit store", url: storeUrl };
  const call = phone ? [{ type: "PHONE_NUMBER", text: "Call us", phone }] : [];

  return [
    {
      name: "order_confirmation",
      label: "Order confirmation",
      purpose: "Sent automatically when a customer places an order.",
      category: "UTILITY",
      body: `Hi {{1}}, thank you for your order {{2}} at ${store}. We have received your payment of {{3}} and will update you as soon as it ships.`,
      bodyExamples: ["Rahul", "#1001", "Rs. 1,499.00"],
      footer: "Reply here if you need help",
      buttons: [{ type: "QUICK_REPLY", text: "Need help" }],
    },
    {
      name: "abandoned_cart",
      label: "Abandoned cart reminder",
      purpose: "Sent ~45 minutes after checkout is left unfinished.",
      category: "MARKETING",
      body: `Hi {{1}}, you left items in your cart at ${store}. Complete your order here: {{2}} Your items may sell out soon.`,
      bodyExamples: ["Rahul", `${storeUrl}/checkout/abc123`],
      footer: "",
      buttons: [shop],
    },
    {
      name: "order_shipped",
      label: "Order shipped",
      purpose: "Shopify Flow: send when an order is fulfilled.",
      category: "UTILITY",
      body: `Hi {{1}}, good news! Your order {{2}} from ${store} has shipped and is on its way. Track your package here: {{3}} Thank you for shopping with us.`,
      bodyExamples: ["Rahul", "#1001", `${storeUrl}/track/AB123`],
      footer: "",
      buttons: [],
    },
    {
      name: "order_delivered_feedback",
      label: "Delivered + feedback",
      purpose: "Shopify Flow: ask for feedback after delivery. Replies open the chat.",
      category: "MARKETING",
      body: `Hi {{1}}, your order {{2}} from ${store} was delivered. We hope you love it! How was your experience?`,
      bodyExamples: ["Rahul", "#1001"],
      footer: "",
      buttons: [
        { type: "QUICK_REPLY", text: "Loved it" },
        { type: "QUICK_REPLY", text: "Could be better" },
      ],
    },
    {
      name: "welcome_offer",
      label: "Welcome / repeat-purchase offer",
      purpose: "Campaigns: invite new buyers back with a discount code.",
      category: "MARKETING",
      body: `Welcome to ${store}, {{1}}! Enjoy {{2}} off your next order with code {{3}}. The offer is valid for 7 days.`,
      bodyExamples: ["Rahul", "10%", "WELCOME10"],
      footer: "",
      buttons: [{ type: "URL", text: "Shop now", url: storeUrl }, ...call],
    },
  ].map((item) => ({
    ...item,
    language: "en_US",
    header: "",
    headerFormat: "TEXT",
  }));
}

function StarterPackModal({ existingKeys, onClose, onDone }) {
  const [storeName, setStoreName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");

  const cleanStore = storeName.replace(/[{}\n\r]/g, " ").trim().slice(0, 40);
  const cleanUrl = storeUrl.trim().replace(/\/+$/, "");
  const phoneDigits = phone.replace(/\D/g, "");

  const preview = buildStarterTemplates({
    storeName: cleanStore || "Your Store",
    storeUrl: cleanUrl || "https://yourstore.com",
    phone: phoneDigits ? `+${phoneDigits}` : "",
  });

  const pending = preview.filter((item) => !existingKeys.has(`${item.name}|en_US`));

  async function submitAll() {
    setError("");

    if (!cleanStore) return setError("Enter your store name.");
    if (!/^https:\/\/[^\s{}]+$/i.test(cleanUrl)) {
      return setError("Enter your store link starting with https://");
    }
    if (phoneDigits && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
      return setError("Support phone must include the country code, e.g. +919876543210.");
    }

    setRunning(true);
    const out = [];

    for (const item of pending) {
      const { label, purpose, ...payload } = item; // eslint-disable-line no-unused-vars
      try {
        const response = await fetch(`${API_BASE}/api/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
          const detail =
            data.details?.error?.error_user_msg || data.details?.error?.message || data.message;
          throw new Error(detail || "Submission failed.");
        }
        out.push({ name: item.name, ok: true, text: `Submitted (${data.template?.status || "PENDING"})` });
      } catch (err) {
        out.push({ name: item.name, ok: false, text: err.message });
      }
      setResults([...out]);
      await new Promise((resolve) => setTimeout(resolve, 600)); // be gentle with Meta's rate limit
    }

    setRunning(false);
    onDone();
  }

  const inputClass =
    "mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="my-auto w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Starter templates</h2>
            <p className="mt-1 text-xs text-slate-500">
              Creates the 5 templates your Shopify automation needs and sends them to Meta for approval.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={19} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Store name *
              <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Acme Store" maxLength={40} className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Store link *
              <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://acme.com" className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
              Support phone (optional, adds a “Call us” button on the offer)
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" className={inputClass} />
            </label>
          </div>

          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {preview.map((item) => {
              const exists = existingKeys.has(`${item.name}|en_US`);
              const result = results?.find((r) => r.name === item.name);
              return (
                <li key={item.name} className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {item.label} <span className="font-mono text-[11px] font-normal text-slate-400">{item.name}</span>
                    </p>
                    <span className="text-[10px] font-semibold text-slate-500">
                      {item.category === "UTILITY" ? "Utility" : "Marketing"}
                      {exists ? " • already on Meta, skipped" : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{item.purpose}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{item.body}</p>
                  {result && (
                    <p className={`mt-1 text-[11px] font-semibold ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
                      {result.ok ? "✓" : "✗"} {result.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

          <p className="text-[11px] leading-5 text-slate-500">
            Meta reviews every template (usually minutes, sometimes up to 24 hours) and may change the category.
            Use “Sync Meta Status” to see approvals. Keep these exact names: the Shopify automation looks them up by name.
          </p>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {results && !running ? "Done" : "Cancel"}
            </button>
            {!(results && !running) && (
              <button
                onClick={submitAll}
                disabled={running || pending.length === 0}
                className="flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {running && <Loader2 size={15} className="animate-spin" />}
                {running ? "Submitting..." : pending.length === 0 ? "All already created" : `Submit ${pending.length} to Meta`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function mapMetaStatus(status = "") {
  const normalized = status.toUpperCase();
  if (normalized === "APPROVED") return "Approved";
  if (normalized === "PENDING" || normalized === "IN_APPEAL") return "Pending";
  if (normalized === "REJECTED" || normalized === "DISABLED") return "Rejected";
  if (normalized === "PAUSED" || normalized === "LIMITED") return "Paused";
  return normalized || "Unknown";
}

function mapMetaTemplate(item) {
  const components = item.components || [];
  const header = components.find((part) => part.type === "HEADER");
  const body = components.find((part) => part.type === "BODY");
  const footer = components.find((part) => part.type === "FOOTER");
  const buttonComponent = components.find((part) => part.type === "BUTTONS");

  return {
    id: `meta-${item.id || item.name}-${item.language}`,
    metaId: item.id,
    name: item.name,
    category: item.category === "UTILITY" ? "Utility" :
      item.category === "MARKETING" ? "Marketing" :
      item.category === "AUTHENTICATION" ? "Authentication" : item.category,
    language: LANGUAGE_FROM_META[item.language] || item.language,
    languageCode: item.language,
    status: mapMetaStatus(item.status),
    metaStatus: item.status,
    header: header?.format === "TEXT" ? header.text || "" : "",
    headerFormat: header?.format || "TEXT",
    body: body?.text || "",
    bodyExamples: body?.example?.body_text?.[0] || [],
    footer: footer?.text || "",
    buttons: (buttonComponent?.buttons || []).map((button) => ({
      type: button.type === "URL" || button.type === "PHONE_NUMBER" ? button.type : "QUICK_REPLY",
      text: button.text || "",
      url: button.url || "",
      phone: button.phone_number || "",
    })),
    media: null,
    image: "",
    broadcasts: "—",
    delivery: "—",
    health: item.quality_score?.score || "—",
    created: "From Meta",
    modified: "Synced from Meta",
    rejectedReason: item.rejected_reason || "",
    source: "meta",
  };
}

/* ================= CREATE / EDIT MODAL ================= */

function TemplateModal({ template, onClose, onSave, onSubmitToMeta, submittingMeta }) {
  const initialMedia = template ? getMedia(template) : null;
  const isMeta = template?.source === "meta" && Boolean(template?.metaId);

  const [form, setForm] = useState(() => ({
    name: template?.name || "",
    category: template?.category || "Marketing",
    language: template?.language || "English (US)",
    header: template?.header || "",
    body: template?.body || "",
    footer: template?.footer || "",
    buttons: (template?.buttons || []).map(normalizeButton),
    bodyExamples: (template?.bodyExamples || []).join(", "),
  }));

  // media state
  const [mediaKind, setMediaKind] = useState(
    initialMedia?.kind ||
      (["IMAGE", "VIDEO", "DOCUMENT"].includes(template?.headerFormat)
        ? template.headerFormat.toLowerCase()
        : "none")
  );
  const [existing, setExisting] = useState(initialMedia); // already saved media
  const [file, setFile] = useState(null); // newly picked file
  const [localUrl, setLocalUrl] = useState("");
  const [urlInput, setUrlInput] = useState(
    initialMedia?.source === "url" ? initialMedia.url : ""
  );
  const [saving, setSaving] = useState(false);
  const [uploadingSample, setUploadingSample] = useState(false);

  const { src: existingSrc } = useMediaSrc(existing);

  // Naya file select hote hi turant preview ke liye object URL
  useEffect(() => {
    if (!file) {
      setLocalUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function updateField(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  function addButton(type) {
    setForm((previous) => ({
      ...previous,
      buttons: [...previous.buttons, { type, text: "", url: "", phone: "" }],
    }));
  }

  function updateButton(index, patch) {
    setForm((previous) => ({
      ...previous,
      buttons: previous.buttons.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function removeButton(index) {
    setForm((previous) => ({
      ...previous,
      buttons: previous.buttons.filter((_, i) => i !== index),
    }));
  }

  function changeKind(kind) {
    setMediaKind(kind);
    setFile(null);
    setUrlInput("");
    if (kind === "none" || (existing && existing.kind !== kind)) {
      setExisting(null);
    }
  }

  function handlePick(event) {
    const picked = event.target.files?.[0];
    event.target.value = ""; // same file dobara select ho sake
    if (!picked) return;

    const error = validateFile(mediaKind, picked);
    if (error) {
      alert(error);
      return;
    }

    setFile(picked);
    setUrlInput("");
    setExisting(null);
  }

  function removeMedia() {
    setFile(null);
    setUrlInput("");
    setExisting(null);
  }

  // Jo preview abhi dikhana hai
  const preview = (() => {
    if (mediaKind === "none") return null;
    if (file) {
      return { src: localUrl, name: file.name, size: file.size };
    }
    if (urlInput.trim()) {
      return {
        src: urlInput.trim(),
        name: urlInput.trim().split("?")[0].split("/").pop() || "media",
        size: 0,
      };
    }
    if (existing) {
      return { src: existingSrc, name: existing.name, size: existing.size };
    }
    return null;
  })();

  async function submitToMeta() {
    if (template?.source === "meta" && !isMeta) {
      alert("This template has no Meta id yet. Click “Sync Meta Status” first, then edit it.");
      return;
    }

    if (isMeta && template.status === "Pending") {
      alert("This template is still in Meta review. Wait for the decision before editing it.");
      return;
    }

    const buttonCheck = validateButtons(form.buttons);
    if (buttonCheck.error) {
      alert(buttonCheck.error);
      return;
    }

    if (
      isMeta &&
      template.status === "Approved" &&
      !window.confirm(
        "Saving sends this template back to Meta for review. Meta allows one edit per 24 hours (max 10 per 30 days). Continue?"
      )
    ) {
      return;
    }

    // IMAGE / VIDEO / DOCUMENT header: Meta needs a sample file uploaded first.
    let headerFormat = "TEXT";
    let headerHandle = "";

    if (mediaKind !== "none") {
      let sample = file;

      if (!sample && existing?.source === "file" && existing.mediaId) {
        try {
          sample = await getBlob(existing.mediaId);
        } catch {
          sample = null;
        }
      }

      if (!sample) {
        alert("Please choose a sample file (JPG/PNG for image, MP4 for video, PDF for document). Meta cannot use a URL as the sample.");
        return;
      }

      try {
        setUploadingSample(true);
        const uploadResponse = await fetch(
          `${API_BASE}/api/templates/upload-sample?kind=${mediaKind}&filename=${encodeURIComponent(sample.name || "sample")}`,
          {
            method: "POST",
            headers: { "Content-Type": sample.type || "application/octet-stream" },
            body: sample,
          }
        );
        const uploadResult = await uploadResponse.json().catch(() => ({}));

        if (!uploadResponse.ok || !uploadResult.headerHandle) {
          throw new Error(uploadResult.message || "Sample upload to Meta failed.");
        }

        headerFormat = mediaKind.toUpperCase();
        headerHandle = uploadResult.headerHandle;
      } catch (error) {
        alert(error.message || "Sample upload to Meta failed.");
        return;
      } finally {
        setUploadingSample(false);
      }
    }
    if (!form.name.trim() || !form.body.trim()) {
      alert("Please enter a template name and message body.");
      return;
    }
    const variableNumbers = [...form.body.matchAll(/\{\{(\d+)\}\}/g)]
      .map((match) => Number(match[1]));
    const uniqueNumbers = [...new Set(variableNumbers)].sort((a, b) => a - b);
    const examples = form.bodyExamples
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (uniqueNumbers.some((number, index) => number !== index + 1)) {
      alert("Body variables must be sequential, starting from {{1}}.");
      return;
    }
    if (uniqueNumbers.length && examples.length !== uniqueNumbers.length) {
      alert(`Enter ${uniqueNumbers.length} comma-separated body example value(s).`);
      return;
    }

    onSubmitToMeta({
      name: form.name.trim().toLowerCase(),
      category: form.category.toUpperCase(),
      language: LANGUAGE_TO_META[form.language] || form.language,
      header: headerFormat === "TEXT" ? form.header : "",
      headerFormat,
      headerHandle,
      body: form.body,
      footer: form.footer,
      buttons: buttonCheck.buttons,
      bodyExamples: examples,
      ...(isMeta ? { metaId: template.metaId } : {}),
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.name.trim() || !form.body.trim()) {
      alert("Please enter a template name and message body.");
      return;
    }

    setSaving(true);

    try {
      let media = null;

      if (mediaKind !== "none") {
        if (file) {
          const mediaId = `m_${Date.now()}`;
          try {
            await putBlob(mediaId, file); // refresh ke baad ke liye backup
          } catch {
            console.warn("IndexedDB save fail hua; preview sirf is session me dikhega.");
          }
          media = {
            kind: mediaKind,
            source: "file",
            mediaId,
            src: URL.createObjectURL(file), // turant preview ke liye
            name: file.name,
            size: file.size,
            mime: file.type,
          };
        } else if (urlInput.trim()) {
          media = {
            kind: mediaKind,
            source: "url",
            url: urlInput.trim(),
            name: urlInput.trim().split("?")[0].split("/").pop() || "media",
          };
        } else if (existing) {
          media = existing;
        }
      }

      onSave({
        ...template,
        ...form,
        id: template?.id || Date.now(),
        status: "Draft",
        image: "", // purana field, ab `media` use hota hai
        media,
        buttons: form.buttons.filter((button) => button.text.trim()),
        bodyExamples: form.bodyExamples
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        broadcasts: template?.broadcasts || "0",
        delivery: template?.delivery || "—",
        health: template?.health || "Not rated",
        created: template?.created || new Date().toLocaleDateString(),
        modified: new Date().toLocaleDateString(),
      });
    } catch {
      alert("Media save nahi ho paya. Dobara try karo.");
    } finally {
      setSaving(false);
    }
  }

  const rule = MEDIA_RULES[mediaKind];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="my-auto w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {template ? "Edit Template" : "Create New Template"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {isMeta
                ? "Edit this template. Saving sends it back to Meta for approval."
                : "Create a template, then submit it to Meta for approval."}
            </p> 
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close modal"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {isMeta && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
              Name, language and category can't be changed after a template is created. Approved templates can be
              edited once per 24 hours. If the template has an image, video or document header, pick the sample file again.
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Template Name *
              <input
                name="name"
                value={form.name}
                onChange={updateField}
                disabled={isMeta}
                placeholder="welcome_message"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                required
              />
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Category
              <select
                name="category"
                value={form.category}
                onChange={updateField}
                disabled={isMeta}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500"
              >
                <option>Marketing</option>
                <option>Utility</option>
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Language
              <select
                name="language"
                value={form.language}
                onChange={updateField}
                disabled={isMeta}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500"
              >
                <option>English (US)</option>
                <option>English (UK)</option>
                <option>Hindi</option>
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-700">
              Header
              <input
                name="header"
                value={form.header}
                onChange={updateField}
                placeholder="Optional header"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500"
              />
            </label>
          </div>

          {/* MEDIA UPLOAD */}
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-700">
              Header media (optional)
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                { value: "none", label: "None", icon: null },
                { value: "image", label: "Image", icon: ImageIcon },
                { value: "video", label: "Video", icon: VideoIcon },
                { value: "document", label: "Document", icon: FileText },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => changeKind(item.value)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      mediaKind === item.value
                        ? "bg-emerald-700 text-white"
                        : "bg-[#f2f4ff] text-slate-600 hover:bg-indigo-100"
                    }`}
                  >
                    {Icon && <Icon size={14} />}
                    {item.label}
                  </button>
                );
              })}
            </div>

            {mediaKind !== "none" && (
              <div className="mt-3 space-y-3">
                {/* LIVE PREVIEW */}
                {preview ? (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <MediaView
                      kind={mediaKind}
                      src={preview.src}
                      name={preview.name}
                      size={preview.size}
                      alt="Selected media preview"
                    />

                    <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-white px-3 py-2">
                      <p className="min-w-0 truncate text-[11px] text-slate-600">
                        {preview.name}
                        {preview.size ? ` • ${formatSize(preview.size)}` : ""}
                      </p>

                      <button
                        type="button"
                        onClick={removeMedia}
                        className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline"
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center transition hover:border-emerald-400 hover:bg-emerald-50/50">
                    <UploadCloud size={24} className="text-emerald-700" />
                    <span className="text-xs font-semibold text-slate-700">
                      Click karke {rule.label.toLowerCase()} select karo
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {rule.hint}
                    </span>

                    <input
                      type="file"
                      accept={rule.accept}
                      onChange={handlePick}
                      className="hidden"
                    />
                  </label>
                )}

                {/* Replace file button jab preview ho */}
                {preview && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                    <UploadCloud size={13} />
                    Change file
                    <input
                      type="file"
                      accept={rule.accept}
                      onChange={handlePick}
                      className="hidden"
                    />
                  </label>
                )}

                {/* URL option */}
                <label className="block text-[11px] font-medium text-slate-500">
                  Ya {rule.label.toLowerCase()} ka URL paste karo
                  <input
                    value={urlInput}
                    onChange={(event) => {
                      setUrlInput(event.target.value);
                      setFile(null);
                      setExisting(null);
                    }}
                    placeholder="https://example.com/file"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal outline-none focus:border-emerald-500"
                  />
                </label>
              </div>
            )}
          </div>

          <label className="block text-xs font-semibold text-slate-700">
            Message Body *
            <textarea
              name="body"
              value={form.body}
              onChange={updateField}
              rows={5}
              placeholder="Hello {{1}}, welcome to our business..."
              className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-3 text-sm font-normal leading-6 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              required
            />
            <span className="mt-1 block font-normal text-slate-400">
              Use {"{{1}}"}, {"{{2}}"} for dynamic variables.
            </span>
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Body example values (only if body uses {"{{1}}"}, {"{{2}}"}, etc.)
            <input
              name="bodyExamples"
              value={form.bodyExamples}
              onChange={updateField}
              placeholder="Rahul, ORD123"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500"
            />
            <span className="mt-1 block font-normal text-slate-400">
              Enter one sample value per variable, separated by commas.
            </span>
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Footer
            <input
              name="footer"
              value={form.footer}
              onChange={updateField}
              placeholder="Optional footer"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-500"
            />
          </label>

          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">Buttons (optional)</p>

              <div className="flex flex-wrap gap-1.5">
                {[
                  ["URL", "+ Website link", form.buttons.filter((b) => b.type === "URL").length >= 2],
                  ["PHONE_NUMBER", "+ Call button", form.buttons.filter((b) => b.type === "PHONE_NUMBER").length >= 1],
                  ["QUICK_REPLY", "+ Quick reply", false],
                ].map(([type, label, full]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addButton(type)}
                    disabled={full || form.buttons.length >= 10}
                    className="rounded-lg bg-[#f2f4ff] px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {form.buttons.length === 0 ? (
              <p className="mt-3 text-[11px] text-slate-400">No buttons. Add a website link, a call button or quick replies.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {form.buttons.map((button, index) => (
                  <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {BUTTON_TYPE_LABEL[button.type] || "Button"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeButton(index)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline"
                      >
                        <Trash2 size={12} /> Remove
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={button.text}
                        onChange={(event) => updateButton(index, { text: event.target.value })}
                        maxLength={25}
                        placeholder="Button label (max 25)"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500"
                      />

                      {button.type === "URL" && (
                        <input
                          value={button.url}
                          onChange={(event) => updateButton(index, { url: event.target.value })}
                          placeholder="https://yourstore.com/offer"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500"
                        />
                      )}

                      {button.type === "PHONE_NUMBER" && (
                        <input
                          value={button.phone}
                          onChange={(event) => updateButton(index, { phone: event.target.value })}
                          placeholder="+919876543210"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-2 text-[11px] text-slate-400">
              Up to 2 website links, 1 call button and 10 buttons in total. Links must be full https:// addresses
              without {"{{variables}}"}.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>

            {!isMeta && (
              <button
                type="submit"
                disabled={saving || submittingMeta}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>
            )}
            <button
              type="button"
              onClick={submitToMeta}
              disabled={saving || submittingMeta || uploadingSample}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadingSample ? "Uploading sample..." : submittingMeta ? "Submitting..." : isMeta ? "Save & resubmit to Meta" : "Submit to Meta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================= JSON MODAL ================= */

function JsonModal({ template, onClose }) {
  const media = getMedia(template);

  const headerComponent = media
    ? {
        type: "HEADER",
        format: media.kind.toUpperCase(),
        example: {
          header_handle: [media.source === "url" ? media.url : media.name],
        },
      }
    : template.header
    ? { type: "HEADER", format: "TEXT", text: template.header }
    : null;

  const json = {
    name: template.name,
    category: template.category.toLowerCase(),
    language: template.language,
    status: template.status,
    components: [
      ...(headerComponent ? [headerComponent] : []),
      {
        type: "BODY",
        text: template.body,
      },
      ...(template.footer
        ? [{ type: "FOOTER", text: template.footer }]
        : []),
      ...(template.buttons?.length
        ? [
            {
              type: "BUTTONS",
              buttons: template.buttons.map((item) => {
                const button = normalizeButton(item);
                if (button.type === "URL") return { type: "URL", text: button.text, url: button.url };
                if (button.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: button.text, phone_number: button.phone };
                return { type: "QUICK_REPLY", text: button.text };
              }),
            },
          ]
        : []),
    ],
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Template JSON Preview
            </h2>
            <p className="mt-1 text-xs text-slate-500">{template.name}</p>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-slate-100"
            aria-label="Close JSON preview"
          >
            <X size={19} />
          </button>
        </div>

        <pre className="max-h-[65vh] overflow-auto bg-slate-950 p-5 text-xs leading-6 text-emerald-300">
          {JSON.stringify(json, null, 2)}
        </pre>

        <div className="flex justify-end p-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= PAGE ================= */

export default function Templates() {
  const [templates, setTemplates] = useState(() => {
    try {
      const saved = localStorage.getItem("reachpulse_templates");
      return saved ? JSON.parse(saved) : initialTemplates;
    } catch {
      return initialTemplates;
    }
  });

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [editor, setEditor] = useState(null);
  const [jsonTemplate, setJsonTemplate] = useState(null);
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [submittingMeta, setSubmittingMeta] = useState(false);
  const [showStarter, setShowStarter] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        "reachpulse_templates",
        JSON.stringify(templates, (key, value) =>
          key === "src" ? undefined : value
        )
      );
    } catch {
      // App crash na ho, lekin user ko batao ki refresh par data nahi bachega
      notify("Browser storage full ya blocked hai, isliye refresh ke baad templates na dikhein.");
    }
  }, [templates]);

  function notify(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  const filteredTemplates = useMemo(() => {
    let result = templates.filter((template) => {
      const matchesSearch = [
        template.name,
        template.category,
        template.language,
        template.body,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesCategory =
        category === "All" || template.category === category;

      const matchesStatus =
        status === "All" || template.status === status;

      return matchesSearch && matchesCategory && matchesStatus;
    });

    result = [...result].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);

      if (sort === "delivery") {
        return parseFloat(b.delivery) - parseFloat(a.delivery);
      }

      const aDate = new Date(a.modified).getTime() || 0;
      const bDate = new Date(b.modified).getTime() || 0;

      return sort === "oldest" ? aDate - bDate : bDate - aDate;
    });

    return result;
  }, [templates, search, category, status, sort]);

  const approvedCount = templates.filter(
    (template) => template.status === "Approved"
  ).length;

  function saveTemplate(template) {
    setTemplates((previous) => {
      const exists = previous.some((item) => item.id === template.id);

      return exists
        ? previous.map((item) =>
            item.id === template.id ? template : item
          )
        : [template, ...previous];
    });

    setEditor(null);
    notify("Template draft saved successfully.");
  }

  function duplicateTemplate(template) {
    const copy = {
      ...template,
      id: Date.now(),
      name: `${template.name}_copy`,
      status: "Draft",
      // a copy is a new local draft, never an edit of the Meta template
      source: "local",
      metaId: undefined,
      metaStatus: undefined,
      rejectedReason: "",
      broadcasts: "0",
      delivery: "—",
      health: "Not rated",
      created: new Date().toLocaleDateString(),
      modified: new Date().toLocaleDateString(),
    };

    setTemplates((previous) => [copy, ...previous]);
    notify("Template duplicated as a draft.");
  }

  async function deleteTemplate(template) {
    if (template.source === "meta" && template.metaId) {
      if (!window.confirm(`Delete "${template.name}" (${template.language}) from Meta? This cannot be undone.`)) return;

      try {
        const response = await fetch(
          `${API_BASE}/api/templates/${encodeURIComponent(template.name)}?hsm_id=${encodeURIComponent(template.metaId)}`,
          { method: "DELETE" }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.details?.error?.error_user_msg || data.message || "Could not delete the template from Meta.");
        }
        setTemplates((previous) => previous.filter((item) => item.id !== template.id));
        notify("Template deleted from Meta.");
      } catch (error) {
        notify(error.message || "Delete failed.");
      }
      return;
    }

    if (template.status !== "Draft") {
      notify("Only drafts and Meta templates can be deleted.");
      return;
    }

    if (!window.confirm(`Delete draft "${template.name}"?`)) return;

    setTemplates((previous) =>
      previous.filter((item) => item.id !== template.id)
    );

    notify("Draft deleted.");
  }


function sendCampaign(template) {
  if (template.status !== "Approved" || template.source !== "meta") {
    notify("Only Meta-synced approved templates can be used for campaigns.");
    return;
  }

  // Convert UI language labels into Meta language codes
  const languageMap = {
    "English (US)": "en_US",
    "English (UK)": "en_GB",
    "Hindi": "hi"
  };

  const selectedTemplate = {
    ...template,
    language:
      languageMap[template.language] || template.language
  };

  sessionStorage.setItem(
    "reachpulse_selected_template",
    JSON.stringify(selectedTemplate)
  );

  window.location.href = "/contacts";
}


  async function syncMeta(options = {}) {
    const silent = options?.silent === true;
    setSyncing(true);
    try {
      const response = await fetch(`${API_BASE}/api/templates`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not sync templates from Meta.");
      }

      const metaTemplates = (data.templates || []).map(mapMetaTemplate);
      const metaKeys = new Set(
        metaTemplates.map((item) => `${item.name}|${item.languageCode}`)
      );
      const demoIds = new Set(initialTemplates.map((item) => item.id));
      const RECENT_MS = 15 * 60 * 1000;

      setTemplates((previous) => {
        const kept = previous.filter((item) => {
          if (demoIds.has(item.id)) return false; // sample demo data

          const code =
            LANGUAGE_TO_META[item.language] || item.languageCode || item.language;
          if (metaKeys.has(`${item.name}|${code}`)) return false; // Meta version wins

          if (item.source === "meta") {
            // Meta list can lag a little: keep a just-submitted template for 15 min
            return Boolean(item.submittedAt) && Date.now() - item.submittedAt < RECENT_MS;
          }

          return true; // local drafts / local templates are never deleted by sync
        });

        return [...metaTemplates, ...kept];
      });

      if (!silent) notify(`Synced ${metaTemplates.length} template(s) from Meta.`);
    } catch (error) {
      if (!silent) {
        notify(error.message || "Meta sync failed. Check backend and credentials.");
      }
    } finally {
      setSyncing(false);
    }
  }

  // Page open / refresh par Meta ke templates automatically wapas aa jaate hain
  useEffect(() => {
    syncMeta({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitTemplateToMeta(payload) {
    setSubmittingMeta(true);
    try {
      // EDIT: the template already exists on Meta -> update it and send it for review again
      if (payload.metaId) {
        const { metaId, ...editBody } = payload;
        const editResponse = await fetch(`${API_BASE}/api/templates/${encodeURIComponent(metaId)}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editBody),
        });
        const editData = await editResponse.json().catch(() => ({}));

        if (!editResponse.ok || !editData.success) {
          const detail =
            editData.details?.error?.error_user_msg ||
            editData.details?.error?.message ||
            editData.message;
          throw new Error(detail || "Meta template update failed.");
        }

        const editedAt = new Date().toLocaleDateString();
        setTemplates((previous) =>
          previous.map((item) =>
            item.metaId === metaId
              ? {
                  ...item,
                  status: "Pending",
                  metaStatus: "PENDING",
                  header: editBody.header || "",
                  headerFormat: editBody.headerFormat || "TEXT",
                  body: editBody.body,
                  bodyExamples: editBody.bodyExamples || [],
                  footer: editBody.footer || "",
                  buttons: editBody.buttons || [],
                  rejectedReason: "",
                  modified: editedAt,
                  submittedAt: Date.now(),
                }
              : item
          )
        );

        notify("Template updated and sent to Meta for review. Status: Pending.");
        setEditor(null);
        return;
      }

      const response = await fetch(`${API_BASE}/api/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        const details = data.details?.error?.error_user_msg ||
          data.details?.error?.message || data.details?.message;
        throw new Error(details || data.message || "Meta template submission failed.");
      }

      // Turant list me dikhao (Meta ki list me aane me thoda time lag sakta hai)
      const categoryLabel =
        String(payload.category || "Marketing").charAt(0).toUpperCase() +
        String(payload.category || "Marketing").slice(1).toLowerCase();
      const now = new Date().toLocaleDateString();

      const submitted = {
        id: `meta-pending-${Date.now()}`,
        metaId: data.template?.id,
        name: payload.name,
        category: categoryLabel,
        language: LANGUAGE_FROM_META[payload.language] || payload.language,
        languageCode: payload.language,
        status: "Pending",
        metaStatus: "PENDING",
        header: payload.header || "",
        headerFormat: payload.headerFormat || "TEXT",
        body: payload.body,
        footer: payload.footer || "",
        buttons: payload.buttons || [],
        bodyExamples: payload.bodyExamples || [],
        media: null,
        image: "",
        broadcasts: "—",
        delivery: "—",
        health: "Not rated",
        created: now,
        modified: now,
        rejectedReason: "",
        source: "meta",
        submittedAt: Date.now(),
      };

      setTemplates((previous) => [
        submitted,
        ...previous.filter(
          (item) =>
            !(
              item.name === submitted.name &&
              (LANGUAGE_TO_META[item.language] || item.languageCode || item.language) ===
                submitted.languageCode
            )
        ),
      ]);

      notify(`Template submitted to Meta. Status: ${data.template?.status || "PENDING"}.`);
      setEditor(null);
      await syncMeta({ silent: true });
    } catch (error) {
      notify(error.message || "Could not submit template to Meta.");
    } finally {
      setSubmittingMeta(false);
    }
  }

  function resetFilters() {
    setSearch("");
    setCategory("All");
    setStatus("All");
    setSort("newest");
  }

  return (
    <div className="min-h-screen min-w-0 bg-[#f8f9ff] p-4 sm:p-5 lg:p-6">
      {/* NOTIFICATION */}
      {notice && (
        <div
          role="status"
          className="fixed right-5 top-20 z-[120] max-w-sm rounded-xl border border-emerald-100 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-xl"
        >
          {notice}
        </div>
      )}

      {/* HEADER */}
      <section className="mb-5 flex flex-col justify-between gap-4 2xl:flex-row 2xl:items-start">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="bg-green-100 text-green-800">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-600" />
              WhatsApp Business Platform
            </Badge>

            <span className="text-[11px] text-slate-500">
              Operations Console
            </span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Your Templates
          </h1>

          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 sm:text-sm">
            Manage approved Meta WhatsApp templates, monitor
            delivery performance, and initiate targeted broadcast
            campaigns with confidence.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge className="gap-1 bg-white text-emerald-700 ring-1 ring-slate-200">
              <CheckCircle2 size={12} />
              {approvedCount} Approved Templates
            </Badge>

            <Badge className="gap-1 bg-white text-slate-600 ring-1 ring-slate-200">
              <CheckCheck size={12} />
              Demo performance metrics
            </Badge>
          </div>
        </div>

        {/* HEADER ACTIONS */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => syncMeta()}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing..." : "Sync Meta Status"}
          </button>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold ${
              showFilters
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <SlidersHorizontal size={15} />
            Filter View
          </button>

          <button
            onClick={() => setShowStarter(true)}
            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <Send size={15} />
            Starter Templates
          </button>

          <button
            onClick={() => setEditor({ mode: "create" })}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800"
          >
            <Plus size={16} />
            Create New Template
          </button>
        </div>
      </section>

      {/* FILTER TOOLBAR */}
      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 lg:w-56">
              <Search size={15} className="shrink-0 text-slate-400" />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by name"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
              />

              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X size={14} className="text-slate-400" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {["All", "Marketing", "Utility", "Authentication"].map(
                (item) => (
                  <button
                    key={item}
                    onClick={() => setCategory(item)}
                    className={`rounded-lg px-2.5 py-2 text-[10px] font-semibold transition sm:text-xs ${
                      category === item
                        ? "bg-emerald-700 text-white"
                        : "bg-[#f2f4ff] text-slate-600 hover:bg-indigo-100"
                    }`}
                  >
                    {item === "All" ? "All Templates" : item}
                  </button>
                )
              )}
            </div>
          </div>

          <label className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
            <CalendarDays size={14} />

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="max-w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none focus:border-emerald-500"
            >
              <option value="newest">Last Modified (Newest First)</option>
              <option value="oldest">Last Modified (Oldest First)</option>
              <option value="name">Template Name (A-Z)</option>
              <option value="delivery">Highest Delivery Rate</option>
            </select>
          </label>
        </div>

        {showFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs font-semibold text-slate-600">
              Approval Status:
            </span>

            {["All", "Approved", "Pending", "Rejected", "Paused", "Draft"].map(
              (item) => (
                <button
                  key={item}
                  onClick={() => setStatus(item)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${
                    status === item
                      ? "bg-emerald-700 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {item}
                </button>
              )
            )}

            <button
              onClick={resetFilters}
              className="ml-auto text-xs font-semibold text-emerald-700 hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </section>

      {/* TEMPLATE COUNT */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Showing{" "}
          <span className="font-bold text-slate-800">
            {filteredTemplates.length}
          </span>{" "}
          templates
        </p>

        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <FileText size={13} />
          Template Library
        </div>
      </div>

      {/* TEMPLATE GRID */}
      {filteredTemplates.length > 0 ? (
        <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onEdit={(item) => setEditor(item)}
              onDuplicate={duplicateTemplate}
              onPreview={setJsonTemplate}
              onDelete={deleteTemplate}
              onCampaign={sendCampaign}
            />
          ))}
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <Search size={22} />
          </div>

          <h3 className="mt-4 text-base font-bold text-slate-800">
            No templates found
          </h3>

          <p className="mt-2 text-sm text-slate-500">
            Try another search term or clear your filters.
          </p>

          <button
            onClick={resetFilters}
            className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* MODALS */}
      {editor && (
        <TemplateModal
          template={editor.mode === "create" ? null : editor}
          onClose={() => setEditor(null)}
          onSave={saveTemplate}
          onSubmitToMeta={submitTemplateToMeta}
          submittingMeta={submittingMeta}
        />
      )}

      {showStarter && (
        <StarterPackModal
          existingKeys={
            new Set(
              templates
                .filter((item) => item.source === "meta")
                .map((item) => `${item.name}|${item.languageCode}`)
            )
          }
          onClose={() => setShowStarter(false)}
          onDone={() => syncMeta({ silent: true })}
        />
      )}

      {jsonTemplate && (
        <JsonModal
          template={jsonTemplate}
          onClose={() => setJsonTemplate(null)}
        />
      )}
    </div>
  );
}