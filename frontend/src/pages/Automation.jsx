import { useEffect, useRef, useState } from 'react';
import {
  Bot, Search, Plus, Pencil, Trash2, Send, RotateCcw, Users, X,
} from 'lucide-react';
import {
  getBotConfig, saveBotConfig, getKnowledge, createKnowledge, updateKnowledge,
  deleteKnowledge, testBot,
} from '../lib/automationApi';

const TONES = ['Friendly', 'Professional', 'Concise', 'Hinglish'];

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const primaryBtn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60';
const ghostBtn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50';

export default function Automation() {
  const [cfg, setCfg] = useState({ enabled: false, strictMode: true, instructions: '', tone: 'Friendly', fallbackMessage: '' });
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { id?, title, content }

  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const chatBox = useRef(null);

  useEffect(() => {
    Promise.all([getBotConfig(), getKnowledge()])
      .then(([config, knowledge]) => {
        setCfg((prev) => ({ ...prev, ...config }));
        setItems(knowledge);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, thinking]);

  async function toggleBot() {
    const enabled = !cfg.enabled;
    setCfg((c) => ({ ...c, enabled }));
    try {
      await saveBotConfig({ enabled });
      setError('');
    } catch (e) {
      setCfg((c) => ({ ...c, enabled: !enabled }));
      setError(e.message);
    }
  }

  async function saveSettings() {
    setSaveState('saving');
    try {
      const { instructions, tone, fallbackMessage, strictMode } = cfg;
      await saveBotConfig({ instructions, tone, fallbackMessage, strictMode });
      setSaveState('saved');
      setError('');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setError(e.message);
      setSaveState('idle');
    }
  }

  async function submitEntry(event) {
    event.preventDefault();
    const { id, title, content } = modal;
    if (!content.trim()) return;
    try {
      if (id) {
        const updated = await updateKnowledge(id, { title, content });
        setItems((list) => list.map((i) => (i._id === id ? updated : i)));
      } else {
        const created = await createKnowledge({ title, content });
        setItems((list) => [created, ...list]);
      }
      setModal(null);
      setError('');
    } catch (e) { setError(e.message); }
  }

  async function removeEntry(id) {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await deleteKnowledge(id);
      setItems((list) => list.filter((i) => i._id !== id));
    } catch (e) { setError(e.message); }
  }

  async function sendTest(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || thinking) return;
    const next = [...msgs, { role: 'user', text }];
    setMsgs(next);
    setDraft('');
    setThinking(true);
    try {
      const history = next.map((m) => ({ role: m.role, content: m.text }));
      const reply = await testBot(history);
      setMsgs([...next, { role: 'assistant', text: reply.text, handoff: reply.handoff }]);
    } catch (e) {
      setMsgs([...next, { role: 'assistant', text: `Error: ${e.message}`, isError: true }]);
    } finally { setThinking(false); }
  }

  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => !q || `${i.title || ''} ${i.content}`.toLowerCase().includes(q));

  return (
    <section className="mx-auto flex max-w-[1180px] flex-col gap-6 p-3 sm:p-6">
      {/* HEADER */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-[320px]">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Automation</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">AI auto-reply</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Teach the bot about your business, test it here, then switch it on. It answers new WhatsApp
            messages and hands the chat to your team when it is not sure.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white py-2 pl-5 pr-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Bot status</p>
            <p className={`mt-0.5 text-xs font-medium ${cfg.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>
              {cfg.enabled ? 'Replying to new chats' : 'Paused. Chats go to your team'}
            </p>
          </div>
          <button
            type="button" role="switch" aria-checked={cfg.enabled} aria-label="Turn bot on or off"
            onClick={toggleBot} disabled={!loaded}
            className="relative h-11 w-14 shrink-0 disabled:opacity-50"
          >
            <span className={`absolute left-1 top-2 h-7 w-12 rounded-full transition ${cfg.enabled ? 'bg-emerald-600' : 'bg-slate-400'}`} />
            <span className={`absolute top-[11px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${cfg.enabled ? 'left-[27px]' : 'left-[7px]'}`} />
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="shrink-0 p-1"><X size={16} /></button>
        </div>
      )}

      {/* HOW IT WORKS */}
      <div className="flex flex-wrap rounded-2xl border border-slate-200 bg-white p-2">
        {['A customer messages you on WhatsApp', 'The bot replies using your knowledge base', 'If unsure, it hands the chat to your team'].map((t, i) => (
          <div key={t} className="flex basis-[240px] flex-1 items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-800">{i + 1}</span>
            {t}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 basis-[520px] flex-[3] flex-col gap-6">
          {/* SETTINGS */}
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">How should the bot reply?</h2>
              <p className="mt-1 text-sm text-slate-500">These instructions shape the voice and the rules for every answer.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="bot-instr" className="text-sm font-semibold text-slate-800">Instructions</label>
              <textarea id="bot-instr" rows={5} value={cfg.instructions} className={`${inputCls} min-h-32 resize-y leading-6`}
                onChange={(e) => setCfg({ ...cfg, instructions: e.target.value })} />
            </div>

            <div className="flex flex-col gap-2">
              <span id="bot-tone" className="text-sm font-semibold text-slate-800">Tone</span>
              <div role="group" aria-labelledby="bot-tone" className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button key={t} type="button" aria-pressed={cfg.tone === t} onClick={() => setCfg({ ...cfg, tone: t })}
                    className={`min-h-11 rounded-full border px-5 text-sm font-semibold transition ${
                      cfg.tone === t
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <label htmlFor="bot-strict" className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <input id="bot-strict" type="checkbox" checked={cfg.strictMode !== false}
                onChange={(e) => setCfg({ ...cfg, strictMode: e.target.checked })}
                className="mt-1 h-4 w-4 shrink-0 accent-emerald-700" />
              <span>
                <span className="block text-sm font-semibold text-slate-800">Strict mode: reply only from my training</span>
                <span className="mt-0.5 block text-sm text-slate-600">
                  Before every reply is sent, it is checked against your instructions and knowledge base.
                  Anything not covered there is not sent; the chat goes to your team instead.
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <label htmlFor="bot-fallback" className="text-sm font-semibold text-slate-800">Message when handing over to your team</label>
              <input id="bot-fallback" type="text" value={cfg.fallbackMessage} className={inputCls}
                onChange={(e) => setCfg({ ...cfg, fallbackMessage: e.target.value })} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">Changes apply to new messages only.</span>
              <button type="button" className={primaryBtn} onClick={saveSettings} disabled={saveState === 'saving' || !loaded}>
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save changes'}
              </button>
            </div>
          </div>

          {/* KNOWLEDGE BASE */}
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Knowledge base</h2>
                <p className="mt-1 text-sm text-slate-500">
                  The bot only answers from what you add here. {items.length} {items.length === 1 ? 'entry' : 'entries'}
                </p>
              </div>
              <button type="button" className={primaryBtn} onClick={() => setModal({ title: '', content: '' })}>
                <Plus size={16} /> Add entry
              </button>
            </div>

            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" aria-label="Search knowledge base" placeholder="Search entries" value={query}
                onChange={(e) => setQuery(e.target.value)} className={`${inputCls} pl-10`} />
            </div>

            <ul>
              {shown.map((i) => (
                <li key={i._id} className="flex items-center gap-3 border-t border-slate-100 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-slate-900">{i.title || 'Untitled'}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{i.content}</p>
                  </div>
                  <button type="button" aria-label={`Edit ${i.title || 'entry'}`}
                    onClick={() => setModal({ id: i._id, title: i.title || '', content: i.content })}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                    <Pencil size={16} />
                  </button>
                  <button type="button" aria-label={`Delete ${i.title || 'entry'}`} onClick={() => removeEntry(i._id)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-red-700 hover:bg-red-50">
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {loaded && shown.length === 0 && (
              <p className="border-t border-slate-100 pb-2 pt-8 text-center text-sm text-slate-500">
                {items.length === 0
                  ? 'No entries yet. Add your FAQs, prices and policies so the bot has something to answer from.'
                  : 'No entries match your search.'}
              </p>
            )}
          </div>
        </div>

        {/* TEST PLAYGROUND */}
        <aside aria-label="Test the bot" className="flex min-w-0 basis-[380px] flex-[2] flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Test the bot</h2>
              <p className="mt-1 text-sm text-slate-500">Try a customer message. Nothing here is sent to real customers.</p>
            </div>
            <button type="button" className={`${ghostBtn} shrink-0`} onClick={() => { setMsgs([]); setDraft(''); }}>
              <RotateCcw size={15} /> Reset
            </button>
          </div>

          <div ref={chatBox} className="flex max-h-[560px] min-h-[420px] flex-col gap-2.5 overflow-y-auto rounded-xl bg-[#efeae2] p-4">
            {msgs.length === 0 && (
              <p className="m-auto text-center text-sm text-slate-500">Type a message below to see how the bot answers.</p>
            )}
            {msgs.map((m, idx) => (
              <div key={idx} className={`flex max-w-[82%] flex-col gap-1.5 ${m.role === 'user' ? 'self-start' : 'items-end self-end'}`}>
                <div className={`whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm leading-5 shadow-sm ${
                  m.role === 'user'
                    ? 'rounded-xl rounded-tl-sm bg-white'
                    : `rounded-xl rounded-tr-sm ${m.isError ? 'bg-red-100 text-red-800' : 'bg-[#d9fdd3]'}`}`}>
                  {m.text}
                </div>
                {m.handoff && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                    <Users size={13} /> Handed over to your team
                  </span>
                )}
              </div>
            ))}
            {thinking && <div className="self-end rounded-xl bg-[#d9fdd3] px-3.5 py-2.5 text-sm text-slate-500 shadow-sm">Typing…</div>}
          </div>

          <form onSubmit={sendTest} className="flex gap-2">
            <input type="text" aria-label="Type a customer message" placeholder="Type a customer message"
              value={draft} onChange={(e) => setDraft(e.target.value)} className={`${inputCls} min-h-11 min-w-0 flex-1`} />
            <button type="submit" aria-label="Send test message" disabled={thinking || !draft.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60">
              <Send size={16} />
            </button>
          </form>
          <p className="text-xs leading-5 text-slate-500">
            WhatsApp only allows free-form replies within 24 hours of the customer's last message.
          </p>
        </aside>
      </div>

      {/* ADD / EDIT ENTRY */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <form onSubmit={submitEntry} role="dialog" aria-modal="true" aria-label="Knowledge entry"
            className="flex w-full max-w-lg flex-col gap-4 rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Bot size={18} /> {modal.id ? 'Edit entry' : 'Add entry'}</h2>
            <div className="flex flex-col gap-2">
              <label htmlFor="kb-title" className="text-sm font-semibold text-slate-800">Title</label>
              <input id="kb-title" type="text" placeholder="e.g. Delivery & shipping" value={modal.title} maxLength={200}
                onChange={(e) => setModal({ ...modal, title: e.target.value })} className={inputCls} />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="kb-content" className="text-sm font-semibold text-slate-800">Answer / information</label>
              <textarea id="kb-content" rows={6} required maxLength={4000} value={modal.content}
                onChange={(e) => setModal({ ...modal, content: e.target.value })} className={`${inputCls} resize-y leading-6`} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={ghostBtn} onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className={primaryBtn}>Save entry</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}