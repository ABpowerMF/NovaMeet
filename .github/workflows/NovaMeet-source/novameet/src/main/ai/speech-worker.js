// Runs in an Electron utility process so heavy speech work never freezes the UI.
'use strict';

const { SpeechEngine, diarize, assignSpeakers, dropEcho, sherpa } = require('./speech-engine');

const port = process.parentPort;
let engine = null;
let tracks = null;
let engineKey = '';

function send(msg) { port.postMessage(msg); }

async function ensureEngine(cfg) {
  const key = JSON.stringify([cfg.asr, cfg.vad]);
  if (engine && key === engineKey) return engine;
  engine = await new SpeechEngine({
    asr: cfg.asr, vadModel: cfg.vad, threads: cfg.threads,
    onLine: (line) => send({ type: 'line', line }),
    onError: (e) => send({ type: 'warn', message: String(e && e.message || e) })
  }).init();
  engineKey = key;
  return engine;
}

async function finishAndDiarize(cfg) {
  send({ type: 'progress', step: 'transcript', pct: 10 });
  const mic = tracks ? await tracks.mic.finish() : [];
  const sys = tracks ? await tracks.sys.finish() : [];
  tracks = null;
  send({ type: 'progress', step: 'speakers', pct: 40 });

  let sysLines = sys.map((l) => Object.assign({}, l, { speakerId: 0, unclear: false }));
  if (cfg.diar && cfg.sysWav && sys.length) {
    try {
      const wav = sherpa.readWave(cfg.sysWav);
      const segs = diarize(wav.samples, {
        segmentationModel: cfg.diar.segmentation, embeddingModel: cfg.diar.embedding,
        numSpeakers: cfg.diar.numSpeakers || 0, threads: cfg.threads
      });
      if (segs.length) sysLines = assignSpeakers(sys, segs);
    } catch (e) {
      send({ type: 'warn', message: 'Speaker identification failed: ' + e.message });
    }
  }
  const micLines = dropEcho(mic, sys).map((l) => Object.assign({}, l, { speaker: 'me', unclear: false }));
  // Renumber meeting speakers in order of first appearance: S1, S2, …
  const order = new Map();
  for (const l of sysLines.slice().sort((a, b) => a.start - b.start)) {
    if (l.speakerId !== null && l.speakerId !== undefined && !order.has(l.speakerId)) order.set(l.speakerId, 'S' + (order.size + 1));
  }
  const others = sysLines.map((l) => Object.assign({}, l, { speaker: l.speakerId === null || l.speakerId === undefined ? 'unknown' : order.get(l.speakerId) }));
  const lines = micLines.concat(others)
    .sort((a, b) => a.start - b.start)
    .map((l, i) => ({ id: 'l' + (i + 1), start: +l.start.toFixed(2), end: +l.end.toFixed(2), speaker: l.speaker, text: l.text, unclear: !!l.unclear || (l.confidence !== null && l.confidence !== undefined && l.confidence < 0.45), lang: l.lang || '' }));
  send({ type: 'progress', step: 'speakers', pct: 100 });
  return lines;
}

function feedFile(track, file) {
  if (!file) return;
  const wav = sherpa.readWave(file);
  if (wav.sampleRate !== 16000) throw new Error('Expected 16 kHz audio');
  const step = 16000 * 5;
  for (let i = 0; i < wav.samples.length; i += step) track.push(wav.samples.subarray(i, i + step));
}

port.on('message', async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'start') {
      await ensureEngine(msg);
      tracks = { mic: engine.track('mic'), sys: engine.track('sys') };
      send({ type: 'ready' });
    } else if (msg.type === 'audio') {
      if (tracks) tracks[msg.track].push(msg.samples);
    } else if (msg.type === 'stop') {
      const lines = await finishAndDiarize(msg);
      send({ type: 'result', lines });
    } else if (msg.type === 'transcribeFiles') {
      // Re-process a saved meeting (e.g. after installing a better model).
      await ensureEngine(msg);
      tracks = { mic: engine.track('mic'), sys: engine.track('sys') };
      feedFile(tracks.mic, msg.micWav);
      feedFile(tracks.sys, msg.sysWav);
      const lines = await finishAndDiarize(msg);
      send({ type: 'result', lines });
    } else if (msg.type === 'cancel') {
      tracks = null;
    }
  } catch (err) {
    send({ type: 'error', message: String(err && err.message || err) });
  }
});

send({ type: 'booted' });
