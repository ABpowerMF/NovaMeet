import { useEffect, useState } from 'react';
import { nova, Icon, Switch, Seg, Modal } from '../lib';
import { CONSENT_MSG } from '../App';

export default function Settings({ settings, saveSettings, say, boot, go, st }) {
  const [tab, setTab] = useState('general');
  const [mics, setMics] = useState([]);
  const [delAll, setDelAll] = useState(false);
  const [name, setName] = useState(settings.userName || '');
  useEffect(() => {
    if (tab !== 'audio') return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return navigator.mediaDevices.enumerateDevices(); })
      .catch(() => navigator.mediaDevices.enumerateDevices())
      .then((d) => setMics(d.filter((x) => x.kind === 'audioinput')));
  }, [tab]);
  const active = ['recording', 'audio', 'uncertain'].includes(st.mode);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head"><div><div className="eyebrow">Preferences</div><h1 className="h1">Settings</h1></div>
        <Seg label="Settings section" value={tab} onChange={setTab} options={[['general', 'General'], ['audio', 'Audio'], ['privacy', 'Privacy']]} />
      </div>

      {tab === 'general' && <>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">You</h3></div>
          <div className="set-row"><div><div className="sr-t">Your name</div><div className="sr-d">Used for your lines in transcripts (your microphone).</div></div><input className="input-plain" style={{ maxWidth: 260 }} value={name} placeholder="You" onChange={(e) => setName(e.target.value)} onBlur={() => saveSettings({ userName: name.trim() })} /></div>
        </section>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Appearance</h3></div>
          <div className="set-row"><div><div className="sr-t">Theme</div><div className="sr-d">The notch is always black, so it reads as part of the screen in both themes.</div></div><Seg label="Theme" value={settings.theme} onChange={(v) => saveSettings({ theme: v })} options={[['light', 'Light'], ['dark', 'Dark']]} /></div>
        </section>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Desktop notch</h3></div>
          <div className="row wrap" style={{ gap: 22, alignItems: 'flex-start' }}>
            <div className="preview-screen" style={{ flex: '1 1 320px' }} aria-label="Notch position preview">
              <div className="ps-mbar" />
              <div className={'ps-rail pos-' + settings.notchPos} style={{ justifyContent: settings.notchPos === 'left' ? 'flex-start' : settings.notchPos === 'right' ? 'flex-end' : 'center' }}><div className="ps-notch"><i /><i /><i /></div></div>
              <div className="ps-win" />
            </div>
            <div className="stack" style={{ flex: '1 1 260px', gap: 14 }}>
              <div><div className="sr-t" style={{ marginBottom: 8 }}>Position on the top edge</div><Seg label="Notch position" value={settings.notchPos} onChange={(v) => saveSettings({ notchPos: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} /></div>
              <div><div className="sr-t" style={{ marginBottom: 8 }}>Display</div>
                <select className="select" aria-label="Display" value={settings.notchDisplay || ''} onChange={(e) => saveSettings({ notchDisplay: e.target.value || null })}>
                  <option value="">Main display</option>
                  {boot.displays.map((d) => <option key={d.id} value={d.id}>{d.label}{d.primary ? ' (main)' : ''}</option>)}
                </select>
              </div>
              <div><div className="sr-t" style={{ marginBottom: 8 }}>Show notch</div><Seg label="Show notch" value={settings.showNotch} onChange={(v) => saveSettings({ showNotch: v })} options={[['meeting', 'During meetings'], ['always', 'Always']]} /></div>
            </div>
          </div>
          <div className="set-row" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}><div><div className="sr-t">Expand on hover</div><div className="sr-d">Otherwise the notch expands only when clicked.</div></div><Switch on={settings.hoverExpand} label="Expand on hover" onChange={(v) => saveSettings({ hoverExpand: v })} /></div>
        </section>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Startup</h3></div>
          <div className="set-row"><div><div className="sr-t">Open at login</div></div><Switch on={settings.launchLogin} label="Open at login" onChange={(v) => saveSettings({ launchLogin: v })} /></div>
          <div className="set-row"><div><div className="sr-t">Detect online meetings</div><div className="sr-d">Suggest recording when a Zoom, Teams, Google Meet or Webex call is open. NovaMeet never starts recording on its own.</div></div><Switch on={settings.detect} label="Detect online meetings" onChange={(v) => saveSettings({ detect: v })} /></div>
        </section>
      </>}

      {tab === 'audio' && <>
        <div className="note"><Icon n="info" /><span><b>Built for online meetings.</b> NovaMeet records the call's system audio plus your microphone as two separate tracks, so your voice is never confused with the others.</span></div>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Sources</h3></div>
          <div className="set-row"><div><div className="sr-t">Meeting audio</div><div className="sr-d">What the other participants say — captured from your computer's sound output.</div></div><Seg label="Meeting audio" value={settings.sysAudio === 'off' ? 'off' : 'all'} onChange={(v) => saveSettings({ sysAudio: v })} options={[['all', 'System audio'], ['off', 'Off']]} /></div>
          <div className="set-row"><div><div className="sr-t">Microphone</div><div className="sr-d">What you say.</div></div>
            <select className="select" aria-label="Microphone" value={settings.micId || 'default'} onChange={(e) => saveSettings({ micId: e.target.value })}>
              {mics.length === 0 && <option value="default">Default microphone</option>}
              {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
            </select>
          </div>
          <div className="set-row" style={{ flexWrap: 'wrap' }}><div style={{ flex: '1 1 200px' }}><div className="sr-t">Microphone level</div><div className="sr-d">{settings.inputGain}% — lower it if the notch reports reduced audio quality.</div></div><input className="range" style={{ flex: '1 1 200px', maxWidth: 260 }} type="range" min="20" max="200" step="5" value={settings.inputGain} aria-label="Microphone level" onChange={(e) => saveSettings({ inputGain: Number(e.target.value) })} /></div>
        </section>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Quality &amp; recognition</h3></div>
          <div className="set-row"><div><div className="sr-t">Noise reduction</div><div className="sr-d">Filters background noise on your microphone.</div></div><Switch on={settings.noise} label="Noise reduction" onChange={(v) => saveSettings({ noise: v })} /></div>
          <div className="set-row"><div><div className="sr-t">Speaker identification</div><div className="sr-d">Tell the other participants apart (Speaker 1, Speaker 2…).</div></div><Switch on={settings.diar} label="Speaker identification" onChange={(v) => saveSettings({ diar: v })} /></div>
          <div className="set-row"><div><div className="sr-t">Other participants</div><div className="sr-d">Knowing how many people speak makes speaker identification more accurate.</div></div>
            <select className="select" style={{ minWidth: 140 }} aria-label="Other participants" value={settings.expectedSpeakers || 0} onChange={(e) => saveSettings({ expectedSpeakers: Number(e.target.value) })}>
              <option value={0}>Detect</option>{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="set-row"><div><div className="sr-t">Language</div><div className="sr-d">Detected automatically. Change it in AI Models.</div></div><button className="btn btn-sm" onClick={() => go('models')}>AI Models</button></div>
        </section>
      </>}

      {tab === 'privacy' && <>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Processing location</h3><button className="link grow" style={{ marginLeft: 'auto' }} onClick={() => go('models')}>Manage models</button></div>
          <div className="pmode">
            <button className="pm on"><span className="pm-t">On this device</span><span className="pm-d">Nothing leaves your computer.</span></button>
            <button className="pm" disabled><span className="pm-t">Hybrid<span className="chip" style={{ marginLeft: 'auto' }}>Soon</span></span><span className="pm-d">Only transcript text goes to the cloud.</span></button>
            <button className="pm" disabled><span className="pm-t">Cloud<span className="chip" style={{ marginLeft: 'auto' }}>Soon</span></span><span className="pm-d">Encrypted, deleted within 24 h.</span></button>
          </div>
        </section>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Recording &amp; consent</h3></div>
          <div className="set-row"><div><div className="sr-t">Recording indicator</div><div className="sr-d">The notch is always visible while recording. This can't be turned off.</div></div><Switch on locked label="Recording indicator (always on)" onChange={() => {}} /></div>
          <div className="set-row"><div><div className="sr-t">Consent reminder</div><div className="sr-d">Remind me to tell participants before recording starts.</div></div><Switch on={settings.consentRemind} label="Consent reminder" onChange={(v) => saveSettings({ consentRemind: v })} /></div>
          <div style={{ paddingTop: 14 }}><div className="sr-t" style={{ marginBottom: 8 }}>Consent message</div><div className="quote">“{CONSENT_MSG}”</div><button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => { navigator.clipboard.writeText(CONSENT_MSG); say('Consent message copied to clipboard'); }}>Copy message</button></div>
        </section>
        <section className="card pad">
          <div className="sec-h"><h3 className="h3">Data retention</h3></div>
          <div className="set-row"><div><div className="sr-t">Keep meetings for</div><div className="sr-d">Older meetings are deleted automatically.</div></div>
            <select className="select" aria-label="Keep meetings for" value={settings.retention} onChange={(e) => saveSettings({ retention: e.target.value })}>
              <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="forever">Forever</option>
            </select>
          </div>
          <div className="set-row"><div><div className="sr-t">Delete raw audio after processing</div><div className="sr-d">Keep only the transcript and report (playback won't be available). Saves about 115 MB per hour.</div></div><Switch on={settings.delAudio} label="Delete raw audio after processing" onChange={(v) => saveSettings({ delAudio: v })} /></div>
          <div className="set-row"><div><div className="sr-t">Where your data lives</div><div className="sr-d mono" style={{ wordBreak: 'break-all' }}>{boot.paths.data}</div></div><button className="btn btn-sm" onClick={() => nova.invoke('shell:open', boot.paths.data)}>Open folder</button></div>
        </section>
        <section className="card pad danger">
          <div className="set-row"><div><div className="sr-t" style={{ color: 'var(--red)' }}>Delete all meeting data</div><div className="sr-d">Permanently remove every recording, transcript and report from this computer.</div></div><button className="btn btn-danger" disabled={active} onClick={() => setDelAll(true)}><Icon n="trash" />Delete data…</button></div>
        </section>
      </>}

      {delAll && (
        <Modal label="Delete all meeting data" onClose={() => setDelAll(false)}>
          <div className="m-body"><span className="big-ic red"><Icon n="trash" /></span><div><h2 className="h2">Delete all meeting data?</h2><p className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>This permanently removes every meeting — recordings, transcripts and reports — from this computer. Exported files and installed models are not affected. This can't be undone.</p></div></div>
          <div className="m-foot"><button className="btn" onClick={() => setDelAll(false)}>Cancel</button><button className="btn btn-danger" onClick={async () => { await nova.invoke('meetings:deleteAll'); setDelAll(false); say('All meeting data deleted'); }}>Delete everything</button></div>
        </Modal>
      )}
    </div>
  );
}
