import { useEffect, useState } from 'react';
import { nova, isMac, Icon, Wave, StopIcon, fmt, durLabel, dayLabel, daysAgo, STATUS, SEV } from '../lib';

export default function Home({ settings, st, meetings, models, startMeeting, go, openMeeting }) {
  const [attention, setAttention] = useState([]);
  const active = ['recording', 'audio', 'uncertain'].includes(st.mode);
  const kbd = isMac ? '⌘K' : 'Ctrl K';
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = settings.userName ? ', ' + settings.userName.split(' ')[0] : '';

  useEffect(() => {
    let alive = true;
    const recent = meetings.filter((m) => m.hasReport).slice(0, 8);
    Promise.all(recent.map((m) => nova.invoke('meetings:get', m.id))).then((full) => {
      if (!alive) return;
      const items = [];
      for (const m of full) {
        if (!m || !m.report) continue;
        const lineT = (id) => { const l = (m.lines || []).find((x) => x.id === id); return l ? fmt(l.start) : ''; };
        for (const w of m.report.warnings || []) if (w.sev === 'crit' || w.sev === 'conflict') items.push({ sev: w.sev === 'crit' ? 'red' : 'amber', icon: w.sev === 'crit' ? 'alert' : 'swap', title: w.title, sub: `${m.title} · ${lineT(w.line)}`, go: () => openMeeting(m.id, 'transcript', w.line), rank: w.sev === 'crit' ? 0 : 1 });
        for (const a of m.report.actions || []) if (!a.done && a.due) items.push({ sev: 'blue', icon: 'clock', title: `${a.owner ? a.owner.split(' ')[0] + ': ' : ''}${a.title}`, sub: `Action item · due ${a.due}`, go: () => openMeeting(m.id, 'transcript', a.line), rank: 2 });
        if (m.status === 'review') items.push({ sev: 'amber', icon: 'q', title: 'Segments need review', sub: m.title, go: () => openMeeting(m.id, 'warnings'), rank: 3 });
      }
      setAttention(items.sort((a, b) => a.rank - b.rank).slice(0, 4));
    });
    return () => { alive = false; };
  }, [meetings]); // eslint-disable-line react-hooks/exhaustive-deps

  const week = meetings.filter((m) => daysAgo(m.startedAt) <= 7);
  const recorded = week.reduce((n, m) => n + (m.duration || 0), 0);
  const openActions = meetings.reduce((n, m) => n + (m.openActions || 0), 0);
  const crit = meetings.reduce((n, m) => n + (m.critical || 0), 0);
  const attn = meetings.filter((m) => m.critical || m.status === 'review' || m.status === 'failed').length;
  const latest = meetings.find((m) => m.hasReport);
  const hasSpeech = models.some((m) => m.kind === 'speech' && m.installed);
  const hasReport = models.some((m) => m.kind === 'report' && m.installed) || (settings.report.type === 'ollama' && settings.report.ollamaModel);
  const recent = meetings.slice(0, 4);
  const days = [6, 5, 4, 3, 2, 1, 0].map((d) => meetings.filter((m) => Math.floor(daysAgo(m.startedAt)) === d).length);
  const maxDay = Math.max(1, ...days);

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1 className="h1">{greet}{name}</h1></div>
        <button className="searchbar" onClick={() => go('search')}><Icon n="search" /><span>Search meetings, decisions, people…</span><kbd>{kbd}</kbd></button>
      </div>

      {!hasSpeech && st.mode === 'idle' && (
        <div className="banner"><Icon n="cpu" /><span><b>Set up local AI to start.</b> Install the recommended models with one click — everything runs on this computer.</span><button className="btn btn-primary btn-sm grow" onClick={() => go('models')}>Set up</button></div>
      )}
      {hasSpeech && !hasReport && st.mode === 'idle' && (
        <div className="banner amber"><Icon n="info" /><span><b>Transcripts only.</b> Install a report model to get decisions, action items and warnings.</span><button className="btn btn-sm grow" onClick={() => go('models')}>Install</button></div>
      )}

      {st.mode === 'idle' && (
        <section className="card hero">
          <div className="hero-l">
            <div className="hero-art" aria-hidden="true"><div className="mini-notch"><i /><i /><i /></div><div className="hw" /></div>
            <div>
              <h2 className="h2">Ready when your meeting is</h2>
              <p className="muted" style={{ marginTop: 4, maxWidth: 460 }}>NovaMeet listens quietly from the notch, then prepares a full transcript and a report with only what matters.</p>
              {st.detected
                ? <div className="detect"><span className="dot green" />{st.detected.app} meeting detected{st.detected.title ? <> · <strong>{st.detected.title}</strong></> : null}</div>
                : <div className="detect"><span className="dot" />No call detected yet — you can still start manually</div>}
            </div>
          </div>
          <div className="hero-r" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
            <button className="btn btn-primary btn-lg" onClick={startMeeting}><Icon n="mic" />Start meeting</button>
            <span className="faint small">or press <kbd>{isMac ? '⌘⇧R' : 'Ctrl+Shift+R'}</kbd></span>
          </div>
        </section>
      )}

      {active && (
        <section className="card hero live">
          <div className="hero-l">
            <div className="big-ic red"><span className={st.paused ? 'rec paused' : 'rec'} /></div>
            <div>
              <div className="eyebrow" style={{ color: 'var(--red)', margin: 0 }}>{st.paused ? 'Paused' : st.audioIssue ? 'Recording · ' + st.audioIssue.toLowerCase() : 'Recording'}</div>
              <h2 className="h2">{st.title}</h2>
              <div className="faint small" style={{ marginTop: 2 }}>{st.source ? st.source + ' · ' : ''}System audio + microphone · on this device</div>
            </div>
          </div>
          <div className="live-wave"><Wave bars={24} lg paused={st.paused} dim={st.mode === 'audio'} /><span className="live-time">{fmt(st.elapsed)}</span></div>
          <div className="hero-r">
            <button className="btn" onClick={() => nova.invoke('session:pause', !st.paused)}>{st.paused ? 'Resume' : 'Pause'}</button>
            <button className="btn btn-danger" onClick={() => nova.invoke('session:end')}><StopIcon />End meeting</button>
          </div>
          <div className="live-tr">
            <div className="label">Live transcript</div>
            {(st.live || []).length === 0 && <div className="lt-line fade"><span>Listening… lines appear here a few seconds after they're spoken.</span></div>}
            {(st.live || []).map((l, i, a) => (
              <div key={i} className={'lt-line' + (i < a.length - 1 ? ' fade' : '')}><strong>{l.who}</strong><span>{l.text}{i === a.length - 1 && <span className="caret" />}</span></div>
            ))}
          </div>
        </section>
      )}

      {st.mode === 'processing' && (
        <section className="card hero">
          <div className="hero-l">
            <div className="big-ic blue"><span className="ring" /></div>
            <div style={{ flex: 1 }}>
              <h2 className="h2">Preparing your meeting report</h2>
              <p className="muted" style={{ marginTop: 4 }}>Processed on this device · you can keep working</p>
              <div className="steps">
                <Step done={st.progress && st.progress.step !== 'transcript'} active={!st.progress || st.progress.step === 'transcript'}>Transcript</Step>
                <Step done={st.progress && st.progress.step === 'report'} active={st.progress && st.progress.step === 'speakers'}>Speakers</Step>
                <Step active={st.progress && st.progress.step === 'report'}>Decisions, risks and actions{st.progress && st.progress.step === 'report' ? ` · ${st.progress.pct}%` : ''}</Step>
              </div>
              <div className="indet" />
            </div>
          </div>
          {st.progress && st.progress.step === 'report' && <div className="hero-r"><button className="btn btn-sm" onClick={() => nova.invoke('session:cancelReport')}>Skip report</button></div>}
        </section>
      )}

      {st.mode === 'completed' && (
        <section className="card hero">
          <div className="hero-l">
            <div className="big-ic green"><Icon n="check" /></div>
            <div><h2 className="h2">Meeting successfully processed</h2><p className="muted" style={{ marginTop: 4 }}>Your transcript and report are ready.</p></div>
          </div>
          <div className="hero-r"><button className="btn btn-primary" onClick={() => openMeeting(st.lastCompletedId)}>Open report</button></div>
        </section>
      )}

      <div className="stats">
        <div className="card stat"><div className="stat-l">Meetings this week</div><div className="stat-v">{week.length}</div><div className="spark" aria-hidden="true">{days.map((d, i) => <i key={i} className={i === 6 ? 'on' : ''} style={{ height: Math.max(8, (d / maxDay) * 100) + '%' }} />)}</div></div>
        <div className="card stat"><div className="stat-l">Time recorded</div><div className="stat-v">{recorded >= 3600 ? `${Math.floor(recorded / 3600)} h ${Math.round((recorded % 3600) / 60)} m` : `${Math.round(recorded / 60)} min`}</div><div className="stat-s">This week{week.length ? ` · avg. ${durLabel(recorded / week.length)}` : ''}</div></div>
        <div className="card stat"><div className="stat-l">Open action items</div><div className="stat-v">{openActions}</div><div className="stat-s">Across all meetings</div></div>
        <div className="card stat"><div className="stat-l">Needs attention</div><div className="stat-v">{attn}</div><div className={'stat-s' + (crit ? ' red' : '')}>{crit ? `${crit} critical warning${crit > 1 ? 's' : ''}` : 'Nothing critical'}</div></div>
      </div>

      <div className="split">
        <div className="a">
          <div className="sec-h"><h3 className="h3">Recent meetings</h3><button className="link grow" onClick={() => go('meetings')}>View all</button></div>
          {recent.length === 0 && <div className="card empty">Your meetings will appear here after your first recording.</div>}
          <div className="mgrid">
            {recent.map((m) => <MeetingCard key={m.id} m={m} onOpen={() => openMeeting(m.id)} />)}
          </div>
        </div>
        <div className="b stack" style={{ gap: 16 }}>
          <section className="card pad">
            <div className="sec-h"><h3 className="h3">Needs attention</h3><span className="count">{attention.length}</span></div>
            {attention.length === 0 && <p className="faint small">Nothing needs your attention.</p>}
            {attention.map((a, i) => (
              <button key={i} className="attn-row" onClick={a.go}><span className={'sev ' + a.sev}><Icon n={a.icon} /></span><span><span className="at-t" style={{ display: 'block' }}>{a.title}</span><span className="at-s" style={{ display: 'block' }}>{a.sub}</span></span></button>
            ))}
          </section>
          {latest && (
            <section className="card pad">
              <div className="sec-h"><h3 className="h3">Quick access</h3><span className="faint small grow" style={{ marginLeft: 'auto', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latest.title}</span></div>
              <div className="qa">
                <button className="qa-btn" onClick={() => openMeeting(latest.id, 'overview')}><Icon n="lines" />Overview</button>
                <button className="qa-btn" onClick={() => openMeeting(latest.id, 'transcript')}><Icon n="doc" />Transcript</button>
                <button className="qa-btn" onClick={() => openMeeting(latest.id, 'actions')}><Icon n="task" />Action items</button>
                <button className="qa-btn" onClick={() => openMeeting(latest.id, 'warnings')}><Icon n="alert" />Warnings</button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ done, active, children }) {
  return <span className={done ? 'done' : ''}>{done ? <Icon n="check" cls="ic-sm" /> : <span className={'dot' + (active ? ' blue' : '')} />}{children}</span>;
}

export function MeetingCard({ m, onOpen }) {
  const st = STATUS[m.status] || STATUS.done;
  const warn = m.critical ? [`${m.critical} critical`, 'chip chip-red'] : m.warnings ? [`${m.warnings} warning${m.warnings > 1 ? 's' : ''}`, 'chip chip-amber'] : null;
  return (
    <button className="mcard" onClick={onOpen}>
      <span className="mc-top"><span className="chip">{m.category || 'Meeting'}</span>{warn && <span className={warn[1]}><Icon n="alert" cls="ic-sm" />{warn[0]}</span>}</span>
      <span className="mc-title">{m.title}</span>
      <span className="mc-meta">
        <span><Icon n="cal" cls="ic-sm" />{dayLabel(m.startedAt)}</span>
        <span><Icon n="clock" cls="ic-sm" />{durLabel(m.duration)}</span>
        <span><Icon n="users" cls="ic-sm" />{m.people}</span>
      </span>
      <span className="mc-foot"><span className={st[1]}>{st[0]}</span><span className="mc-open">Open report<Icon n="chevR" cls="ic-sm" /></span></span>
    </button>
  );
}

export { SEV };
