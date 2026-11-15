// One-click model installs: download (with resume), unpack, verify, remove.
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const catalog = require('./catalog');

const OLLAMA = process.env.OLLAMA_HOST ? process.env.OLLAMA_HOST.replace(/\/$/, '') : 'http://127.0.0.1:11434';

class ModelManager {
  /**
   * @param {string} dir where models are stored (inside the app's data folder)
   * @param {(evt:object)=>void} emit progress / state events for the UI
   */
  constructor(dir, emit) {
    this.dir = dir;
    this.emit = emit || (() => {});
    this.jobs = new Map(); // id -> { controller, pct, bytes, total, step }
    fs.mkdirSync(dir, { recursive: true });
  }

  modelDir(id) { return path.join(this.dir, id); }
  markerPath(id) { return path.join(this.modelDir(id), '.installed.json'); }

  isInstalled(id) {
    return fs.existsSync(this.markerPath(id));
  }

  /** Absolute paths of an installed model's files. */
  resolveFiles(id) {
    const m = catalog.byId(id);
    if (!m || !this.isInstalled(id)) return null;
    if (m.kind === 'report') {
      const marker = JSON.parse(fs.readFileSync(this.markerPath(id), 'utf8'));
      return { model: marker.modelPath };
    }
    const out = {};
    for (const [k, rel] of Object.entries(m.files || {})) out[k] = path.join(this.modelDir(id), rel);
    return out;
  }

  diskUsage() {
    let total = 0;
    const walk = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const f = path.join(p, e.name);
        if (e.isDirectory()) walk(f); else total += fs.statSync(f).size;
      }
    };
    try { walk(this.dir); } catch (e) { /* empty */ }
    return total;
  }

  list() {
    return catalog.all().map((m) => {
      const job = this.jobs.get(m.id);
      return {
        id: m.id, kind: m.kind, name: m.name, role: m.role, desc: m.desc, sizeMb: m.sizeMb,
        languages: m.languages || '', badge: m.badge || '', minMemoryGb: m.minMemoryGb || 0, uri: m.uri || '',
        installed: this.isInstalled(m.id),
        job: job ? { step: job.step, pct: job.pct, bytes: job.bytes, total: job.total } : null
      };
    });
  }

  _update(id, patch) {
    const job = Object.assign(this.jobs.get(id) || {}, patch);
    this.jobs.set(id, job);
    this.emit({ type: 'model-progress', id, step: job.step, pct: job.pct, bytes: job.bytes, total: job.total });
  }

  /** Install a catalog model (and voice essentials when a speech model needs them). */
  async install(id) {
    const m = catalog.byId(id);
    if (!m) throw new Error('Unknown model ' + id);
    if (this.jobs.has(id)) return;
    if (m.kind === 'speech' && !this.isInstalled('voice-essentials') && !this.jobs.has('voice-essentials')) {
      this.install('voice-essentials').catch((e) => this.emit({ type: 'model-error', id: 'voice-essentials', message: e.message }));
    }
    const controller = new AbortController();
    this.jobs.set(id, { controller, step: 'download', pct: 0, bytes: 0, total: m.sizeMb * 1e6 });
    try {
      await fsp.mkdir(this.modelDir(id), { recursive: true });
      if (m.kind === 'report') await this._installGguf(m, controller.signal);
      else await this._installFiles(m, controller.signal);
      this.jobs.delete(id);
      this.emit({ type: 'model-installed', id });
    } catch (e) {
      this.jobs.delete(id);
      if (controller.signal.aborted) { this.emit({ type: 'model-cancelled', id }); return; }
      this.emit({ type: 'model-error', id, message: friendlyError(e) });
      throw e;
    }
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (job && job.controller) job.controller.abort();
  }

  async remove(id) {
    this.cancel(id);
    await fsp.rm(this.modelDir(id), { recursive: true, force: true });
    this.emit({ type: 'model-removed', id });
  }

  async _installFiles(m, signal) {
    const dir = this.modelDir(m.id);
    // Measure the real total first so the progress bar is honest.
    let total = 0;
    for (const d of m.downloads) { d.size = await remoteSize(d.url, signal).catch(() => 0); total += d.size; }
    if (total) this._update(m.id, { total });
    let done = 0;
    for (const d of m.downloads) {
      const name = d.file || path.basename(new URL(d.url).pathname);
      const target = path.join(dir, d.extract ? '.dl-' + name : name);
      await download(d.url, target, signal, (bytes) => {
        const now = done + bytes;
        this._update(m.id, { step: 'download', bytes: now, pct: total ? Math.min(99, Math.round((now / total) * 100)) : 0 });
      });
      done += d.size || fs.statSync(target).size;
      if (d.extract) {
        this._update(m.id, { step: 'unpack' });
        await extractTar(target, dir);
        await fsp.rm(target, { force: true });
      }
    }
    for (const rel of Object.values(m.files)) {
      if (!fs.existsSync(path.join(dir, rel))) throw new Error('Missing file after install: ' + rel);
    }
    this._update(m.id, { step: 'done', pct: 100 });
    await fsp.writeFile(this.markerPath(m.id), JSON.stringify({ id: m.id, installedAt: new Date().toISOString() }));
  }

  async _installGguf(m, signal) {
    const { resolveModelFile } = await import('node-llama-cpp');
    const modelPath = await resolveModelFile(m.uri, {
      directory: this.modelDir(m.id),
      cli: false,
      signal,
      onProgress: ({ totalSize, downloadedSize }) => {
        this._update(m.id, { step: 'download', bytes: downloadedSize, total: totalSize, pct: totalSize ? Math.min(99, Math.round((downloadedSize / totalSize) * 100)) : 0 });
      }
    });
    this._update(m.id, { step: 'done', pct: 100 });
    await fsp.writeFile(this.markerPath(m.id), JSON.stringify({ id: m.id, modelPath, installedAt: new Date().toISOString() }));
  }

  // ---------- Ollama ----------
  async ollamaStatus() {
    try {
      const r = await fetchJson(OLLAMA + '/api/tags', { timeout: 1500 });
      return { running: true, url: OLLAMA, models: (r.models || []).map((x) => ({ name: x.name, size: x.size, family: x.details && x.details.family, params: x.details && x.details.parameter_size })) };
    } catch (e) {
      return { running: false, url: OLLAMA, models: [] };
    }
  }

  async ollamaPull(name) {
    const id = 'ollama:' + name;
    if (this.jobs.has(id)) return;
    const controller = new AbortController();
    this.jobs.set(id, { controller, step: 'download', pct: 0, bytes: 0, total: 0 });
    try {
      const res = await fetch(OLLAMA + '/api/pull', { method: 'POST', body: JSON.stringify({ model: name, stream: true }), signal: controller.signal });
      if (!res.ok) throw new Error('Ollama answered ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error(j.error);
          if (j.total) this._update(id, { step: 'download', bytes: j.completed || 0, total: j.total, pct: Math.min(99, Math.round(((j.completed || 0) / j.total) * 100)) });
          else this._update(id, { step: j.status === 'success' ? 'done' : 'unpack' });
        }
      }
      this.jobs.delete(id);
      this.emit({ type: 'model-installed', id });
    } catch (e) {
      this.jobs.delete(id);
      if (controller.signal.aborted) { this.emit({ type: 'model-cancelled', id }); return; }
      this.emit({ type: 'model-error', id, message: friendlyError(e) });
    }
  }

  async ollamaRemove(name) {
    await fetch(OLLAMA + '/api/delete', { method: 'DELETE', body: JSON.stringify({ model: name }) });
    this.emit({ type: 'model-removed', id: 'ollama:' + name });
  }
}

