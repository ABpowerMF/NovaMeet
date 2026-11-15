// Meetings and settings live as plain JSON next to their audio in the
// app's data folder — nothing leaves the computer.
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  userName: '',
  theme: 'light',
  notchPos: 'center',
  notchDisplay: null,
  showNotch: 'meeting',
  hoverExpand: false,
  launchLogin: false,
  detect: true,
  consentRemind: true,
  speechModel: 'parakeet-v3',
  report: { type: 'llama', modelId: 'qwen3-4b', ollamaModel: '' },
  language: '',
  expectedSpeakers: 0,
  diar: true,
  micId: 'default',
  sysAudio: 'all',
  inputGain: 100,
  noise: true,
  retention: 'forever',
  delAudio: false,
  defFormat: 'pdf',
  defContent: 'both',
  autoSave: false,
  savePath: '',
  onboarded: false
};

class Store {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'meetings');
    this.settingsFile = path.join(dataDir, 'settings.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.settings = Object.assign({}, DEFAULT_SETTINGS, readJson(this.settingsFile) || {});
    this.settings.report = Object.assign({}, DEFAULT_SETTINGS.report, this.settings.report || {});
  }

  saveSettings(patch) {
    this.settings = Object.assign({}, this.settings, patch);
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
    return this.settings;
  }

  newId() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${crypto.randomBytes(3).toString('hex')}`;
  }
  folder(id) { return path.join(this.dir, id); }
  file(id) { return path.join(this.folder(id), 'meeting.json'); }

  create(meta) {
    const id = this.newId();
    fs.mkdirSync(this.folder(id), { recursive: true });
    const m = Object.assign({ id, title: 'Untitled meeting', category: '', startedAt: new Date().toISOString(), duration: 0, status: 'recording', speakers: { me: this.settings.userName || 'You' }, lines: [], report: null, source: '' }, meta);
    this.write(m);
    return m;
  }

  get(id) { return readJson(this.file(id)); }
  write(m) { fs.writeFileSync(this.file(m.id), JSON.stringify(m)); return m; }
  update(id, patch) { const m = Object.assign(this.get(id) || { id }, patch); return this.write(m); }

  list() {
    const out = [];
    for (const id of safeReaddir(this.dir)) {
      const m = readJson(this.file(id));
      if (!m) continue;
      out.push(summary(m));
    }
    return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  async remove(id) { await fsp.rm(this.folder(id), { recursive: true, force: true }); }
  async removeAll() { for (const id of safeReaddir(this.dir)) await this.remove(id); }

  /** Delete meetings older than the retention setting. */
  async applyRetention() {
    const days = { '7': 7, '30': 30, '90': 90, '365': 365 }[this.settings.retention];
    if (!days) return 0;
    const cutoff = Date.now() - days * 86400000;
    let n = 0;
    for (const m of this.list()) if (new Date(m.startedAt).getTime() < cutoff && m.status !== 'recording') { await this.remove(m.id); n++; }
    return n;
  }

  /** Search titles, people, transcript lines and report findings. */
  search(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const hit = (t) => { const x = String(t || '').toLowerCase(); return terms.every((w) => x.includes(w) || (w.endsWith('s') && x.includes(w.slice(0, -1)))); };
    const results = [];
    for (const id of safeReaddir(this.dir)) {
      const m = readJson(this.file(id));
      if (!m) continue;
      const names = m.speakers || {};
      const r = m.report || {};
      const base = { meetingId: m.id, meetingTitle: m.title, date: m.startedAt };
      if (hit(m.title + ' ' + Object.values(names).join(' '))) results.push(Object.assign({ group: 'meeting', text: m.title, sub: Object.values(names).join(', ') }, base));
      for (const d of r.decisions || []) if (hit(d.title + ' ' + d.detail + ' ' + d.by)) results.push(Object.assign({ group: 'decision', text: d.title, sub: d.by ? 'Decided by ' + d.by : '', line: d.line }, base));
      for (const a of r.actions || []) if (hit(a.title + ' ' + a.owner + ' ' + a.due)) results.push(Object.assign({ group: 'action', text: (a.owner ? a.owner + ': ' : '') + a.title, sub: a.due ? 'Due ' + a.due : 'No deadline', line: a.line, blocking: a.blocking && !a.due }, base));
      for (const w of r.warnings || []) if (hit(w.title + ' ' + w.detail)) results.push(Object.assign({ group: 'warning', text: w.title, sub: w.detail, line: w.line, sev: w.sev }, base));
      for (const u of r.unresolved || []) if (hit(u.title + ' ' + u.detail)) results.push(Object.assign({ group: 'warning', text: u.title, sub: u.detail, line: u.line, sev: 'open' }, base));
      const small = new Set(r.smallTalk || []);
      for (const l of m.lines || []) if (!small.has(l.id) && hit(l.text + ' ' + (names[l.speaker] || ''))) results.push(Object.assign({ group: 'transcript', text: '“' + l.text + '”', sub: names[l.speaker] || l.speaker, line: l.id, start: l.start }, base));
      if (results.length > 400) break;
    }
    return results;
  }
}

function summary(m) {
  const r = m.report || {};
  const warn = (r.warnings || []);
  const crit = warn.filter((w) => w.sev === 'crit').length;
  const other = warn.filter((w) => w.sev !== 'crit').length;
  const names = Object.entries(m.speakers || {}).filter(([k]) => k !== 'unknown').map(([, v]) => v);
  return {
    id: m.id, title: m.title, category: m.category || '', startedAt: m.startedAt, duration: m.duration || 0,
    status: m.status, people: Math.max(names.length, 1), participants: names.join(', '),
    critical: crit, warnings: other, error: m.error || '',
    keywords: [(r.topics || []).map((t) => t.name).join(' '), r.summary || ''].join(' '),
    decisions: (r.decisions || []).map((d) => d.title).join(' · '),
    deadlines: (r.actions || []).map((a) => a.due).filter(Boolean).join(' · '),
    openActions: (r.actions || []).filter((a) => !a.done).length,
    hasReport: !!m.report
  };
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function safeReaddir(d) { try { return fs.readdirSync(d); } catch (e) { return []; } }

module.exports = { Store, DEFAULT_SETTINGS };
