// Hidden recorder: your microphone + the meeting's system audio, as two
// separate 16 kHz tracks (so "you" never gets mixed up with the others).
import workletUrl from './capture-worklet.js?url';

const nova = window.nova;
let ctx = null;
let tracks = {};
let streams = [];
let paused = false;
let levelTimer = null;
const stats = { mic: { sum: 0, n: 0, clip: 0 }, sys: { sum: 0, n: 0, clip: 0 } };
let sysEnded = false;

function reply(channel, payload) { nova.send('rec:reply', channel, payload); }

async function addTrack(name, stream, gain) {
  const src = ctx.createMediaStreamSource(stream);
  const g = ctx.createGain(); g.gain.value = gain;
  const node = new AudioWorkletNode(ctx, 'nova-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(g); g.connect(node); node.connect(mute); mute.connect(ctx.destination);
  const t = { node, flushed: null };
  node.port.onmessage = (e) => {
    if (e.data === 'flushed') { if (t.flushed) t.flushed(); return; }
    const s = e.data;
    let sum = 0, clip = 0;
    for (let i = 0; i < s.length; i++) { const v = s[i]; sum += v * v; if (v > 0.985 || v < -0.985) clip++; }
    const st = stats[name]; st.sum += sum; st.n += s.length; st.clip += clip;
    if (!paused) nova.send('rec:chunk', name, s);
  };
  tracks[name] = t;
}

async function start(opts) {
  await stop(true);
  paused = false; sysEnded = false;
  ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'playback' });
  await ctx.audioWorklet.addModule(workletUrl);

  const micConstraints = { echoCancellation: true, noiseSuppression: !!opts.noise, autoGainControl: true, channelCount: 1 };
  if (opts.micId && opts.micId !== 'default') micConstraints.deviceId = { exact: opts.micId };
  const mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints, video: false });
  streams.push(mic);
  await addTrack('mic', mic, opts.gain || 1);

  let warning = '';
  if (opts.sysAudio) {
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      ds.getVideoTracks().forEach((t) => t.stop());
      const a = ds.getAudioTracks();
      if (!a.length) warning = 'No meeting audio';
      else {
        const sys = new MediaStream(a);
        a[0].addEventListener('ended', () => { sysEnded = true; });
        streams.push(sys);
        await addTrack('sys', sys, 1);
      }
    } catch (e) {
      warning = 'No meeting audio';
      console.warn('System audio unavailable', e);
    }
  }
  if (ctx.state !== 'running') await ctx.resume();
  levelTimer = setInterval(() => {
    const lv = (k) => (stats[k].n ? Math.sqrt(stats[k].sum / stats[k].n) : 0);
    nova.send('rec:levels', { mic: lv('mic'), sys: tracks.sys ? lv('sys') : 0, clip: stats.mic.n ? stats.mic.clip / stats.mic.n : 0, sysEnded });
    for (const k of ['mic', 'sys']) stats[k] = { sum: 0, n: 0, clip: 0 };
  }, 1000);
  return { warning };
}

async function stop(silent) {
  clearInterval(levelTimer); levelTimer = null;
  const waits = Object.values(tracks).map((t) => new Promise((res) => { t.flushed = res; t.node.port.postMessage('flush'); setTimeout(res, 1500); }));
  await Promise.all(waits);
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = []; tracks = {};
  if (ctx) { try { await ctx.close(); } catch (e) { /* ignore */ } ctx = null; }
  if (!silent) reply('rec:stopped');
}

nova.on('rec:start', async (opts) => {
  try { reply('rec:started', await start(opts || {})); }
  catch (e) {
    const msg = e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow NovaMeet to use the microphone in your system settings.'
      : e && e.name === 'NotFoundError' ? 'No microphone was found.' : String(e && e.message || e);
    await stop(true);
    reply('rec:started', { error: msg });
  }
});
nova.on('rec:stop', () => stop(false));
nova.on('rec:pause', (p) => { paused = !!p; });
