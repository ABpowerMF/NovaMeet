// NovaMeet — main process: windows, the desktop notch, the meeting session
// and every local AI job.
import { app, BrowserWindow, ipcMain, screen, desktopCapturer, session, utilityProcess, dialog, shell, globalShortcut, powerSaveBlocker, Menu, protocol, net } from 'electron';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import workerPath from './ai/speech-worker?modulePath';
import { Store } from './store';
import { ModelManager } from './models/manager';
import catalog from './models/catalog';
import { WavWriter } from './wav';
import { generateReport } from './ai/report';
import { writeExport } from './export';
import { detectMeeting } from './detect';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

if (isMac) {
  // System audio capture on macOS (14.2+) goes through the screen-share loopback.
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
}
if (process.env.NOVAMEET_DATA) app.setPath('userData', process.env.NOVAMEET_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
// Meeting audio is served to the player through a private scheme (read-only, meetings folder only).
protocol.registerSchemesAsPrivileged([{ scheme: 'nova-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

let store, models;
let mainWin = null, notchWin = null, recWin = null;
let worker = null, workerWaiters = [];
let hwCache = null;
let reportAbort = null;

const S = {
  mode: 'idle',            // idle | recording | audio | uncertain | processing | completed
  paused: false,
  meetingId: null,
  title: '',
  source: '',
  startedAt: 0,
  pausedMs: 0,
  pauseStart: 0,
  audioIssue: '',
  unclearUntil: 0,
  progress: null,          // { step, pct }
  live: [],                // last few live transcript lines
  detected: null,          // { app, title } when a call is open
  lastCompletedId: null,
  speakersHeard: 0
};
let wavs = null, blocker = null, levels = { sysSilent: 0, clip: 0 };

// ---------------------------------------------------------------- helpers
const paths = () => ({
  data: app.getPath('userData'),
  models: path.join(app.getPath('userData'), 'models'),
  defaultSave: path.join(app.getPath('documents'), 'NovaMeet')
});

function preload() { return path.join(__dirname, '../preload/index.js'); }
function loadPage(win, page) {
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`);
  else win.loadFile(path.join(__dirname, `../renderer/${page}.html`));
}
function broadcast(channel, payload) {
  for (const w of [mainWin, notchWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
function toast(text, kind) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('toast', { text, kind: kind || 'ok' }); }

function elapsed() {
  if (!S.startedAt) return 0;
  const now = Date.now();
  const paused = S.pausedMs + (S.paused ? now - S.pauseStart : 0);
  return Math.max(0, Math.floor((now - S.startedAt - paused) / 1000));
}
function isActive() { return ['recording', 'audio', 'uncertain'].includes(S.mode); }

/** The notch shows the most important thing happening right now. */
function effectiveMode() {
  if (!isActive()) return S.mode;
  if (S.audioIssue) return 'audio';
  if (S.unclearUntil > Date.now()) return 'uncertain';
  return 'recording';
}

function publicState() {
  return {
    mode: effectiveMode(), paused: S.paused, meetingId: S.meetingId, title: S.title, source: S.source,
    elapsed: elapsed(), audioIssue: S.audioIssue, progress: S.progress, live: S.live, detected: S.detected,
    lastCompletedId: S.lastCompletedId, speakersHeard: S.speakersHeard
  };
}
let lastStateJson = '';
function pushState(force) {
  const st = publicState();
  const j = JSON.stringify(st);
  if (!force && j === lastStateJson) return;
  lastStateJson = j;
  broadcast('state', st);
  syncNotchVisibility();
}

// ---------------------------------------------------------------- windows
function createMainWindow() {
  const dark = store.settings.theme === 'dark';
  mainWin = new BrowserWindow({
    width: 1320, height: 860, minWidth: 960, minHeight: 640, show: false,
    backgroundColor: dark ? '#0B101D' : '#F5F6F8',
    title: 'NovaMeet',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 14 } } : {}),
    ...(isMac ? {} : { titleBarOverlay: overlayColors() }),
    webPreferences: { preload: preload(), contextIsolation: true, sandbox: true, spellcheck: false }
  });
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('close', (e) => {
    if ((isActive() || S.mode === 'processing') && !app.isQuitting) { e.preventDefault(); mainWin.hide(); }
  });
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  loadPage(mainWin, 'index');
}

function overlayColors() {
  const dark = store.settings.theme === 'dark';
  return { color: dark ? '#151E30' : '#F2F4F7', symbolColor: dark ? '#AEB8CD' : '#45526C', height: 40 };
}

function showMain(route) {
  if (!mainWin || mainWin.isDestroyed()) createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
  if (route) mainWin.webContents.send('navigate', route);
}

const NOTCH_W = 460, NOTCH_H = 240;
function notchBounds() {
  const displays = screen.getAllDisplays();
  const d = displays.find((x) => String(x.id) === String(store.settings.notchDisplay)) || screen.getPrimaryDisplay();
  const b = d.bounds;
  const margin = 24;
  let x = b.x + Math.round((b.width - NOTCH_W) / 2);
  if (store.settings.notchPos === 'left') x = b.x + margin + (isMac ? 160 : 0);
  if (store.settings.notchPos === 'right') x = b.x + b.width - NOTCH_W - margin - (isMac ? 160 : 0);
  return { x, y: b.y, width: NOTCH_W, height: NOTCH_H };
}

function createNotchWindow() {
  notchWin = new BrowserWindow({
    ...notchBounds(), show: false, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    focusable: false, alwaysOnTop: true, backgroundColor: '#00000000',
    ...(isMac ? { type: 'panel', enableLargerThanScreen: true } : { type: 'toolbar' }),
    webPreferences: { preload: preload(), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  notchWin.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) notchWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  notchWin.setIgnoreMouseEvents(true, { forward: true });
  notchWin.on('closed', () => { notchWin = null; });
  loadPage(notchWin, 'notch');
  notchWin.webContents.once('did-finish-load', () => { pushState(true); syncNotchVisibility(); });
}

function syncNotchVisibility() {
  if (!notchWin || notchWin.isDestroyed()) return;
  const want = store.settings.showNotch === 'always' || S.mode !== 'idle' || !!S.detected;
  if (want && !notchWin.isVisible()) notchWin.showInactive();
  if (!want && notchWin.isVisible()) notchWin.hide();
}

function placeNotch() { if (notchWin && !notchWin.isDestroyed()) notchWin.setBounds(notchBounds()); }

function createRecorderWindow() {
  recWin = new BrowserWindow({
    show: false, width: 200, height: 100, skipTaskbar: true,
    webPreferences: { preload: preload(), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  recWin.on('closed', () => { recWin = null; });
  loadPage(recWin, 'recorder');
}

// ---------------------------------------------------------------- speech worker
function startWorker() {
  worker = utilityProcess.fork(workerPath, [], { serviceName: 'NovaMeet speech engine', stdio: 'inherit' });
  worker.on('message', (msg) => {
    if (msg.type === 'line') onLiveLine(msg.line);
    else if (msg.type === 'progress') { S.progress = { step: msg.step, pct: msg.pct }; pushState(); }
    else if (msg.type === 'warn') console.warn('[speech]', msg.message);
    for (const w of workerWaiters.slice()) {
      if (w.types.includes(msg.type)) { workerWaiters.splice(workerWaiters.indexOf(w), 1); msg.type === 'error' ? w.reject(new Error(msg.message)) : w.resolve(msg); }
    }
  });
  worker.on('exit', (code) => {
    worker = null;
    for (const w of workerWaiters.splice(0)) w.reject(new Error('Speech engine stopped (' + code + ')'));
  });
}
function workerCall(msg, types) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => { workerWaiters.push({ types: types.concat('error'), resolve, reject }); worker.postMessage(msg); });
}
function speechConfig() {
  const id = store.settings.speechModel;
  const m = catalog.byId(id);
  const files = models.resolveFiles(id);
  const ess = models.resolveFiles('voice-essentials');
  if (!m || !files || !ess) return null;
  return {
    asr: { kind: m.engine, files, language: store.settings.language || '' },
    vad: ess.vad,
    threads: Math.max(2, Math.min(8, os.cpus().length - 2)),
    diar: store.settings.diar ? { segmentation: ess.segmentation, embedding: ess.embedding, numSpeakers: Number(store.settings.expectedSpeakers) || 0 } : null
  };
}
function firstInstalledSpeech() {
  return catalog.SPEECH.find((m) => models.isInstalled(m.id));
}

function onLiveLine(line) {
  if (!isActive()) return;
  const who = line.track === 'mic' ? (store.settings.userName || 'You') : 'Meeting';
  S.live = S.live.concat([{ who, text: line.text, start: line.start }]).slice(-3);
  if (line.confidence !== null && line.confidence !== undefined && line.confidence < 0.45) S.unclearUntil = Date.now() + 6000;
  pushState();
}

// ---------------------------------------------------------------- the meeting session
async function startSession(opts = {}) {
  if (isActive() || S.mode === 'processing') return { ok: false, reason: 'busy' };
  if (!models.isInstalled(store.settings.speechModel)) {
    const alt = firstInstalledSpeech();
    if (alt) store.saveSettings({ speechModel: alt.id });
  }
  const cfg = speechConfig();
  if (!cfg) return { ok: false, reason: 'no-speech-model' };

  const det = S.detected || {};
  const m = store.create({ title: opts.title || det.title || 'Meeting ' + new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), source: det.app || '', category: opts.category || '' });
  const folder = store.folder(m.id);
  wavs = { mic: new WavWriter(path.join(folder, 'mic.wav')), sys: new WavWriter(path.join(folder, 'meeting.wav')) };
  levels = { sysSilent: 0, clip: 0 };

  try {
    await workerCall(Object.assign({ type: 'start' }, cfg), ['ready']);
  } catch (e) {
    wavs.mic.close(); wavs.sys.close(); wavs = null;
    store.update(m.id, { status: 'failed', error: e.message });
    return { ok: false, reason: 'engine', message: e.message };
  }
  if (!recWin) createRecorderWindow();
  const started = await recorderCall('rec:start', { micId: store.settings.micId, sysAudio: store.settings.sysAudio !== 'off', noise: store.settings.noise, gain: store.settings.inputGain / 100 }, 'rec:started', 15000).catch((e) => ({ error: e.message }));
  if (started.error) {
    wavs.mic.close(); wavs.sys.close(); wavs = null;
    await store.remove(m.id);
    return { ok: false, reason: 'audio', message: started.error };
  }
  Object.assign(S, { mode: 'recording', paused: false, meetingId: m.id, title: m.title, source: m.source, startedAt: Date.now(), pausedMs: 0, audioIssue: started.warning || '', unclearUntil: 0, progress: null, live: [], speakersHeard: 0 });
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  pushState(true);
  broadcast('meetings-changed');
  return { ok: true, id: m.id };
}

function pauseSession(p) {
  if (!isActive() || S.paused === p) return;
  if (p) { S.paused = true; S.pauseStart = Date.now(); }
  else { S.pausedMs += Date.now() - S.pauseStart; S.paused = false; }
  if (recWin) recWin.webContents.send('rec:pause', p);
  pushState(true);
}

async function endSession() {
  if (!isActive()) return;
  const id = S.meetingId;
  const duration = elapsed();
  S.mode = 'processing'; S.paused = false; S.progress = { step: 'transcript', pct: 5 }; S.audioIssue = '';
  pushState(true);
  await recorderCall('rec:stop', null, 'rec:stopped', 6000).catch(() => null);
  if (wavs) { wavs.mic.close(); wavs.sys.close(); }
  const sysWav = path.join(store.folder(id), 'meeting.wav');
  wavs = null;
  if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
  store.update(id, { status: 'processing', duration });
  broadcast('meetings-changed');
  await processMeeting(id, { stop: true, sysWav });
}

/** Transcript → speakers → report. Used after a call and to re-process later. */
async function processMeeting(id, { stop, sysWav, reTranscribe } = {}) {
  try {
    const cfg = speechConfig();
    let lines;
    if (stop) {
      const res = await workerCall({ type: 'stop', sysWav, diar: cfg && cfg.diar, threads: cfg && cfg.threads }, ['result']);
      lines = res.lines;
    } else if (reTranscribe) {
      if (!cfg) throw new Error('Install a speech model first.');
      const f = store.folder(id);
      const micWav = path.join(f, 'mic.wav'), meetWav = path.join(f, 'meeting.wav');
      if (!fs.existsSync(meetWav)) throw new Error('The audio for this meeting was deleted after processing.');
      const res = await workerCall(Object.assign({ type: 'transcribeFiles', micWav: fs.existsSync(micWav) ? micWav : null, sysWav: meetWav }, cfg), ['result']);
      lines = res.lines;
    } else {
      lines = (store.get(id) || {}).lines || [];
    }
    const prev = store.get(id) || {};
    const speakers = { me: store.settings.userName || 'You' };
    let n = 0;
    for (const l of lines) if (!speakers[l.speaker] && l.speaker !== 'unknown') speakers[l.speaker] = (prev.speakers && prev.speakers[l.speaker]) || 'Speaker ' + (++n);
    if (lines.some((l) => l.speaker === 'unknown')) speakers.unknown = 'Speaker unclear';
    if (!lines.some((l) => l.speaker === 'me')) delete speakers.me;
    store.update(id, { lines, speakers, status: 'processing' });

    const backend = await reportBackend();
    let report = null, status = lines.some((l) => l.unclear) ? 'review' : 'done', note = '';
    if (!lines.length) { status = 'done'; note = 'No speech was detected in this recording.'; }
    else if (backend) {
      S.progress = { step: 'report', pct: 5 }; pushState();
      reportAbort = new AbortController();
      const m = store.get(id);
      report = await generateReport(m, backend, (p) => { S.progress = { step: 'report', pct: p.pct }; pushState(); }, reportAbort.signal);
      reportAbort = null;
    } else note = 'Transcript ready. Install a report model in AI Models to get decisions, actions and warnings.';
    const m = store.get(id);
    const genericTitle = /^Meeting /.test(m.title) || !m.title;
    store.update(id, { report, status, error: '', note, title: genericTitle && report && report.title ? report.title : m.title });

    if (store.settings.autoSave && report) {
      const folder = store.settings.savePath || paths().defaultSave;
      await writeExport(store.get(id), store.settings.defFormat === 'gdocs' ? 'pdf' : store.settings.defFormat, store.settings.defContent, folder, printToPdf).catch((e) => console.warn('auto-save', e));
    }
    if (store.settings.delAudio) for (const f of ['mic.wav', 'meeting.wav']) fs.rmSync(path.join(store.folder(id), f), { force: true });

    if (stop || S.mode === 'processing') {
      Object.assign(S, { mode: 'completed', meetingId: null, progress: null, live: [], lastCompletedId: id, startedAt: 0 });
      pushState(true);
      setTimeout(() => { if (S.mode === 'completed') { S.mode = 'idle'; pushState(true); } }, 8000);
    }
    toast(report ? 'Meeting processed — report ready' : (note || 'Meeting processed'));
  } catch (e) {
    console.error(e);
    reportAbort = null;
    store.update(id, { status: 'failed', error: e.message });
    if (S.mode === 'processing') { Object.assign(S, { mode: 'idle', meetingId: null, progress: null, startedAt: 0 }); pushState(true); }
    toast('Processing failed: ' + e.message, 'error');
  }
  broadcast('meetings-changed');
}

async function reportBackend() {
  const r = store.settings.report || {};
  if (r.type === 'ollama' && r.ollamaModel) {
    const st = await models.ollamaStatus();
    if (st.running && st.models.some((x) => x.name === r.ollamaModel)) return { type: 'ollama', url: st.url, model: r.ollamaModel };
  }
  const pick = [r.modelId].concat(catalog.REPORT.map((m) => m.id)).find((id) => id && models.isInstalled(id));
  if (pick) {
    const m = catalog.byId(pick);
    return { type: 'llama', modelPath: models.resolveFiles(pick).model, contextSize: m.contextSize };
  }
  return null;
}

async function printToPdf(html) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await w.webContents.printToPDF({ printBackground: true, margins: { marginType: 'custom', top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }, pageSize: 'A4' });
  } finally { w.destroy(); }
}

// ---------------------------------------------------------------- recorder bridge
const recWaiters = [];
function recorderCall(channel, payload, replyChannel, timeout) {
  return new Promise((resolve, reject) => {
    if (!recWin) return reject(new Error('Recorder not available'));
    const t = setTimeout(() => { const i = recWaiters.indexOf(w); if (i >= 0) recWaiters.splice(i, 1); reject(new Error('The audio recorder did not respond')); }, timeout);
    const w = { channel: replyChannel, resolve: (v) => { clearTimeout(t); resolve(v); }, reject };
    recWaiters.push(w);
    const send = () => recWin.webContents.send(channel, payload);
    if (recWin.webContents.isLoading()) recWin.webContents.once('did-finish-load', send); else send();
  });
}
ipcMain.on('rec:reply', (_e, channel, payload) => {
  const i = recWaiters.findIndex((w) => w.channel === channel);
  if (i >= 0) recWaiters.splice(i, 1)[0].resolve(payload || {});
});
ipcMain.on('rec:chunk', (_e, track, samples) => {
  if (!wavs || S.paused) return;
  const f = samples instanceof Float32Array ? samples : new Float32Array(samples);
  wavs[track].write(f);
  if (worker) worker.postMessage({ type: 'audio', track, samples: f });
});
ipcMain.on('rec:levels', (_e, lv) => {
  if (!isActive() || S.paused) return;
  // Meeting audio silent for 45 s while you are talking → probably the wrong source.
  levels.sysSilent = lv.sys < 0.0008 ? levels.sysSilent + 1 : 0;
  levels.clip = lv.clip > 0.02 ? levels.clip + 1 : Math.max(0, levels.clip - 1);
  let issue = '';
  if (lv.sysEnded) issue = 'Meeting audio lost';
  else if (levels.clip >= 3) issue = 'Audio quality reduced';
  else if (levels.sysSilent >= 45 && lv.mic > 0.003) issue = 'No meeting audio';
  if (issue !== S.audioIssue) { S.audioIssue = issue; pushState(true); }
});
ipcMain.on('rec:fatal', (_e, message) => { toast('Recording problem: ' + message, 'error'); S.audioIssue = 'Audio quality reduced'; pushState(true); });

// ---------------------------------------------------------------- hardware
async function hardware() {
  if (hwCache) return hwCache;
  const ramGb = Math.round(os.totalmem() / 1073741824);
  const cpu = (os.cpus()[0] || {}).model || 'CPU';
  let gpu = { type: 'none', name: '', vramGb: 0 };
  try {
    const { getLlama } = await import('node-llama-cpp');
    const llama = await Promise.race([getLlama({ gpu: 'auto', build: 'never', progressLogs: false }), new Promise((_, rej) => setTimeout(() => rej(new Error('GPU check timed out')), 20000))]);
    const v = await llama.getVramState();
    const names = typeof llama.getGpuDeviceNames === 'function' ? await llama.getGpuDeviceNames().catch(() => []) : [];
    gpu = { type: llama.gpu || 'none', name: (names || []).join(', '), vramGb: Math.round((v.total || 0) / 1073741824), unified: !!v.unifiedSize };
  } catch (e) { gpu.error = e.message; }
  const mem = gpu.unified ? ramGb * 0.7 : gpu.vramGb;
  let recommended = 'qwen3-4b';
  if (mem >= 22) recommended = 'qwen3-30b';
  else if (mem >= 10) recommended = 'gemma3-12b';
  hwCache = { os: isMac ? 'macOS' : isWin ? 'Windows' : 'Linux', osVersion: os.release(), cpu, cores: os.cpus().length, ramGb, gpu, recommended };
  return hwCache;
}

// ---------------------------------------------------------------- IPC
function handle(name, fn) { ipcMain.handle(name, (_e, ...a) => fn(...a)); }

function registerIpc() {
  handle('app:init', async () => ({
    settings: store.settings, platform: process.platform, version: app.getVersion(),
    state: publicState(), meetings: store.list(), models: models.list(),
    paths: paths(), displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || (d.internal ? 'Built-in display' : 'Display ' + (i + 1)), primary: d.id === screen.getPrimaryDisplay().id }))
  }));
  handle('settings:set', (patch) => {
    const before = store.settings;
    const s = store.saveSettings(patch);
    if (patch.theme && mainWin && !isMac) mainWin.setTitleBarOverlay(overlayColors());
    if ('notchPos' in patch || 'notchDisplay' in patch) placeNotch();
    if ('showNotch' in patch) syncNotchVisibility();
    if ('launchLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchLogin });
    if ('retention' in patch && patch.retention !== before.retention) store.applyRetention().then((n) => n && broadcast('meetings-changed'));
    broadcast('settings', s);
    return s;
  });
  handle('meetings:list', () => store.list());
  handle('meetings:get', (id) => store.get(id));
  handle('meetings:update', (id, patch) => { const allowed = {}; for (const k of ['title', 'category', 'speakers', 'report']) if (k in patch) allowed[k] = patch[k]; const m = store.update(id, allowed); broadcast('meetings-changed'); return m; });
  handle('meetings:delete', async (id) => { await store.remove(id); broadcast('meetings-changed'); return true; });
  handle('meetings:deleteAll', async () => { if (isActive()) return false; await store.removeAll(); broadcast('meetings-changed'); return true; });
  handle('meetings:reprocess', async (id, what) => {
    if (S.mode === 'processing') return { ok: false, reason: 'busy' };
    store.update(id, { status: 'processing' }); broadcast('meetings-changed');
    processMeeting(id, { reTranscribe: what === 'transcript' });
    return { ok: true };
  });
  handle('search', (q) => store.search(q));

  handle('models:list', async () => ({ models: models.list(), ollama: await models.ollamaStatus(), disk: models.diskUsage(), free: freeSpace(paths().models), suggestedOllama: catalog.OLLAMA_SUGGESTED }));
  handle('models:install', (id) => { models.install(id).catch(() => {}); return true; });
  handle('models:installRecommended', async () => {
    const hw = await hardware();
    const speech = 'parakeet-v3';
    store.saveSettings({ speechModel: speech, report: Object.assign({}, store.settings.report, { type: 'llama', modelId: hw.recommended }) });
    broadcast('settings', store.settings);
    for (const id of ['voice-essentials', speech, hw.recommended]) if (!models.isInstalled(id)) models.install(id).catch(() => {});
    return { speech, report: hw.recommended };
  });
  handle('models:cancel', (id) => { models.cancel(id); return true; });
  handle('models:remove', async (id) => { await models.remove(id); return true; });
  handle('ollama:pull', (name) => { models.ollamaPull(name); return true; });
  handle('ollama:remove', async (name) => { await models.ollamaRemove(name); return true; });
  handle('hw:info', () => hardware());

  handle('session:start', (opts) => startSession(opts || {}));
  handle('session:pause', (p) => { pauseSession(!!p); return true; });
  handle('session:end', () => { endSession(); return true; });
  handle('session:cancelReport', () => { if (reportAbort) reportAbort.abort(); return true; });

  handle('export', async (id, format, content, opts = {}) => {
    const m = store.get(id);
    if (!m) throw new Error('Meeting not found');
    let folder = store.settings.savePath || paths().defaultSave;
    if (opts.ask) {
      const r = await dialog.showOpenDialog(mainWin, { title: 'Export to folder', defaultPath: folder, properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      folder = r.filePaths[0];
    }
    return writeExport(m, format, content, folder, printToPdf);
  });
  handle('shell:show', (p) => { shell.showItemInFolder(p); return true; });
  handle('shell:open', (p) => shell.openPath(p));
  handle('dialog:folder', async (current) => {
    const r = await dialog.showOpenDialog(mainWin, { defaultPath: current || paths().defaultSave, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('app:show', (route) => { showMain(route); return true; });
  handle('notch:interactive', (on) => { if (notchWin) notchWin.setIgnoreMouseEvents(!on, { forward: true }); return true; });
  handle('notch:startFromNotch', async () => {
    if (store.settings.consentRemind) { showMain({ consent: true }); return { ok: false, reason: 'consent' }; }
    const r = await startSession();
    if (!r.ok) showMain({ startError: r });
    return r;
  });
}

function freeSpace(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch (e) { return 0; }
}

// Developer screenshots of every screen (used with NOVAMEET_SELFTEST).
async function screenshots(dir, ownId) {
  const meetingId = process.env.NOVAMEET_SHOT_MEETING || ownId;
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  mainWin.setSize(1360, 900);
  const routes = [['home', { screen: 'home' }], ['meetings', { screen: 'meetings' }], ['search', { screen: 'search' }], ['models', { screen: 'models' }], ['integrations', { screen: 'integrations' }], ['settings', { screen: 'settings' }],
    ['report-overview', { screen: 'report', id: meetingId, tab: 'overview', nonce: 1 }], ['report-transcript', { screen: 'report', id: meetingId, tab: 'transcript', hl: 'l18', nonce: 2 }], ['report-people', { screen: 'report', id: meetingId, tab: 'people', nonce: 3 }],
    ['report-actions', { screen: 'report', id: meetingId, tab: 'actions', nonce: 4 }], ['report-warnings', { screen: 'report', id: meetingId, tab: 'warnings', nonce: 5 }], ['report-timeline', { screen: 'report', id: meetingId, tab: 'timeline', nonce: 6 }], ['report-summary', { screen: 'report', id: meetingId, tab: 'summary', nonce: 7 }]];
  for (const theme of ['light', 'dark']) {
    store.saveSettings({ theme }); broadcast('settings', store.settings);
    for (const [name, route] of routes) {
      mainWin.webContents.send('navigate', route); await wait(900);
      fs.writeFileSync(path.join(dir, `${theme}-${name}.png`), (await mainWin.webContents.capturePage()).toPNG());
    }
  }
  store.saveSettings({ theme: 'light' }); broadcast('settings', store.settings);
  for (const mode of ['idle', 'recording', 'audio', 'uncertain', 'processing', 'completed']) {
    S.mode = mode; S.startedAt = Date.now() - 754000; S.audioIssue = mode === 'audio' ? 'Audio quality reduced' : ''; S.unclearUntil = mode === 'uncertain' ? Date.now() + 9e9 : 0;
    S.title = 'Project Phoenix — Weekly Meeting'; S.source = 'Zoom';
    pushState(true); notchWin.showInactive(); await wait(1100);
    fs.writeFileSync(path.join(dir, `notch-${mode}.png`), (await notchWin.webContents.capturePage()).toPNG());
  }
  S.mode = 'recording'; S.audioIssue = ''; S.unclearUntil = 0; pushState(true);
  notchWin.webContents.send('notch:toggle'); await wait(1100);
  fs.writeFileSync(path.join(dir, 'notch-expanded.png'), (await notchWin.webContents.capturePage()).toPNG());
  S.mode = 'idle'; pushState(true);
}

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(async () => {
  if (isMac) app.dock && app.dock.show();
  if (!isMac) Menu.setApplicationMenu(null);
  store = new Store(app.getPath('userData'));
  models = new ModelManager(paths().models, (evt) => broadcast('models', evt));
  registerIpc();
  protocol.handle('nova-media', (req) => {
    const u = new URL(req.url);
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    const id = parts[0], file = parts[1];
    if (u.hostname !== 'meeting' || !/^[\w-]+$/.test(id || '') || !['meeting.wav', 'mic.wav'].includes(file)) return new Response('Not found', { status: 404 });
    const p = path.join(store.folder(id), file);
    if (!fs.existsSync(p)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(p).toString(), { headers: req.headers });
  });

  // System audio for the recorder: share the screen's loopback audio only.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback({ video: sources[0], audio: 'loopback' })).catch(() => callback({}));
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission)));

  createMainWindow();
  createNotchWindow();
  if (process.env.NOVAMEET_SELFTEST) for (const w of [mainWin, notchWin]) w.webContents.on('console-message', (e) => { const lv = e.level; if (lv === 'error' || lv === 'warning' || lv === 3 || lv === 2) console.log('[renderer]', e.message); });
  createRecorderWindow();
  startWorker();
  store.applyRetention().catch(() => {});

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (isActive()) { if (notchWin) notchWin.webContents.send('notch:toggle'); }
    else if (S.mode === 'idle') { if (store.settings.consentRemind) showMain({ consent: true }); else startSession().then((r) => { if (!r.ok) showMain({ startError: r }); }); }
  });

  screen.on('display-added', placeNotch);
  screen.on('display-removed', placeNotch);
  screen.on('display-metrics-changed', placeNotch);

  // Tick: elapsed time + meeting detection.
  let detectTick = 0;
  setInterval(async () => {
    if (isActive()) pushState();
    if (++detectTick % 8 === 0 && store.settings.detect && S.mode === 'idle') {
      const d = await detectMeeting(desktopCapturer);
      const changed = JSON.stringify(d) !== JSON.stringify(S.detected);
      S.detected = d;
      if (changed) pushState(true);
    }
  }, 1000);
  setInterval(() => store.applyRetention().then((n) => n && broadcast('meetings-changed')).catch(() => {}), 6 * 3600 * 1000);

  app.on('activate', () => showMain());

  // Developer self-test: NOVAMEET_SELFTEST=seconds records, processes and exports one meeting, then quits.
  if (process.env.NOVAMEET_SELFTEST) {
    const secs = Number(process.env.NOVAMEET_SELFTEST) || 20;
    setTimeout(async () => {
      const r = await startSession({ title: 'Self-test meeting' });
      console.log('[selftest] start', JSON.stringify(r), JSON.stringify(publicState()));
      if (!r.ok) { app.exit(2); return; }
      setTimeout(async () => {
        console.log('[selftest] live', JSON.stringify(S.live));
        await endSession();
        const m = store.get(r.id);
        console.log('[selftest] meeting', JSON.stringify({ status: m.status, duration: m.duration, speakers: m.speakers, lines: m.lines, note: m.note, error: m.error }));
        for (const f of ['txt', 'docx', 'pdf']) {
          const file = await writeExport(m, f, 'transcript', path.join(app.getPath('userData'), 'exports'), printToPdf);
          console.log('[selftest] export', f, fs.statSync(file).size);
        }
        console.log('[selftest] list', JSON.stringify(store.list()));
        console.log('[selftest] search', JSON.stringify(store.search('country').slice(0, 2)));
        if (process.env.NOVAMEET_SHOTS) await screenshots(process.env.NOVAMEET_SHOTS, r.id);
        app.isQuitting = true; app.exit(0);
      }, secs * 1000);
    }, 4000);
  }
});

app.on('second-instance', () => showMain());
app.on('before-quit', (e) => {
  if (isActive() && !app.isQuitting) {
    const r = dialog.showMessageBoxSync({ type: 'question', buttons: ['End meeting and quit', 'Keep recording'], defaultId: 1, message: 'A meeting is still being recorded.', detail: 'Quitting now ends the recording. NovaMeet will finish the transcript the next time it opens.' });
    if (r === 1) { e.preventDefault(); return; }
    if (wavs) { wavs.mic.close(); wavs.sys.close(); }
    if (S.meetingId) store.update(S.meetingId, { status: 'failed', duration: elapsed(), error: 'NovaMeet was closed during the meeting. Open it and choose “Transcribe again”.' });
  }
  app.isQuitting = true;
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (worker) worker.kill(); });
app.on('window-all-closed', () => { if (!isMac && !isActive()) app.quit(); });