// ---------- helpers ----------

function friendlyError(e) {
  const msg = (e && e.message) || String(e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(msg)) return 'No internet connection — check your network and try again.';
  if (/ENOSPC/i.test(msg)) return 'Not enough free disk space for this model.';
  return msg;
}

function client(url) { return url.startsWith('https:') ? https : http; }

function request(url, opts, signal, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = client(url).request(url, Object.assign({ headers: { 'User-Agent': 'NovaMeet/1.0' } }, opts), (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).toString(), opts, signal, redirects - 1));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.end();
  });
}

async function remoteSize(url, signal) {
  const res = await request(url, { method: 'HEAD' }, signal);
  res.resume();
  return Number(res.headers['content-length'] || 0);
}

/** Download with resume support (a half-finished .part file continues where it stopped). */
async function download(url, target, signal, onBytes) {
  const part = target + '.part';
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const headers = { 'User-Agent': 'NovaMeet/1.0' };
  if (have) headers.Range = `bytes=${have}-`;
  const res = await request(url, { method: 'GET', headers }, signal);
  if (res.statusCode === 200) have = 0; // server ignored Range
  else if (res.statusCode !== 206) { res.resume(); throw new Error(`Download failed (${res.statusCode})`); }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    let bytes = have, last = 0;
    res.on('data', (chunk) => {
      bytes += chunk.length;
      const now = Date.now();
      if (now - last > 150) { last = now; onBytes(bytes); }
    });
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    if (signal) signal.addEventListener('abort', () => { res.destroy(); out.destroy(); reject(new Error('aborted')); }, { once: true });
    res.pipe(out);
  });
  onBytes(fs.statSync(part).size);
  await fsp.rename(part, target);
}

/** Unpack .tar.bz2 with the system tar (built into Windows 10+, macOS and Linux). */
function extractTar(file, dir) {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const p = spawn(bin, ['-xjf', file, '-C', dir], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Could not unpack model: ' + err.trim()))));
  });
}

async function fetchJson(url, { timeout } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout || 5000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

module.exports = { ModelManager, OLLAMA, download, extractTar };
