// NovaMeet speech engine — local speech-to-text, voice activity detection
// and speaker diarization on top of sherpa-onnx (runs fully offline).
// Plain CommonJS with no Electron imports so it can run in a utility
// process and be tested with plain Node.
'use strict';

const sherpa = require('sherpa-onnx-node');

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;

/** Build a sherpa OfflineRecognizer config from an installed speech model. */
function recognizerConfig(asr, threads) {
  const modelConfig = { tokens: asr.files.tokens, numThreads: threads, provider: 'cpu', debug: 0 };
  if (asr.kind === 'transducer') {
    modelConfig.transducer = { encoder: asr.files.encoder, decoder: asr.files.decoder, joiner: asr.files.joiner };
    modelConfig.modelType = 'nemo_transducer';
  } else if (asr.kind === 'whisper') {
    modelConfig.whisper = { encoder: asr.files.encoder, decoder: asr.files.decoder, language: asr.language || '', task: 'transcribe', tailPaddings: -1 };
  } else if (asr.kind === 'moonshine') {
    modelConfig.moonshine = { preprocessor: asr.files.preprocessor, encoder: asr.files.encoder, uncachedDecoder: asr.files.uncachedDecoder, cachedDecoder: asr.files.cachedDecoder };
  } else {
    throw new Error('Unsupported speech model kind: ' + asr.kind);
  }
  return { featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 }, modelConfig, decodingMethod: 'greedy_search' };
}

function vadConfig(model, maxSpeech) {
  return {
    sileroVad: { model, threshold: 0.45, minSilenceDuration: 0.45, minSpeechDuration: 0.25, windowSize: VAD_WINDOW, maxSpeechDuration: maxSpeech },
    sampleRate: SAMPLE_RATE, numThreads: 1, provider: 'cpu', debug: 0
  };
}

function cleanText(t) {
  return String(t || '').replace(/\s+/g, ' ').replace(/^\s*[-–—]\s*/, '').trim();
}

/**
 * One audio source (your microphone, or the meeting audio).
 * Audio is pushed in as it is recorded; finished utterances are decoded
 * in the background so the transcript is ready as soon as the call ends.
 */
class Track {
  constructor(engine, name) {
    this.engine = engine;
    this.name = name;
    this.vad = new sherpa.Vad(vadConfig(engine.vadModel, engine.maxSpeech), 120);
    this.rest = new Float32Array(0);
    this.queue = [];
    this.lines = [];
    this.samplesSeen = 0;
    this.busy = Promise.resolve();
  }

  push(samples) {
    let buf = samples;
    if (this.rest.length) { buf = new Float32Array(this.rest.length + samples.length); buf.set(this.rest); buf.set(samples, this.rest.length); }
    let i = 0;
    for (; i + VAD_WINDOW <= buf.length; i += VAD_WINDOW) this.vad.acceptWaveform(buf.subarray(i, i + VAD_WINDOW));
    this.rest = buf.slice(i);
    this.samplesSeen += samples.length;
    this._collect();
  }

  _collect() {
    while (!this.vad.isEmpty()) {
      const seg = this.vad.front(false);
      this.vad.pop();
      this._enqueue(seg.start / SAMPLE_RATE, seg.samples);
    }
  }

  _enqueue(start, samples) {
    this.busy = this.busy.then(() => this._decode(start, samples)).catch((e) => this.engine.onError(e));
  }

  async _decode(start, samples) {
    const rec = this.engine.recognizer;
    const stream = rec.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    const r = await rec.decodeAsync(stream);
    const text = cleanText(r.text);
    if (!text || /^[.,!?…\s]+$/.test(text)) return;
    let confidence = null;
    if (Array.isArray(r.ys_log_probs) && r.ys_log_probs.length) {
      const avg = r.ys_log_probs.reduce((a, b) => a + b, 0) / r.ys_log_probs.length;
      confidence = Math.max(0, Math.min(1, Math.exp(avg)));
    }
    const line = { track: this.name, start, end: start + samples.length / SAMPLE_RATE, text, lang: r.lang || '', confidence };
    this.lines.push(line);
    this.engine.onLine(line);
  }

  /** Flush the tail of the recording and wait for every utterance to decode. */
  async finish() {
    if (this.rest.length) {
      const pad = new Float32Array(VAD_WINDOW); pad.set(this.rest.subarray(0, VAD_WINDOW));
      this.vad.acceptWaveform(pad); this.rest = new Float32Array(0);
    }
    this.vad.flush();
    this._collect();
    await this.busy;
    return this.lines.slice().sort((a, b) => a.start - b.start);
  }
}

class SpeechEngine {
  /**
   * @param {object} opts
   * @param {{kind:string, files:object, language?:string}} opts.asr installed speech model
   * @param {string} opts.vadModel path to silero_vad.onnx
   * @param {number} [opts.threads]
   */
  constructor(opts) {
    this.asr = opts.asr;
    this.vadModel = opts.vadModel;
    this.threads = opts.threads || 4;
    this.maxSpeech = opts.asr.kind === 'transducer' ? 28 : 25;
    this.onLine = opts.onLine || (() => {});
    this.onError = opts.onError || ((e) => console.error(e));
    this.recognizer = null;
  }
  async init() {
    this.recognizer = await sherpa.OfflineRecognizer.createAsync(recognizerConfig(this.asr, this.threads));
    return this;
  }
  track(name) { return new Track(this, name); }
}

/**
 * Who spoke when. Returns [{start, end, speaker}] with speaker ids 0..n-1.
 * @param {Float32Array} samples 16 kHz mono
 */
function diarize(samples, { segmentationModel, embeddingModel, numSpeakers, threshold, threads }) {
  if (!samples || samples.length < SAMPLE_RATE * 2) return [];
  const sd = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationModel }, numThreads: threads || 4, debug: 0, provider: 'cpu' },
    embedding: { model: embeddingModel, numThreads: threads || 4, debug: 0, provider: 'cpu' },
    clustering: { numClusters: numSpeakers && numSpeakers > 0 ? numSpeakers : -1, threshold: threshold || 0.6 },
    minDurationOn: 0.3,
    minDurationOff: 0.5
  });
  return sd.process(samples).map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }));
}

/** Give every transcript line the speaker that overlaps it most. */
function assignSpeakers(lines, segments) {
  return lines.map((l) => {
    const score = new Map();
    for (const s of segments) {
      const o = Math.min(l.end, s.end) - Math.max(l.start, s.start);
      if (o > 0) score.set(s.speaker, (score.get(s.speaker) || 0) + o);
    }
    let best = null, bestV = 0, total = 0;
    for (const [k, v] of score) { total += v; if (v > bestV) { best = k; bestV = v; } }
    const dur = Math.max(0.01, l.end - l.start);
    // Overlapping voices or no clear owner → flag for review.
    const unclear = best === null || bestV / dur < 0.35 || (total > 0 && bestV / total < 0.6);
    return Object.assign({}, l, { speakerId: best, unclear });
  });
}

function words(t) { return String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean); }
function similarity(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/**
 * If you take the call on speakers, your microphone also hears the others.
 * Drop microphone lines that duplicate meeting-audio lines at the same time.
 */
function dropEcho(micLines, sysLines) {
  return micLines.filter((m) => !sysLines.some((s) => {
    const o = Math.min(m.end, s.end) - Math.max(m.start, s.start);
    return o > 0.3 && similarity(m.text, s.text) > 0.6;
  }));
}

module.exports = { SpeechEngine, diarize, assignSpeakers, dropEcho, recognizerConfig, SAMPLE_RATE, sherpa };
