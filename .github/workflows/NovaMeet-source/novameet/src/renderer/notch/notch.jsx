// The desktop notch — its own transparent, always-on-top window.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './notch-base.css';
import './notch.css';

const nova = window.nova;
const isMac = nova.platform === 'darwin';

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const p = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}
const Bars = ({ n, cls }) => <span className={cls}>{Array.from({ length: n }, (_, i) => <i key={i} />)}</span>;
const Ic = ({ d, fill }) => <svg className="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d={d} fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} /></svg>;

function Notch() {
  const [st, setSt] = useState({ mode: 'idle', elapsed: 0 });
  const [settings, setSettings] = useState({ hoverExpand: false });
  const [exp, setExp] = useState(false);
  const [hover, setHover] = useState(false);
  const [tick, setTick] = useState(0);
  const leaveTimer = useRef(null);
  const base = useRef({ at: Date.now(), elapsed: 0 });

  useEffect(() => {
    nova.invoke('app:init').then((b) => { setSt(b.state); setSettings(b.settings); });
    const offs = [
      nova.on('state', (s) => { base.current = { at: Date.now(), elapsed: s.elapsed }; setSt(s); }),
      nova.on('settings', setSettings),
      nova.on('notch:toggle', () => setExp((e) => !e))
    ];
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => { offs.forEach((o) => o()); clearInterval(t); };
  }, []);

  const active = ['recording', 'audio', 'uncertain'].includes(st.mode);
  const canExpand = active || st.mode === 'idle';
  useEffect(() => { if (!canExpand) setExp(false); }, [canExpand]);
  // The window only catches the mouse over the notch itself.
  useEffect(() => { nova.invoke('notch:interactive', hover || exp); }, [hover, exp]);

  const elapsed = active && !st.paused ? base.current.elapsed + Math.floor((Date.now() - base.current.at) / 1000) : st.elapsed;
  void tick;

  function enter() {
    clearTimeout(leaveTimer.current);
    setHover(true);
    if (settings.hoverExpand && canExpand) setExp(true);
  }
  function leave() {
    setHover(false);
    if (exp) { clearTimeout(leaveTimer.current); leaveTimer.current = setTimeout(() => setExp(false), settings.hoverExpand ? 400 : 2500); }
  }
  function click() {
    if (canExpand) setExp(!exp);
    else if (st.mode === 'completed') nova.invoke('app:show', { screen: 'report', id: st.lastCompletedId, tab: 'overview', nonce: Date.now() });
    else if (st.mode === 'processing') nova.invoke('app:show', { screen: 'home' });
  }

  const mode = st.mode;
  const cls = ['notch', 'm-' + mode, exp ? 'exp' : '', exp && mode === 'idle' ? 'idle-exp' : ''].join(' ');
  const recDot = st.paused ? 'rec paused' : 'rec';
  const waveCls = 'wave' + (st.paused ? ' paused' : '') + (mode === 'audio' ? ' dim' : '');
  const aria = { idle: 'NovaMeet — ready. Click to expand', recording: `Recording ${fmt(elapsed)}`, audio: st.audioIssue || 'Audio quality reduced', uncertain: 'Speaker unclear', processing: 'Preparing your meeting report', completed: 'Meeting processed. Open report' }[mode];

  return (
    <div className={`stage os-${isMac ? 'mac' : 'win'}`}>
      <div className={cls} role="status" aria-live="polite" onMouseEnter={enter} onMouseLeave={leave}>
        {!exp && (
          <button className="n-hit" onClick={click} aria-label={aria}>
            {mode === 'idle' && (
              <span className="n-row center n-in">
                <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden="true"><circle cx="6" cy="7" r="3.2" fill={st.detected ? '#30D158' : '#3E74FF'} /><rect x="15" y="4.5" width="2.4" height="5" rx="1.2" fill="#fff" opacity=".85" /><rect x="20" y="2.5" width="2.4" height="9" rx="1.2" fill="#fff" opacity=".85" /><rect x="25" y="4" width="2.4" height="6" rx="1.2" fill="#fff" opacity=".85" /><rect x="30" y="5.5" width="2.4" height="3" rx="1.2" fill="#fff" opacity=".85" /></svg>
              </span>
            )}
            {mode === 'recording' && <span className="n-row n-in"><span className={recDot} /><Bars n={16} cls={waveCls} /><span className="n-time">{fmt(elapsed)}</span></span>}
            {mode === 'audio' && <span className="n-row n-in"><span className="n-ico amber"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 17h.01" /></svg></span><span className="n-txt">{st.audioIssue || 'Audio quality reduced'}</span><span className="n-time">{fmt(elapsed)}</span></span>}
            {mode === 'uncertain' && <span className="n-row n-in"><span className="n-ico q"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 9a2.9 2.9 0 1 1 4 2.7c-.7.3-1.2.9-1.2 1.6v.4M12 17.5h.01" /></svg></span><span className="n-txt">Speaker unclear</span><span className="n-time">{fmt(elapsed)}</span></span>}
            {mode === 'processing' && <span className="n-row center n-in"><span className="spin" /><span className="n-txt n-shimmer" style={{ flex: '0 0 auto' }}>Preparing your report</span></span>}
            {mode === 'completed' && <span className="n-row center n-in"><span className="n-ico ok"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span><span className="n-txt" style={{ flex: '0 0 auto' }}>Meeting processed</span></span>}
          </button>
        )}

        {exp && active && (
          <div className="n-panel n-in">
            <div className="np-top">
              <span className={recDot} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="np-title">{st.title}</div>
                <div className="np-sub">{st.paused ? 'Paused' : 'Recording'}{st.source ? ' · ' + st.source : ''}</div>
              </div>
              <span className="np-time">{fmt(elapsed)}</span>
              <button className="np-x" aria-label="Collapse" onClick={() => setExp(false)}><Ic d="M6 15l6-6 6 6" /></button>
            </div>
            <Bars n={48} cls={waveCls + ' lg'} />
            <div className="np-status">
              <span><span className={st.audioIssue ? 'nd amber' : 'nd'} />Audio · {st.audioIssue || 'Good'}</span>
              <span><span className="nd" />{st.source ? 'Connected' : 'System audio'}</span>
              <span>On this device</span>
              {mode === 'uncertain' && <span style={{ color: '#FFB02E' }}>Segment to review</span>}
            </div>
            <div className="np-actions">
              <button className="np-btn" onClick={() => nova.invoke('session:pause', !st.paused)}>{st.paused ? <Ic d="M8 5.5v13l11-6.5z" fill /> : <Ic d="M8 5v14M16 5v14" />}{st.paused ? 'Resume' : 'Pause'}</button>
              <button className="np-btn end" onClick={() => { setExp(false); nova.invoke('session:end'); }}><svg className="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" /></svg>End</button>
              <button className="np-btn grow" onClick={() => { setExp(false); nova.invoke('app:show', { screen: 'home' }); }}>Open NovaMeet<Ic d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></button>
            </div>
          </div>
        )}

        {exp && mode === 'idle' && (
          <div className="n-panel n-in">
            <div className="np-top">
              <span className="nd" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="np-title">NovaMeet is ready</div>
                <div className="np-sub">{st.detected ? `${st.detected.app} meeting detected${st.detected.title ? ' · ' + st.detected.title : ''}` : 'No call detected'}</div>
              </div>
              <button className="np-x" aria-label="Collapse" onClick={() => setExp(false)}><Ic d="M6 15l6-6 6 6" /></button>
            </div>
            <div className="np-actions">
              <button className="np-btn primary" onClick={() => { setExp(false); nova.invoke('notch:startFromNotch'); }}><span className="rec" style={{ animation: 'none' }} />Start recording</button>
              <button className="np-btn grow" onClick={() => { setExp(false); nova.invoke('app:show', { screen: 'home' }); }}>Open NovaMeet</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Notch />);
