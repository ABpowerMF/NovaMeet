import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { nova, Icon, PlayIcon, Switch, Modal, fmt, durLabel, dayLabel, timeLabel, initials, avClass, speakerOrder, useNova, useOutside, STATUS, SEV, CATEGORIES } from '../lib';

const TABS = [['overview', 'Overview'], ['transcript', 'Full transcript'], ['summary', 'Summary'], ['decisions', 'Decisions'], ['actions', 'Action items'], ['warnings', 'Warnings'], ['people', 'Participants'], ['timeline', 'Timeline']];

export default function Report({ route, setRoute, go, say, settings, models, st }) {
  const id = route.id;
  const [m, setM] = useState(null);
  const [tab, setTab] = useState(route.tab || 'overview');
  const [hl, setHl] = useState(route.hl || null);
  const [tq, setTq] = useState('');
  const [spk, setSpk] = useState('all');
  const [hideSmall, setHideSmall] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [title, setTitle] = useState('');
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const aMeet = useRef(null), aMic = useRef(null);

  const load = useCallback(() => nova.invoke('meetings:get', id).then((x) => { setM(x); if (x) setTitle(x.title); }), [id]);
  useEffect(() => { load(); }, [load]);
  useNova('meetings-changed', load, [load]);
  useEffect(() => { setTab(route.tab || 'overview'); setHl(route.hl || null); }, [route.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to a transcript moment.
  useEffect(() => {
    if (tab !== 'transcript' || !hl || !m) return;
    const line = (m.lines || []).find((l) => l.id === hl);
    if (line) seek(line.start, false);
    const tm = setTimeout(() => { const el = document.getElementById('line-' + hl); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
    return () => clearTimeout(tm);
  }, [tab, hl, m && m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const el = document.getElementById('nm-main'); if (el && !(tab === 'transcript' && hl)) el.scrollTop = 0; }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = (line) => { if (!line) return; setTab('transcript'); setHl(line); setTq(''); setSpk('all'); setHideSmall(false); setExportOpen(false); };

  // ----- audio
  const audioOk = m && m.audio !== false;
  function seek(sec, play) {
    for (const a of [aMeet.current, aMic.current]) if (a) { try { a.currentTime = sec; } catch (e) { /* not loaded */ } }
    setT(sec);
    if (play) startPlay();
  }
  function startPlay() { for (const a of [aMeet.current, aMic.current]) if (a) a.play().catch(() => {}); setPlaying(true); }
  function stopPlay() { for (const a of [aMeet.current, aMic.current]) if (a) a.pause(); setPlaying(false); }

  if (!m) return <div className="page"><div className="faint">Loading…</div></div>;

  const r = m.report;
  const names = m.speakers || {};
  const order = speakerOrder(names);
  const nameOf = (s) => names[s] || s;
  const lineById = {}; for (const l of m.lines || []) lineById[l.id] = l;
  const tOf = (lid) => (lineById[lid] ? fmt(lineById[lid].start) : '');
  const total = m.lines && m.lines.length ? m.lines[m.lines.length - 1].end : m.duration || 1;
  const small = new Set(r ? r.smallTalk || [] : []);
  const status = STATUS[m.status] || STATUS.done;
  const hasReportModel = models.some((x) => x.kind === 'report' && x.installed) || (settings.report.type === 'ollama' && settings.report.ollamaModel);
  const processing = m.status === 'processing';

  async function saveReport(next) { const x = await nova.invoke('meetings:update', id, { report: next }); setM(x); }
  async function toggleAction(aid) {
    const next = Object.assign({}, r, { actions: r.actions.map((a) => (a.id === aid ? Object.assign({}, a, { done: !a.done }) : a)) });
    await saveReport(next);
    const a = next.actions.find((x) => x.id === aid);
    if (a.done) say(`Marked “${a.title}” as complete`);
  }
  async function renameSpeaker(sid, newName) {
    newName = newName.trim();
    const old = names[sid];
    if (!newName || newName === old) return;
    const speakers = Object.assign({}, names, { [sid]: newName });
    const patch = { speakers };
    if (r && old) {
      const re = new RegExp('\\b' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      patch.report = JSON.parse(JSON.stringify(r), (k, v) => (typeof v === 'string' && k !== 'line' && k !== 'id' ? v.replace(re, newName) : v));
    }
    setM(await nova.invoke('meetings:update', id, patch));
    say(`Renamed ${old} to ${newName}`);
  }
  async function saveTitle() { if (title.trim() && title !== m.title) setM(await nova.invoke('meetings:update', id, { title: title.trim() })); }
  async function reprocess(what) {
    setMenu(false);
    const res = await nova.invoke('meetings:reprocess', id, what);
    if (!res.ok) say('Another meeting is being processed — try again in a moment', 'error');
    else say(what === 'transcript' ? 'Transcribing again…' : 'Generating a new report…');
  }

  const counts = {
    transcript: (m.lines || []).length, decisions: r ? r.decisions.length : 0, actions: r ? r.actions.length : 0,
    warnings: r ? r.warnings.length + r.unresolved.length : 0, people: Object.keys(names).length
  };
  const openActions = r ? r.actions.filter((a) => !a.done) : [];
  const doneActions = r ? r.actions.filter((a) => a.done) : [];

  // ----- participants
  const people = Object.keys(names).map((sid) => {
    const ls = (m.lines || []).filter((l) => l.speaker === sid);
    const talk = ls.reduce((n, l) => n + (l.end - l.start), 0);
    const nm = names[sid];
    const first = nm.split(' ')[0].toLowerCase();
    return {
      sid, name: nm, av: avClass(sid, order), init: sid === 'unknown' ? '?' : initials(nm), talk, turns: ls.length,
      acts: r ? r.actions.filter((a) => a.owner && a.owner.toLowerCase().includes(first)).length : 0,
      decs: r ? r.decisions.filter((d) => d.by && d.by.toLowerCase().includes(first)).length : 0
    };
  });
  const talkTotal = Math.max(1, people.reduce((n, p) => n + p.talk, 0));

  // ----- transcript
  const lq = tq.trim().toLowerCase();
  const lines = (m.lines || []).filter((l) => (!hideSmall || !small.has(l.id)) && (spk === 'all' || l.speaker === spk) && (!lq || (l.text + ' ' + nameOf(l.speaker)).toLowerCase().includes(lq)));
  const tagFor = (lid) => {
    if (!r) return null;
    if (r.warnings.some((w) => w.line === lid && w.sev === 'crit')) return ['Critical', 'chip chip-red'];
    if (r.decisions.some((d) => d.line === lid)) return ['Decision', 'chip chip-blue'];
    if (r.actions.some((a) => a.line === lid)) return ['Action item', 'chip chip-green'];
    const w = r.warnings.find((x) => x.line === lid);
    if (w) return [SEV[w.sev].kind, SEV[w.sev].chip];
    if (r.unresolved.some((u) => u.line === lid)) return ['Open question', 'chip'];
    if (r.figures.some((f) => f.line === lid)) return ['Key figure', 'chip'];
    if (small.has(lid)) return ['Small talk', 'chip'];
    return null;
  };

  // ----- timeline
  const events = !r ? [] : [].concat(
    r.decisions.map((d) => ({ line: d.line, k: 'd', label: d.title, kind: 'Decision', icon: 'check' })),
    r.actions.map((a) => ({ line: a.line, k: a.blocking && !a.due ? 'c' : 'a', label: `${a.owner ? a.owner.split(' ')[0] + ': ' : ''}${a.title}`, kind: a.blocking && !a.due ? 'Critical · action item' : 'Action item', icon: 'task' })),
    r.warnings.filter((w) => !(w.sev === 'crit' && r.actions.some((a) => a.line === w.line))).map((w) => ({ line: w.line, k: w.sev === 'crit' ? 'c' : w.sev === 'review' ? 'u' : 'w', label: w.title, kind: SEV[w.sev].kind, icon: SEV[w.sev].icon })),
    r.unresolved.map((u) => ({ line: u.line, k: 'u', label: u.title, kind: 'Open question', icon: 'help' }))
  ).filter((e) => lineById[e.line]).sort((a, b) => lineById[a.line].start - lineById[b.line].start);
  const pct = (s) => Math.min(100, Math.max(0, (s / total) * 100));

  const Finding = ({ w }) => {
    const v = SEV[w.sev] || SEV.risk;
    return (
      <button className={v.cls} onClick={() => jump(w.line)}>
        <span className={v.fi}><Icon n={v.icon} /></span>
        <span className="f-body"><span className="f-title">{w.title}</span><span className="f-detail">{w.detail}</span><span className="f-meta"><span className={v.chip}>{v.kind}</span><span className="mono">{tOf(w.line)}</span></span></span>
      </button>
    );
  };
  const ActionRow = ({ a, detail }) => (
    <div className={a.done ? 'act done' : 'act'}>
      <button className={a.done ? 'cbx on' : 'cbx'} aria-pressed={a.done} aria-label={a.done ? 'Mark incomplete' : 'Mark complete'} onClick={() => toggleAction(a.id)}><Icon n="check" /></button>
      <button className="act-main" onClick={() => jump(a.line)}>
        <span className="f-title">{a.title}</span>
        {detail && a.blocking && <span className="f-detail">Other work depends on this task.</span>}
        <span className="f-meta">
          <span className="owner"><span className={a.owner ? 'av av-2' : 'av av-u'}>{a.owner ? initials(a.owner) : '?'}</span>{a.owner || 'No owner'}</span>
          {a.done ? <span className="chip chip-green">Completed</span> : <>
            <span className={a.blocking && !a.due ? 'due red' : 'due'}><Icon n="clock" cls="ic-sm" />{a.due || 'No deadline set'}</span>
            <span className={a.blocking ? 'chip chip-red' : 'chip'}>{a.blocking ? 'Blocking' : 'Pending'}</span>
          </>}
        </span>
      </button>
      {a.line && <button className="ts" onClick={() => jump(a.line)}>{tOf(a.line)}</button>}
    </div>
  );
  const NoReport = () => (
    <div className="card pad" style={{ maxWidth: 640 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="big-ic blue"><Icon n="brain" /></span>
        <div className="stack">
          <h3 className="h3">{processing ? 'The report is being prepared…' : 'No report yet'}</h3>
          <p className="muted small">{processing ? 'This page updates on its own when it is ready.' : m.note || 'Generate a report to see decisions, action items, warnings and the timeline.'}</p>
          {!processing && <div className="row" style={{ gap: 8 }}>
            {hasReportModel ? <button className="btn btn-primary btn-sm" onClick={() => reprocess('report')}>Generate report</button> : <button className="btn btn-primary btn-sm" onClick={() => go('models')}>Install a report model</button>}
            <button className="btn btn-sm" onClick={() => setTab('transcript')}>Read the transcript</button>
          </div>}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="rp-head">
        <div><button className="btn btn-ghost btn-sm" style={{ marginLeft: -10 }} onClick={() => go('meetings')}><Icon n="chevL" cls="ic-sm" />Meetings</button></div>
        <div className="rp-tr">
          <div style={{ minWidth: 0, flex: 1 }}>
            <input className="title-input" aria-label="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
            <div className="rp-meta">
              <span><Icon n="cal" cls="ic-sm" />{dayLabel(m.startedAt)}, {timeLabel(m.startedAt)}</span>
              <span><Icon n="clock" cls="ic-sm" />{durLabel(m.duration)}</span>
              <span><Icon n="users" cls="ic-sm" />{Object.keys(names).filter((k) => k !== 'unknown').length} participant{Object.keys(names).filter((k) => k !== 'unknown').length === 1 ? '' : 's'}</span>
              {m.source && <span>{m.source}</span>}
              <select className="cat-select" aria-label="Category" value={m.category || ''} onChange={async (e) => setM(await nova.invoke('meetings:update', id, { category: e.target.value }))}>
                <option value="">No category</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className={status[1]}>{status[0]}</span>
            </div>
          </div>
          <div className="rp-actions">
            <div className="avs" aria-label="Participants">{people.slice(0, 5).map((p) => <span key={p.sid} className={p.av}>{p.init}</span>)}</div>
            <ExportButton m={m} open={exportOpen} setOpen={setExportOpen} settings={settings} say={say} />
            <MoreMenu open={menu} setOpen={setMenu} items={[
              ['refresh', 'Generate report again', () => reprocess('report'), !hasReportModel || processing],
              ['mic', 'Transcribe again', () => reprocess('transcript'), processing],
              null,
              ['trash', 'Delete meeting', () => { setMenu(false); setConfirmDel(true); }, false, true]
            ]} />
          </div>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Report sections">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab on' : 'tab'} onClick={() => { setTab(k); setHl(null); setExportOpen(false); }}>{l}{counts[k] ? <span className="count">{counts[k]}</span> : null}</button>)}
      </div>

      <div className="rp-body" key={tab}>
        {m.status === 'failed' && <div className="banner red" style={{ marginBottom: 16 }}><Icon n="alert" /><span><b>Processing failed.</b> {m.error}</span><button className="btn btn-sm grow" onClick={() => reprocess('transcript')}>Transcribe again</button></div>}
        {processing && <div className="banner" style={{ marginBottom: 16 }}><span className="spin-sm" /><span><b>Processing…</b> {st.progress ? `${st.progress.step === 'report' ? 'Writing the report' : st.progress.step === 'speakers' ? 'Identifying speakers' : 'Transcribing'} · ${st.progress.pct}%` : 'Working on it'}</span></div>}

        {tab === 'overview' && (r ? (
          <div className="ov">
            <div className="ov-a">
              <section className="card pad">
                <div className="sec-h"><span className="label">Executive summary</span>{small.size > 0 && <span className="chip grow" style={{ marginLeft: 'auto' }}>{small.size} small-talk segment{small.size > 1 ? 's' : ''} filtered</span>}</div>
                <p className="lead">{r.summary || 'No summary.'}</p>
                {r.figures.length > 0 && <div className="figs">{r.figures.map((f, i) => <button key={i} className="fig" onClick={() => jump(f.line)}><span className="fig-v">{f.v}</span><span className="fig-l">{f.l}</span><span className="fig-t">{tOf(f.line)} →</span></button>)}</div>}
              </section>
              <section className="card pad">
                <div className="sec-h"><h3 className="h3">Decisions</h3><span className="count">{r.decisions.length}</span><button className="link grow" style={{ marginLeft: 'auto' }} onClick={() => setTab('decisions')}>View all</button></div>
                {r.decisions.length === 0 && <p className="faint small">No decisions were made.</p>}
                {r.decisions.map((d) => (
                  <button key={d.id} className="find" onClick={() => jump(d.line)}>
                    <span className="fi blue"><Icon n="check" /></span>
                    <span className="f-body"><span className="f-title">{d.title}</span><span className="f-meta"><span className="chip chip-blue">Confirmed decision</span>{d.by && <span>by {d.by}</span>}</span></span>
                    <span className="ts">{tOf(d.line)}<Icon n="jump" /></span>
                  </button>
                ))}
              </section>
              <section className="card pad">
                <div className="sec-h"><h3 className="h3">Action items</h3><span className="count">{openActions.length} open</span><button className="link grow" style={{ marginLeft: 'auto' }} onClick={() => setTab('actions')}>View all</button></div>
                {openActions.length === 0 && <p className="faint small">{r.actions.length ? 'All action items are complete.' : 'No action items.'}</p>}
                {openActions.map((a) => <ActionRow key={a.id} a={a} />)}
              </section>
            </div>
            <div className="ov-b">
              <section className="card pad">
                <div className="sec-h"><h3 className="h3">Warnings</h3><span className="count">{r.warnings.length}</span></div>
                {r.warnings.length === 0 && <p className="faint small">No risks or contradictions found.</p>}
                {r.warnings.map((w) => <Finding key={w.id} w={w} />)}
              </section>
              <section className="card pad">
                <div className="sec-h"><h3 className="h3">Unresolved</h3><span className="count">{r.unresolved.length}</span></div>
                {r.unresolved.length === 0 && <p className="faint small">Nothing was left open.</p>}
                {r.unresolved.map((u) => <button key={u.id} className="find" onClick={() => jump(u.line)}><span className="fi grey"><Icon n="help" /></span><span className="f-body"><span className="f-title">{u.title}</span><span className="f-detail">{u.detail}</span></span><span className="ts">{tOf(u.line)}</span></button>)}
              </section>
              <section className="card pad">
                <div className="sec-h"><h3 className="h3">Participants</h3><button className="link grow" style={{ marginLeft: 'auto' }} onClick={() => setTab('people')}>Details</button></div>
                {people.map((p) => (
                  <div key={p.sid} className="mini-p"><span className={p.av}>{p.init}</span><span><span className="nm2" style={{ display: 'block' }}>{p.name}</span><span className="rl">{p.turns} turns</span></span><span className="tbar"><span style={{ width: Math.round((p.talk / talkTotal) * 100) + '%' }} /></span><span className="faint small mono" style={{ width: 32, textAlign: 'right' }}>{Math.round((p.talk / talkTotal) * 100)}%</span></div>
                ))}
              </section>
            </div>
          </div>
        ) : <NoReport />)}

        {tab === 'transcript' && (
          <div>
            <div className="card tr-tools">
              {audioOk && (
                <div className="player">
                  <audio ref={aMeet} src={`nova-media://meeting/${m.id}/meeting.wav`} preload="metadata" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onEnded={() => setPlaying(false)} onError={() => setM(Object.assign({}, m, { audio: false }))} />
                  <audio ref={aMic} src={`nova-media://meeting/${m.id}/mic.wav`} preload="metadata" />
                  <button className="play" aria-label={playing ? 'Pause playback' : 'Play recording'} onClick={() => (playing ? stopPlay() : startPlay())}>{playing ? <Icon n="pause" /> : <PlayIcon />}</button>
                  <span className="mono small" style={{ width: 52 }}>{fmt(t)}</span>
                  <div className="scrub" role="slider" aria-label="Playback position" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)} tabIndex={0}
                    onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - b.left) / b.width) * total, playing); }}
                    onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(t + 5, playing); if (e.key === 'ArrowLeft') seek(Math.max(0, t - 5), playing); }}>
                    <span className="scrub-fill" style={{ width: pct(t) + '%' }} />
                    {events.map((e, i) => <span key={i} className={'mk ' + e.k} style={{ left: pct(lineById[e.line].start) + '%' }} />)}
                  </div>
                  <span className="mono small faint">{fmt(total)}</span>
                </div>
              )}
              {!audioOk && <div className="faint small row" style={{ gap: 8 }}><Icon n="info" cls="ic-sm" />Audio was deleted after processing (see Privacy settings).</div>}
              <div className="tr-filters">
                <label className="field"><Icon n="search" /><input aria-label="Search transcript" placeholder="Search transcript" value={tq} onChange={(e) => setTq(e.target.value)} /></label>
                {[['all', 'Everyone']].concat(Object.keys(names).map((k) => [k, /^Speaker /.test(names[k]) ? names[k] : names[k].split(' ')[0]])).map(([k, l]) => <button key={k} className={spk === k ? 'fchip on' : 'fchip'} onClick={() => setSpk(k)}>{l}</button>)}
                {small.size > 0 && <span className="row" style={{ gap: 8, marginLeft: 'auto' }}><span className="small muted">Hide small talk</span><Switch on={hideSmall} onChange={setHideSmall} label="Hide small talk" /></span>}
              </div>
            </div>
            <div className="faint small" style={{ marginTop: 14 }}>{lines.length} of {(m.lines || []).length} lines{hl && tOf(hl) ? ' · jumped to ' + tOf(hl) : ''}</div>
            <div className="lines">
              {lines.map((l) => {
                const tag = l.unclear ? ['Needs review', 'chip chip-amber'] : tagFor(l.id);
                const live = playing && t >= l.start && t < l.end;
                return (
                  <div key={l.id} id={'line-' + l.id} className={'line' + (hl === l.id || live ? ' hl' : '') + (small.has(l.id) ? ' small' : '') + (l.speaker === 'unknown' ? ' unclear' : '')}>
                    <button className="ts" onClick={() => { setHl(l.id); seek(l.start, true); }}>{fmt(l.start)}</button>
                    <div>
                      <div className="l-head"><span className={avClass(l.speaker, order)}>{l.speaker === 'unknown' ? '?' : initials(nameOf(l.speaker))}</span><span className="l-name">{nameOf(l.speaker)}</span>{tag && <span className={tag[1]}>{tag[0]}</span>}</div>
                      <p className="l-text">{l.text}</p>
                    </div>
                  </div>
                );
              })}
              {lines.length === 0 && <div className="empty">{(m.lines || []).length ? 'No lines match your search.' : processing ? 'The transcript is being prepared…' : 'No speech was detected in this recording.'}</div>}
            </div>
          </div>
        )}

        {tab === 'summary' && (r ? (
          <section className="card pad" style={{ maxWidth: 860 }}>
            <div className="sec-h"><span className="label">Summary by topic</span><span className="faint small grow" style={{ marginLeft: 'auto' }}>Small talk excluded</span></div>
            {r.topics.length === 0 && <p className="lead">{r.summary}</p>}
            {r.topics.map((tp, i) => (
              <div key={i} className="topic">
                <div className="topic-t"><span className="h3">{tp.name}</span><button className="ts" onClick={() => jump(tp.line)}>{fmt(tp.start)}–{fmt(tp.end)}</button></div>
                <p className="muted selectable" style={{ lineHeight: 1.6, fontSize: 13.5 }}>{tp.summary}</p>
              </div>
            ))}
          </section>
        ) : <NoReport />)}

        {tab === 'decisions' && (r ? (
          <div style={{ maxWidth: 900 }}>
            {r.decisions.length === 0 && <div className="card empty">No decisions were made in this meeting.</div>}
            {r.decisions.map((d) => (
              <section key={d.id} className="card pad" style={{ marginBottom: 12 }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="fi blue"><Icon n="check" /></span>
                  <div style={{ flex: 1, minWidth: 0 }} className="stack">
                    <div className="row wrap" style={{ gap: 8 }}><span className="f-title" style={{ fontSize: 15 }}>{d.title}</span><span className="chip chip-blue">Confirmed</span></div>
                    {d.detail && <p className="muted" style={{ fontSize: 13 }}>{d.detail}</p>}
                    {lineById[d.line] && <div className="quote">“{lineById[d.line].text}” — {nameOf(lineById[d.line].speaker)}</div>}
                    {d.by && <div className="f-meta" style={{ marginTop: 0 }}><span>Decided by {d.by}</span></div>}
                  </div>
                  <button className="ts" onClick={() => jump(d.line)}>{tOf(d.line)}<Icon n="jump" /></button>
                </div>
              </section>
            ))}
          </div>
        ) : <NoReport />)}

        {tab === 'actions' && (r ? (
          <div style={{ maxWidth: 900 }}>
            <div className="grp-h"><span className="label">Pending</span><span className="count">{openActions.length}</span></div>
            {openActions.map((a) => <ActionRow key={a.id} a={a} detail />)}
            {openActions.length === 0 && <div className="card empty">{r.actions.length ? 'All action items are complete.' : 'No action items in this meeting.'}</div>}
            <div className="grp-h" style={{ marginTop: 24 }}><span className="label">Completed</span><span className="count">{doneActions.length}</span></div>
            {doneActions.map((a) => <ActionRow key={a.id} a={a} />)}
          </div>
        ) : <NoReport />)}

        {tab === 'warnings' && (r ? (
          <div style={{ maxWidth: 900 }}>
            {[['Critical', r.warnings.filter((w) => w.sev === 'crit')], ['Potential risks', r.warnings.filter((w) => w.sev === 'risk')], ['Contradictions', r.warnings.filter((w) => w.sev === 'conflict')], ['Needs review', r.warnings.filter((w) => w.sev === 'review')], ['Unresolved questions', r.unresolved.map((u) => ({ id: u.id, sev: 'open', title: u.title, detail: u.detail, line: u.line }))]]
              .filter(([, items]) => items.length).map(([label, items]) => (
                <div key={label}>
                  <div className="grp-h"><span className="label">{label}</span><span className="count">{items.length}</span></div>
                  {items.map((w) => <Finding key={w.id} w={w} />)}
                </div>
              ))}
            {counts.warnings === 0 && <div className="card empty">No warnings — nothing risky, contradictory or unresolved was found.</div>}
          </div>
        ) : <NoReport />)}

        {tab === 'people' && (
          <div className="pgrid">
            {people.map((p) => (
              <section key={p.sid} className="card pcard" style={p.sid === 'unknown' ? { borderColor: 'var(--amber-line)' } : undefined}>
                <div className="row"><span className={p.av + ' lg'}>{p.init}</span><div style={{ flex: 1, minWidth: 0 }}>
                  {p.sid === 'unknown' ? <div className="f-title">Unidentified speaker</div> : <input className="name-input" aria-label="Speaker name" defaultValue={p.name} onBlur={(e) => renameSpeaker(p.sid, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />}
                  <div className="faint small">{p.sid === 'me' ? 'You · microphone' : p.sid === 'unknown' ? 'Overlapping or unclear voices' : 'Meeting audio · click the name to rename'}</div>
                </div></div>
                <div><div className="row small" style={{ justifyContent: 'space-between', marginBottom: 6 }}><span className="muted">Talk time</span><span className="mono">{Math.round((p.talk / talkTotal) * 100)}% · {durLabel(p.talk)}</span></div><div className="tt-bar"><span style={{ width: Math.round((p.talk / talkTotal) * 100) + '%' }} /></div></div>
                <div className="pstats"><div><b>{p.acts}</b><span>Actions</span></div><div><b>{p.decs}</b><span>Decisions</span></div><div><b>{p.turns}</b><span>Turns</span></div></div>
              </section>
            ))}
            <div className="note" style={{ gridColumn: '1 / -1' }}><Icon n="info" /><span><b>Tip:</b> rename “Speaker 1”, “Speaker 2”… to real names — the report updates automatically. NovaMeet tells voices apart but doesn't know who they are.</span></div>
          </div>
        )}

        {tab === 'timeline' && (r ? (
          <div>
            <section className="card pad tl-wrap">
              <div className="sec-h" style={{ marginBottom: 4 }}><h3 className="h3">Meeting timeline</h3><div className="legend grow" style={{ marginLeft: 'auto' }}><span><span className="lg d" />Decision</span><span><span className="lg a" />Action</span><span><span className="lg w" />Risk / conflict</span><span><span className="lg c" />Critical</span><span><span className="lg u" />Open / review</span></div></div>
              <div className="label">Topics</div>
              <div className="tl-track">{r.topics.map((tp, i) => <span key={i} className={'seg-b c' + (i % 2 ? 2 : 1)} style={{ left: pct(tp.start) + '%', width: Math.max(0.5, pct(tp.end) - pct(tp.start)) + '%' }} title={tp.name}>{tp.name}</span>)}</div>
              <div className="label" style={{ marginTop: 8 }}>Findings</div>
              <div className="ev-track">{events.map((e, i) => <button key={i} className={'ev ' + e.k} style={{ left: pct(lineById[e.line].start) + '%' }} aria-label={e.label} title={e.label} onClick={() => jump(e.line)}><Icon n={e.icon} /></button>)}</div>
              <div className="ticks">{[0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => <span key={f}>{fmt(total * f)}</span>)}</div>
            </section>
            <section className="card" style={{ marginTop: 16, padding: 6 }}>
              {events.length === 0 && <div className="empty">No findings to show.</div>}
              {events.map((e, i) => <button key={i} className="res" onClick={() => jump(e.line)}><span className="ts">{tOf(e.line)}</span><span className="f-body"><span className="f-title">{e.label}</span><span className="f-detail">{e.kind}</span></span></button>)}
            </section>
          </div>
        ) : <NoReport />)}
      </div>

      {confirmDel && (
        <Modal label="Delete meeting" onClose={() => setConfirmDel(false)}>
          <div className="m-body"><span className="big-ic red"><Icon n="trash" /></span><div><h2 className="h2">Delete this meeting?</h2><p className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>The recording, transcript and report are removed from this computer. Files you exported are not affected. This can't be undone.</p></div></div>
          <div className="m-foot"><button className="btn" onClick={() => setConfirmDel(false)}>Cancel</button><button className="btn btn-danger" onClick={async () => { await nova.invoke('meetings:delete', id); say('Meeting deleted'); go('meetings'); }}>Delete meeting</button></div>
        </Modal>
      )}
    </div>
  );
}

function MoreMenu({ open, setOpen, items }) {
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn icon-btn" aria-label="More actions" aria-expanded={open} onClick={() => setOpen(!open)}><Icon n="dots" /></button>
      {open && <div className="menu" role="menu">{items.map((it, i) => (it ? <button key={i} role="menuitem" className={it[4] ? 'danger' : ''} disabled={it[3]} style={it[3] ? { opacity: 0.45, cursor: 'not-allowed' } : undefined} onClick={it[3] ? undefined : it[2]}><Icon n={it[0]} />{it[1]}</button> : <hr key={i} />))}</div>}
    </div>
  );
}

function ExportButton({ m, open, setOpen, settings, say }) {
  const ref = useRef(null);
  const [content, setContent] = useState(settings.defContent || 'both');
  const [format, setFormat] = useState(settings.defFormat === 'gdocs' ? 'pdf' : settings.defFormat || 'pdf');
  const [busy, setBusy] = useState(false);
  useOutside(ref, () => setOpen(false), open);
  const folder = settings.savePath || 'Documents/NovaMeet';
  async function run(ask) {
    setBusy(true);
    try {
      const file = await nova.invoke('export', m.id, format, m.report ? content : 'transcript', { ask });
      if (file) { setOpen(false); say('Exported ' + file.split(/[\\/]/).pop(), 'ok', { label: 'Show in folder', fn: () => nova.invoke('shell:show', file) }); }
    } catch (e) { say('Export failed: ' + e.message, 'error'); }
    setBusy(false);
  }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}><Icon n="download" />Export<Icon n="chevD" cls="ic-sm" /></button>
      {open && (
        <div className="pop" role="dialog" aria-label="Export meeting">
          <div className="label">Include</div>
          <div className="stack" style={{ gap: 4 }}>
            {[['report', 'Structured report', 'Decisions, actions, warnings, summary'], ['transcript', 'Full transcript', 'Every line with speakers and timestamps'], ['both', 'Both', 'Report first, transcript as appendix']].map(([k, l, s]) => (
              <button key={k} className={'opt' + (content === k ? ' on' : '')} disabled={!m.report && k !== 'transcript'} style={!m.report && k !== 'transcript' ? { opacity: 0.45 } : undefined} onClick={() => setContent(k)}><span className="radio" /><span><span style={{ display: 'block' }}>{l}</span><span className="opt-s">{s}</span></span></button>
            ))}
          </div>
          <div className="label" style={{ marginTop: 4 }}>Format</div>
          <div className="fmts">
            <button className={'fmt' + (format === 'txt' ? ' on' : '')} onClick={() => setFormat('txt')}><Icon n="docPlain" />TXT</button>
            <button className={'fmt' + (format === 'docx' ? ' on' : '')} onClick={() => setFormat('docx')}><Icon n="doc" />DOCX</button>
            <button className={'fmt' + (format === 'pdf' ? ' on' : '')} onClick={() => setFormat('pdf')}><Icon n="pdf" />PDF</button>
            <button className="fmt soon" disabled title="Coming in a later update"><Icon n="gdoc" />Docs</button>
          </div>
          <div className="dest"><Icon n="folder" /><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Save to <b>{folder}</b></span><button className="link" onClick={() => run(true)}>Choose…</button></div>
          <div className="pop-foot"><span className="faint small">{format.toUpperCase()} · {m.report ? { report: 'Report', transcript: 'Transcript', both: 'Report + Transcript' }[content] : 'Transcript'}</span><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(false)}>{busy ? 'Exporting…' : 'Export'}</button></div>
        </div>
      )}
    </div>
  );
}
