import { useState } from 'react';
import { Icon, Seg, durLabel, dayLabel, timeLabel, daysAgo, STATUS, CATEGORIES } from '../lib';

const MODES = [['all', 'All'], ['title', 'Title'], ['participant', 'Participant'], ['keyword', 'Keyword'], ['decision', 'Decision'], ['deadline', 'Deadline']];
const PH = { all: 'Search titles, people, keywords, decisions, deadlines…', title: 'Search by meeting title…', participant: 'Search by participant…', keyword: 'Search by keyword…', decision: 'Search decisions, e.g. “launch”…', deadline: 'Search deadlines, e.g. “Friday”…' };

export default function Meetings({ meetings, startMeeting, openMeeting }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('all');
  const [date, setDate] = useState('all');
  const [cat, setCat] = useState('all');

  const used = Array.from(new Set(meetings.map((m) => m.category).filter(Boolean)));
  const cats = ['all'].concat(CATEGORIES.filter((c) => used.includes(c)), used.filter((c) => !CATEGORIES.includes(c)));
  const lq = q.trim().toLowerCase();
  const rows = meetings.filter((m) => {
    if (cat !== 'all' && m.category !== cat) return false;
    if (date !== 'all' && daysAgo(m.startedAt) > Number(date)) return false;
    if (!lq) return true;
    const f = { title: m.title, participant: m.participants, keyword: m.title + ' ' + m.keywords, decision: m.decisions, deadline: m.deadlines };
    const hay = mode === 'all' ? Object.values(f).join(' ') : f[mode];
    return String(hay || '').toLowerCase().includes(lq);
  });
  const total = meetings.reduce((n, m) => n + (m.duration || 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Library</div><h1 className="h1">Meetings</h1><div className="faint small" style={{ marginTop: 4 }}>{meetings.length} meeting{meetings.length === 1 ? '' : 's'} · {durLabel(total)} recorded · all processed on this device</div></div>
        <button className="btn btn-primary" onClick={startMeeting}><Icon n="mic" />Start meeting</button>
      </div>
      <div className="filters">
        <div className="row wrap">
          <label className="field" style={{ flex: '1 1 320px' }}><Icon n="search" /><input aria-label="Search meetings" placeholder={PH[mode]} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <Seg label="Search by" value={mode} onChange={setMode} options={MODES} />
        </div>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row wrap" style={{ gap: 8 }}>
            {cats.map((c) => <button key={c} className={'fchip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>{c === 'all' ? 'All categories' : c}</button>)}
          </div>
          <Seg label="Date" value={date} onChange={setDate} options={[['all', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days']]} />
        </div>
      </div>
      <div className="card tbl">
        <div className="t-head"><span>Meeting</span><span>Date</span><span>Duration</span><span>People</span><span>Status</span><span>Flags</span></div>
        {rows.map((r) => {
          const st = STATUS[r.status] || STATUS.done;
          const warn = r.critical ? [`${r.critical} critical`, 'chip chip-red'] : r.warnings ? [`${r.warnings} warning${r.warnings > 1 ? 's' : ''}`, 'chip chip-amber'] : null;
          return (
            <button key={r.id} className="t-row" onClick={() => openMeeting(r.id)}>
              <span style={{ minWidth: 0 }}><span className="t-title">{r.title}{r.category && <span className="chip">{r.category}</span>}</span><span className="t-sub" style={{ display: 'block' }}>{r.participants}</span></span>
              <span><span style={{ display: 'block', color: 'var(--text)' }}>{dayLabel(r.startedAt)}</span><span className="faint small">{timeLabel(r.startedAt)}</span></span>
              <span className="mono">{durLabel(r.duration)}</span>
              <span className="row" style={{ gap: 6 }}><Icon n="users" cls="ic-sm" />{r.people}</span>
              <span><span className={st[1]}>{st[0]}</span></span>
              <span>{warn ? <span className={warn[1]}>{warn[0]}</span> : <span className="faint">—</span>}</span>
            </button>
          );
        })}
        {rows.length === 0 && <div className="empty">{meetings.length ? <>No meetings match{q ? ` “${q}”` : ''}. Try another search mode or clear the filters.</> : 'No meetings yet. Start your first one from Home.'}</div>}
      </div>
    </div>
  );
}
