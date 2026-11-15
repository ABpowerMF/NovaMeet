// Turns a transcript into NovaMeet's structured meeting report with a local
// language model — built-in (llama.cpp via node-llama-cpp) or Ollama.
'use strict';

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    topics: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, start: { type: 'string' }, summary: { type: 'string' } }, required: ['name', 'start', 'summary'] } },
    decisions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, decidedBy: { type: 'string' }, detail: { type: 'string' }, time: { type: 'string' } }, required: ['text', 'decidedBy', 'detail', 'time'] } },
    actions: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' }, blocksOtherWork: { type: 'boolean' }, time: { type: 'string' } }, required: ['task', 'owner', 'due', 'blocksOtherWork', 'time'] } },
    risks: { type: 'array', items: { type: 'object', properties: { severity: { enum: ['critical', 'risk'] }, title: { type: 'string' }, detail: { type: 'string' }, time: { type: 'string' } }, required: ['severity', 'title', 'detail', 'time'] } },
    contradictions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, firstTime: { type: 'string' }, secondTime: { type: 'string' } }, required: ['title', 'detail', 'firstTime', 'secondTime'] } },
    openQuestions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, detail: { type: 'string' }, time: { type: 'string' } }, required: ['text', 'detail', 'time'] } },
    figures: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' }, time: { type: 'string' } }, required: ['value', 'label', 'time'] } },
    smallTalk: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'summary', 'topics', 'decisions', 'actions', 'risks', 'contradictions', 'openQuestions', 'figures', 'smallTalk']
};

const SYSTEM = `You are NovaMeet, a meeting analyst. You read a meeting transcript and return ONLY what matters, as JSON.
Rules:
- Use only facts stated in the transcript. Never invent names, dates, numbers or decisions.
- Every "time" must be a timestamp copied exactly from the transcript line where the item was said (format mm:ss or h:mm:ss).
- decisions: only things that were actually agreed or approved, not proposals.
- actions: concrete tasks someone committed to. "due" is the deadline exactly as said (e.g. "Friday", "Nov 16"), or "" if none was given. Set blocksOtherWork when other work depends on it.
- risks: "critical" only for problems that block a decision, deadline or other work; otherwise "risk".
- contradictions: the same fact stated differently at two moments (numbers, dates, owners).
- openQuestions: questions or topics left unresolved or postponed.
- figures: important numbers (money, dates, counts, percentages) with a short label.
- smallTalk: timestamps of lines that are greetings, jokes or off-topic chatter.
- summary: an executive summary of 3–5 sentences in the meeting's language.
- topics: the main agenda sections in order, each with its start time and a 1–3 sentence summary.
- title: a short meeting title (max 6 words).
- Write in the same language as the transcript. Use the speakers' names as written.`;

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function parseTime(t) {
  if (typeof t !== 'string') return null;
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
}

function transcriptText(lines, names) {
  return lines.map((l) => `[${fmtTime(l.start)}] ${names[l.speaker] || l.speaker}: ${l.text}`).join('\n');
}

/** Find the transcript line a timestamp refers to. */
function lineAt(lines, t) {
  const sec = parseTime(t);
  if (sec === null || !lines.length) return null;
  let best = lines[0], bestD = Infinity;
  for (const l of lines) {
    const d = sec >= l.start && sec <= l.end ? 0 : Math.min(Math.abs(l.start - sec), Math.abs(l.end - sec));
    if (d < bestD) { best = l; bestD = d; }
  }
  return best;
}

function similar(a, b) {
  const w = (s) => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x.length > 2));
  const A = w(a), B = w(b);
  if (!A.size || !B.size) return false;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size) > 0.7;
}
function dedupe(list, key) {
  const out = [];
  for (const x of list) if (!out.some((y) => similar(y[key], x[key]))) out.push(x);
  return out;
}

