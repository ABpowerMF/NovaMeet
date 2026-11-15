import { useEffect, useState, useCallback } from 'react';
import { nova, isMac, Icon, Logo, Modal, Switch, useNova, gb } from './lib';
import Home from './screens/Home';
import Meetings from './screens/Meetings';
import SearchScreen from './screens/Search';
import Report from './screens/Report';
import Models, { InstallRecommended } from './screens/Models';
import Integrations from './screens/Integrations';
import Settings from './screens/Settings';

export default function App() {
  const [boot, setBoot] = useState(null);
  const [settings, setSettings] = useState(null);
  const [st, setSt] = useState({ mode: 'idle', elapsed: 0, live: [] });
  const [meetings, setMeetings] = useState([]);
  const [modelList, setModelList] = useState([]);
  const [route, setRoute] = useState({ screen: 'home' });
  const [toast, setToast] = useState(null);
  const [consent, setConsent] = useState(false);
  const [needModel, setNeedModel] = useState(null);
  const [onboard, setOnboard] = useState(false);

  const refreshMeetings = useCallback(() => nova.invoke('meetings:list').then(setMeetings), []);
  const refreshModels = useCallback(() => nova.invoke('models:list').then((r) => setModelList(r.models)), []);

  useEffect(() => {
    nova.invoke('app:init').then((b) => {
      setBoot(b); setSettings(b.settings); setSt(b.state); setMeetings(b.meetings); setModelList(b.models);
      if (!b.settings.onboarded) setOnboard(true);
    });
  }, []);

  useNova('state', setSt);
  useNova('settings', setSettings);
  useNova('meetings-changed', refreshMeetings);
  useNova('models', (e) => {
    if (e.type === 'model-progress') setModelList((l) => l.map((m) => (m.id === e.id ? Object.assign({}, m, { job: { step: e.step, pct: e.pct, bytes: e.bytes, total: e.total } }) : m)));
    else { refreshModels(); if (e.type === 'model-error') say(e.message, 'error'); if (e.type === 'model-installed' && !e.id.startsWith('ollama:')) say('Model installed and ready'); }
  });
  useNova('toast', (t) => say(t.text, t.kind));
  useNova('navigate', (r) => {
    if (r.consent) setConsent(true);
    else if (r.startError) handleStartError(r.startError);
    else setRoute(r);
  });

  const say = useCallback((text, kind, action) => {
    setToast({ text, kind, action, id: Math.random() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.action ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const saveSettings = useCallback((patch) => nova.invoke('settings:set', patch).then(setSettings), []);

  function handleStartError(r) {
    if (r.reason === 'no-speech-model') setNeedModel(true);
    else if (r.reason === 'audio') say(r.message || 'Could not access audio', 'error');
    else if (r.reason === 'engine') say('Speech engine failed to start: ' + r.message, 'error');
  }
  async function begin() {
    setConsent(false);
    const r = await nova.invoke('session:start', {});
    if (!r.ok) handleStartError(r);
    else say('Recording started — NovaMeet is listening');
  }
  const startMeeting = () => {
    if (!modelList.some((m) => m.kind === 'speech' && m.installed)) { setNeedModel(true); return; }
    if (settings.consentRemind) setConsent(true); else begin();
  };

  const go = (screen, extra) => setRoute(Object.assign({ screen }, extra || {}));
  const openMeeting = (id, tab, hl) => setRoute({ screen: 'report', id, tab: tab || 'overview', hl: hl || null, nonce: Math.random() });

  if (!boot || !settings) return <div className="nm th-light" />;

  const active = ['recording', 'audio', 'uncertain'].includes(st.mode);
  const ctx = { settings, saveSettings, st, meetings, models: modelList, refreshModels, say, go, openMeeting, startMeeting, boot, route, setRoute };
  const navOn = (k) => (route.screen === k || (k === 'meetings' && route.screen === 'report') ? 'nav on' : 'nav');
  const kbd = isMac ? '⌘K' : 'Ctrl K';
  const speech = modelList.find((m) => m.id === settings.speechModel && m.installed) || modelList.find((m) => m.kind === 'speech' && m.installed);
  const used = meetings.reduce((n, m) => n + (m.duration || 0), 0);

  return (
    <div className={`nm th-${settings.theme} os-${isMac ? 'mac' : 'win'}`} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); go('search'); } }}>
      <div className="shell-tb">
        <div className="tb-title"><Logo size={18} />NovaMeet</div>
      </div>
      <div className="app-root" style={{ flex: 1, minHeight: 0 }}>
        <div className="wbody">
          <nav className="side" aria-label="Main">
            <div className="brand">
              <Logo />
              <div><div className="brand-name">NovaMeet</div><div className="brand-tag">Listen. Understand. Organize.</div></div>
            </div>
            <div className="nav-list">
              <button className={navOn('home')} onClick={() => go('home')}><Icon n="home" />Home</button>
              <button className={navOn('meetings')} onClick={() => go('meetings')}><Icon n="cal" />Meetings</button>
              <button className={navOn('search')} onClick={() => go('search')}><Icon n="search" />Search<kbd>{kbd}</kbd></button>
              <div className="nav-sec label">Workspace</div>
              <button className={navOn('models')} onClick={() => go('models')}><Icon n="cpu" />AI Models</button>
              <button className={navOn('integrations')} onClick={() => go('integrations')}><Icon n="plug" />Integrations</button>
              <button className={navOn('settings')} onClick={() => go('settings')}><Icon n="sliders" />Settings</button>
            </div>
            <div className="side-foot">
              <div className="sf-row"><span className={'dot ' + (active ? (st.paused ? 'amber' : 'red') : st.mode === 'processing' ? 'blue' : speech ? 'green' : 'amber')} />{active ? (st.paused ? 'Recording paused' : 'Listening') : st.mode === 'processing' ? 'Processing meeting' : speech ? 'Audio ready' : 'No speech model yet'}</div>
              <div className="sf-sub">{speech ? speech.name : 'Install one in AI Models'}</div>
              <div className="sf-row"><Icon n="drive" cls="ic-sm faint" />Storage<span className="faint" style={{ marginLeft: 'auto', fontWeight: 400 }}>{meetings.length} meetings</span></div>
              <div className="sf-sub" style={{ marginTop: -6 }}>{gb(used * 32000 * 2)} of audio · stays on this computer</div>
              <div className="sf-ver">NovaMeet {boot.version}</div>
            </div>
          </nav>
          <main className="main" id="nm-main">
            {route.screen === 'home' && <Home {...ctx} />}
            {route.screen === 'meetings' && <Meetings {...ctx} />}
            {route.screen === 'search' && <SearchScreen {...ctx} />}
            {route.screen === 'report' && <Report key={route.id} {...ctx} />}
            {route.screen === 'models' && <Models {...ctx} />}
            {route.screen === 'integrations' && <Integrations {...ctx} />}
            {route.screen === 'settings' && <Settings {...ctx} />}
          </main>
        </div>

        {consent && (
          <Modal label="Before you start recording" onClose={() => setConsent(false)}>
            <div className="m-body">
              <span className="big-ic blue"><Icon n="shield" /></span>
              <div><h2 className="h2">Before you start recording</h2><p className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>Let everyone in the call know it's being transcribed. Some regions require consent from every participant.</p></div>
              <div className="kv">
                <div><span>Meeting</span><b style={{ fontWeight: 500 }}>{st.detected ? (st.detected.title || st.detected.app) : 'Online meeting'}</b></div>
                <div><span>Source</span><span className="row" style={{ gap: 6, color: 'var(--text)' }}><span className={'dot ' + (st.detected ? 'green' : '')} />{st.detected ? st.detected.app + ' · ' : ''}system audio + microphone</span></div>
                <div><span>Processing</span><span style={{ color: 'var(--text)' }}>On this device</span></div>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Remind me before every meeting</span><Switch on={settings.consentRemind} label="Remind me before every meeting" onChange={(v) => saveSettings({ consentRemind: v })} /></div>
            </div>
            <div className="m-foot">
              <button className="btn btn-ghost grow" onClick={() => { navigator.clipboard.writeText(CONSENT_MSG); say('Consent message copied to clipboard'); }}>Copy consent message</button>
              <button className="btn" onClick={() => setConsent(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={begin}><span className="rec still" />Start recording</button>
            </div>
          </Modal>
        )}

        {needModel && (
          <Modal label="Install a speech model" onClose={() => setNeedModel(false)} width={540}>
            <div className="m-body">
              <span className="big-ic blue"><Icon n="cpu" /></span>
              <div><h2 className="h2">One click and you're ready</h2><p className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>NovaMeet transcribes on your computer, so it needs a speech model first. The recommended set installs everything in one go.</p></div>
              <InstallRecommended {...ctx} onDone={() => setNeedModel(false)} />
            </div>
            <div className="m-foot"><button className="btn btn-ghost grow" onClick={() => { setNeedModel(false); go('models'); }}>Choose models myself</button><button className="btn" onClick={() => setNeedModel(false)}>Close</button></div>
          </Modal>
        )}

        {onboard && <Onboarding {...ctx} onClose={() => { setOnboard(false); saveSettings({ onboarded: true }); }} />}

        {toast && (
          <div className="toast" role="status" key={toast.id}>
            <Icon n={toast.kind === 'error' ? 'alert' : 'check'} />{toast.text}
            {toast.action && <button className="toast-act" onClick={() => { toast.action.fn(); setToast(null); }}>{toast.action.label}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export const CONSENT_MSG = "Hi all — I'm using NovaMeet to transcribe this call so I can share notes afterwards. Let me know if you'd rather I didn't.";

function Onboarding(props) {
  const { settings, saveSettings, onClose } = props;
  const [name, setName] = useState(settings.userName || '');
  return (
    <Modal label="Welcome to NovaMeet" width={580}>
      <div className="m-body">
        <div className="row"><Logo size={44} /><div><h2 className="h2" style={{ fontSize: 20 }}>Welcome to NovaMeet</h2><p className="faint small">Listen. Understand. Organize. Everything runs on this computer.</p></div></div>
        <div>
          <label className="sr-t" htmlFor="ob-name">What should NovaMeet call you in transcripts?</label>
          <input id="ob-name" className="input-plain" style={{ marginTop: 8 }} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => saveSettings({ userName: name.trim() })} />
        </div>
        <InstallRecommended {...props} />
      </div>
      <div className="m-foot"><span className="faint small grow">You can change models any time in AI Models.</span><button className="btn btn-primary" onClick={() => { saveSettings({ userName: name.trim() }); onClose(); }}>Continue</button></div>
    </Modal>
  );
}
