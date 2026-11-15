import { useEffect, useState, useRef } from 'react';
import { nova, isMac, Icon, fmt, dayLabel, useDebounced } from '../lib';

const GROUPS = [
  ['decision', 'Decisions', 'check', 'fi blue'],
  ['action', 'Action items & deadlines', 'task', 'fi grey'],
  ['warning', 'Warnings & open questions', 'alert', 'fi amber'],
  ['transcript', 'Transcript moments', 'lines', 'fi grey'],
  ['meeting', 'Meetings', 'cal', 'fi grey']
];

export default function SearchScreen({ openMeeting }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const dq = useDebounced(q, 180);
  const input = useRef(null);
  useEffect(() => { input.current && input.current.focus(); }, []);
  useEffect(() => { if (!dq.trim()) { setRes([]); return; } nova.invoke('search', dq).then(setRes); }, [dq]);

  const groups = GROUPS.map(([k, label, icon, fi]) => ({ k, label, icon, fi, items: res.filter((r) => r.group === k).slice(0, 30) })).filter((g) => g.items.length);
  const iconFor = (g, r) => {
    if (g.k === 'warning') return r.sev === 'crit' ? ['alert', 'fi red'] : r.sev === 'conflict' ? ['swap', 'fi amber'] : r.sev === 'open' ? ['help', 'fi grey'] : ['alert', 'fi amber'];
    if (g.k === 'action' && r.blocking) return ['task', 'fi red'];
    return [g.icon, g.fi];
  };

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div><div className="eyebrow">Search</div><h1 className="h1">Find anything that was said</h1><p className="faint small" style={{ marginTop: 4 }}>Searches every transcript, decision, deadline and participant across your meetings.</p></div>
      <label className="field field-lg"><Icon n="search" cls="ic-lg" /><input ref={input} aria-label="Search everything" placeholder="Try “launch date”, a name, “budget”…" value={q} onChange={(e) => setQ(e.target.value)} /><kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd></label>
      <div className="row wrap" style={{ gap: 8 }}><span className="faint small">Suggestions</span>{['deadline', 'budget', 'decided', 'next week', 'risk'].map((s) => <button key={s} className="fchip" onClick={() => setQ(s)}>{s}</button>)}</div>
      <div className="faint small">{q.trim() ? `${res.length} result${res.length === 1 ? '' : 's'} for “${q.trim()}”` : 'Type to search across all meetings'}</div>
      {groups.map((g) => (
        <section key={g.k}>
          <div className="grp-h"><span className="label">{g.label}</span><span className="count">{g.items.length}</span></div>
          <div className="card" style={{ padding: 6 }}>
            {g.items.map((r, i) => {
              const [ic, fi] = iconFor(g, r);
              return (
                <button key={i} className="res" onClick={() => openMeeting(r.meetingId, r.line ? 'transcript' : 'overview', r.line || null)}>
                  <span className={fi}><Icon n={ic} /></span>
                  <span className="f-body"><span className="f-title">{r.text}</span><span className="f-detail">{[r.sub, g.k !== 'meeting' ? r.meetingTitle : '', dayLabel(r.date)].filter(Boolean).join(' · ')}</span></span>
                  {r.start !== undefined && <span className="ts">{fmt(r.start)}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {q.trim() && dq === q && res.length === 0 && <div className="card empty">Nothing found for “{q.trim()}”.</div>}
    </div>
  );
}