/** Chunk long transcripts so they fit the model's context window. */
function chunkLines(lines, names, maxChars) {
  const chunks = [];
  let cur = [], size = 0;
  for (const l of lines) {
    const len = (names[l.speaker] || l.speaker).length + l.text.length + 14;
    if (size + len > maxChars && cur.length) { chunks.push(cur); cur = cur.slice(-4); size = cur.reduce((n, x) => n + x.text.length + 20, 0); }
    cur.push(l); size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function emptyRaw() {
  return { title: '', summary: '', topics: [], decisions: [], actions: [], risks: [], contradictions: [], openQuestions: [], figures: [], smallTalk: [] };
}

function stripThinking(s) { return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

function safeParse(s) {
  const t = stripThinking(s);
  try { return JSON.parse(t); } catch (e) { /* try to cut to the outer braces */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('The model did not return a valid report.');
}

// ---------- backends ----------

class LlamaBackend {
  constructor(modelPath, contextSize) { this.modelPath = modelPath; this.contextSize = contextSize || 32768; }
  async load() {
    const { getLlama } = await import('node-llama-cpp');
    this.lib = await import('node-llama-cpp');
    this.llama = await getLlama({ gpu: 'auto', build: 'never', progressLogs: false });
    this.model = await this.llama.loadModel({ modelPath: this.modelPath, gpuLayers: 'auto' });
    this.context = await this.model.createContext({ contextSize: { min: 8192, max: this.contextSize } });
    this.grammar = await this.llama.createGrammarForJsonSchema(SCHEMA);
    this.maxChars = Math.floor(this.context.contextSize * 2.2); // ~0.6 of the window at ~3.6 chars/token
  }
  async run(system, user, signal) {
    const seq = this.context.getSequence();
    try {
      const session = new this.lib.LlamaChatSession({ contextSequence: seq, systemPrompt: system });
      const out = await session.prompt(user, { grammar: this.grammar, temperature: 0.2, maxTokens: 4096, signal, budgets: { thoughtTokens: 0 } });
      return this.grammar.parse(out);
    } finally { seq.dispose(); }
  }
  async dispose() {
    try { if (this.context) await this.context.dispose(); } catch (e) { /* ignore */ }
    try { if (this.model) await this.model.dispose(); } catch (e) { /* ignore */ }
  }
}

class OllamaBackend {
  constructor(url, model) { this.url = url; this.modelName = model; this.maxChars = 50000; }
  async load() { /* Ollama loads on demand */ }
  async run(system, user, signal) {
    const r = await fetch(this.url + '/api/chat', {
      method: 'POST', signal,
      body: JSON.stringify({ model: this.modelName, stream: false, format: SCHEMA, options: { temperature: 0.2, num_ctx: 32768 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    });
    if (!r.ok) throw new Error('Ollama: ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    return safeParse(j.message && j.message.content);
  }
  async dispose() { /* Ollama manages memory itself */ }
}

// ---------- main entry ----------

/**
 * @param {object} meeting { lines, speakers: {id: name}, title }
 * @param {object} backendCfg { type:'llama', modelPath, contextSize } | { type:'ollama', url, model }
 * @param {(p:{step:string,pct:number})=>void} onProgress
 */
async function generateReport(meeting, backendCfg, onProgress, signal) {
  const lines = meeting.lines || [];
  const names = meeting.speakers || {};
  if (!lines.length) return finalize(emptyRaw(), lines, names, meeting);

  const backend = backendCfg.type === 'ollama' ? new OllamaBackend(backendCfg.url, backendCfg.model) : new LlamaBackend(backendCfg.modelPath, backendCfg.contextSize);
  onProgress({ step: 'loading', pct: 5 });
  await backend.load();
  try {
    const chunks = chunkLines(lines, names, backend.maxChars);
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress({ step: 'analyzing', pct: 10 + Math.round((i / chunks.length) * (chunks.length > 1 ? 70 : 85)) });
      const note = chunks.length > 1 ? `\n\n(This is part ${i + 1} of ${chunks.length} of the meeting.)` : '';
      const user = `Meeting: ${meeting.title || 'Untitled'}\nParticipants: ${Object.values(names).join(', ')}\n\nTranscript:\n${transcriptText(chunks[i], names)}${note}`;
      parts.push(Object.assign(emptyRaw(), await backend.run(SYSTEM, user, signal)));
    }
    let raw = parts[0];
    if (parts.length > 1) {
      raw = emptyRaw();
      for (const p of parts) for (const k of Object.keys(raw)) if (Array.isArray(raw[k])) raw[k] = raw[k].concat(p[k] || []);
      raw.decisions = dedupe(raw.decisions, 'text');
      raw.actions = dedupe(raw.actions, 'task');
      raw.risks = dedupe(raw.risks, 'title');
      raw.openQuestions = dedupe(raw.openQuestions, 'text');
      raw.figures = dedupe(raw.figures, 'label');
      raw.contradictions = dedupe(raw.contradictions, 'title');
      raw.topics = raw.topics.filter((t, i, a) => a.findIndex((x) => x.name.toLowerCase() === t.name.toLowerCase()) === i);
      onProgress({ step: 'summarizing', pct: 85 });
      const digest = parts.map((p, i) => `Part ${i + 1}: ${p.summary}`).join('\n') +
        '\n\nDecisions:\n' + raw.decisions.map((d) => '- ' + d.text).join('\n') +
        '\n\nOpen questions:\n' + raw.openQuestions.map((q) => '- ' + q.text).join('\n');
      const fin = await backend.run(SYSTEM + '\nYou are now given summaries of every part of one long meeting. Return the overall title and summary; leave the other lists empty.', digest, signal);
      raw.title = fin.title || parts[0].title;
      raw.summary = fin.summary || parts.map((p) => p.summary).join(' ');
    }
    onProgress({ step: 'done', pct: 100 });
    return finalize(raw, lines, names, meeting);
  } finally {
    await backend.dispose();
  }
}

/** Link every finding to its transcript line and add rule-based checks. */
function finalize(raw, lines, names, meeting) {
  const link = (t) => { const l = lineAt(lines, t); return l ? l.id : null; };
  const nameOf = (s) => String(s || '').trim();
  const decisions = (raw.decisions || []).map((d, i) => ({ id: 'd' + (i + 1), title: d.text, by: nameOf(d.decidedBy), detail: d.detail || '', line: link(d.time) }));
  const actions = (raw.actions || []).map((a, i) => ({ id: 'a' + (i + 1), title: a.task, owner: nameOf(a.owner), due: (a.due || '').trim(), blocking: !!a.blocksOtherWork, done: false, line: link(a.time) }));
  const warnings = [];
  for (const r of raw.risks || []) warnings.push({ sev: r.severity === 'critical' ? 'crit' : 'risk', title: r.title, detail: r.detail, line: link(r.time) });
  for (const c of raw.contradictions || []) warnings.push({ sev: 'conflict', title: c.title, detail: c.detail, line: link(c.secondTime || c.firstTime), otherLine: link(c.firstTime) });
  // Rule: a task other work depends on, with no deadline, is critical.
  for (const a of actions) {
    if (a.blocking && !a.due && !warnings.some((w) => w.sev === 'crit' && similar(w.title + ' ' + w.detail, a.title))) {
      warnings.unshift({ sev: 'crit', title: 'Blocking task has no deadline', detail: `“${a.title}” (${a.owner || 'no owner'}) blocks other work, but no completion date was agreed.`, line: a.line });
    }
    if (!a.owner) warnings.push({ sev: 'risk', title: 'Action item without an owner', detail: `Nobody took “${a.title}”.`, line: a.line });
  }
  const unclear = lines.filter((l) => l.unclear);
  if (unclear.length) warnings.push({ sev: 'review', title: unclear.length === 1 ? 'Speaker unclear — needs review' : `${unclear.length} segments need review`, detail: 'Overlapping voices or unclear audio could not be attributed with confidence.', line: unclear[0].id });
  warnings.forEach((w, i) => { w.id = 'w' + (i + 1); });

  const smallTalk = new Set();
  for (const t of raw.smallTalk || []) { const sec = parseTime(t); const l = lineAt(lines, t); if (l && sec !== null && sec >= l.start - 2 && sec <= l.end + 1) smallTalk.add(l.id); }

  const topics = (raw.topics || []).map((t) => ({ name: t.name, start: Math.max(0, parseTime(t.start) || 0), summary: t.summary, line: link(t.start) })).sort((a, b) => a.start - b.start);
  const total = lines.length ? lines[lines.length - 1].end : 0;
  topics.forEach((t, i) => { t.end = i + 1 < topics.length ? topics[i + 1].start : total; });

  return {
    title: raw.title || meeting.title || 'Meeting',
    summary: raw.summary || '',
    topics,
    decisions,
    actions,
    warnings,
    unresolved: (raw.openQuestions || []).map((q, i) => ({ id: 'u' + (i + 1), title: q.text, detail: q.detail || '', line: link(q.time) })),
    figures: (raw.figures || []).slice(0, 8).map((f) => ({ v: f.value, l: f.label, line: link(f.time) })),
    smallTalk: Array.from(smallTalk),
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateReport, finalize, SCHEMA, fmtTime, parseTime, lineAt, chunkLines, safeParse };
