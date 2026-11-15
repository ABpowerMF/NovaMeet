import { useEffect, useState } from 'react';
import { nova, Icon, Switch, Seg, gb, sizeLabel, useNova } from '../lib';

const ICON = { speech: 'mic', report: 'brain', essentials: 'users' };

/** One button that installs everything needed, picked for this computer. */
export function InstallRecommended({ models, onDone }) {
  const [hw, setHw] = useState(null);
  const [started, setStarted] = useState(false);
  useEffect(() => { nova.invoke('hw:info').then(setHw); }, []);
  const ids = hw ? ['voice-essentials', 'parakeet-v3', hw.recommended] : [];
  const items = ids.map((id) => models.find((m) => m.id === id)).filter(Boolean);
  const total = items.reduce((n, m) => n + (m.installed ? 0 : m.sizeMb), 0);
  const allDone = items.length > 0 && items.every((m) => m.installed);
  const busy = items.some((m) => m.job);
  const pct = items.length ? Math.round(items.reduce((n, m) => n + (m.installed ? m.sizeMb : m.job ? (m.job.pct / 100) * m.sizeMb : 0), 0) / items.reduce((n, m) => n + m.sizeMb, 0) * 100) : 0;
  useEffect(() => { if (allDone && started && onDone) setTimeout(onDone, 900); }, [allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hw) return <div className="card pad row"><span className="spin-sm" /><span className="muted small">Checking this computer…</span></div>;
  const gpuLabel = hw.gpu.type && hw.gpu.type !== 'none' ? `${hw.gpu.name || hw.gpu.type.toUpperCase()}${hw.gpu.vramGb ? ` · ${hw.gpu.vramGb} GB` : ''}` : 'No GPU acceleration';
  return (
    <div className="card pad stack" style={{ gap: 12 }}>
      <div className="welcome-hw">
        <div>Processor<b>{hw.cores} cores</b></div>
        <div>Memory<b>{hw.ramGb} GB</b></div>
        <div>Graphics<b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={gpuLabel}>{gpuLabel}</b></div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {items.map((m) => (
          <div key={m.id} className="row small" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 8 }}>{m.installed ? <Icon n="check" cls="ic-sm" style={{ color: 'var(--green)' }} /> : m.job ? <span className="spin-sm" /> : <span className="dot" />}<span style={{ color: 'var(--text)', fontWeight: 500 }}>{m.name}</span><span className="faint">{m.role}</span></span>
            <span className="faint mono">{m.job ? `${m.job.step === 'unpack' ? 'Unpacking' : m.job.pct + '%'}` : sizeLabel(m.sizeMb)}</span>
          </div>
        ))}
      </div>
      {busy && <div className="prog"><span style={{ width: pct + '%' }} /></div>}
      {allDone
        ? <div className="note" style={{ background: 'var(--green-soft)', borderColor: 'var(--green-line)' }}><Icon n="check" style={{ color: 'var(--green)' }} /><span><b>All set.</b> Everything runs offline on this computer.</span></div>
        : <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => { setStarted(true); nova.invoke('models:installRecommended'); }}>
            <Icon n="download" />{busy ? `Installing… ${pct}%` : `Install recommended models · ${sizeLabel(total)}`}
          </button>}
    </div>
  );
}

export default function Models(props) {
  const { models, settings, saveSettings, say } = props;
  const [info, setInfo] = useState(null);
  const [hw, setHw] = useState(null);
  const [pull, setPull] = useState('');
  const refresh = () => nova.invoke('models:list').then(setInfo);
  useEffect(() => { refresh(); nova.invoke('hw:info').then(setHw); }, []);
  useNova('models', (e) => { if (e.type !== 'model-progress') refresh(); else if (e.id.startsWith('ollama:')) setInfo((i) => i && Object.assign({}, i, { pulls: Object.assign({}, i.pulls, { [e.id]: e }) })); }, []);

  const speech = models.filter((m) => m.kind === 'speech');
  const report = models.filter((m) => m.kind === 'report');
  const ess = models.find((m) => m.kind === 'essentials');
  const ollama = info && info.ollama;
  const pulls = (info && info.pulls) || {};
  const rep = settings.report || {};
  const activeReport = rep.type === 'ollama' ? 'ollama:' + rep.ollamaModel : rep.modelId;

  const gpuText = hw ? (hw.gpu.type && hw.gpu.type !== 'none' ? `${hw.gpu.name || hw.gpu.type.toUpperCase()} · ${hw.gpu.vramGb} GB ${hw.gpu.unified ? 'unified memory' : 'VRAM'} · ${hw.gpu.type.toUpperCase()} acceleration` : 'No GPU acceleration found — reports run on the processor') : '';

  const Row = ({ m, active, onPick, pickLabel }) => {
    const fits = !hw || m.kind !== 'report' || !m.minMemoryGb || (hw.gpu.unified ? hw.ramGb * 0.7 : Math.max(hw.gpu.vramGb, hw.ramGb * 0.5)) >= m.minMemoryGb;
    const rec = hw && hw.recommended === m.id;
    return (
      <div className="model">
        {onPick && <button className={'radio-pick' + (active && m.installed ? ' on' : '')} disabled={!m.installed} aria-label={pickLabel} title={m.installed ? pickLabel : 'Install first'} onClick={onPick} />}
        <span className="m-ic"><Icon n={ICON[m.kind]} cls="ic-lg" /></span>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div className="m-name">{m.name}<span className="chip">{m.languages || m.role}</span>{(m.badge || rec) && <span className="chip chip-blue">{rec ? 'Best for this computer' : m.badge}</span>}{active && m.installed && <span className="chip chip-green">In use</span>}</div>
          <div className="m-desc">{m.desc}</div>
        </div>
        {m.kind === 'report' && <span className={fits ? 'chip chip-green' : 'chip chip-amber'}>{fits ? 'Runs well' : 'May be slow'}</span>}
        <span className="m-size">{sizeLabel(m.sizeMb)}</span>
        <span className="m-act">
          {m.job ? (
            <span className="m-job"><span className="row" style={{ gap: 6 }}><span className="faint small mono">{m.job.step === 'unpack' ? 'Unpacking…' : `${m.job.pct}%`}</span><button className="btn btn-ghost btn-sm icon-btn" aria-label="Cancel" onClick={() => nova.invoke('models:cancel', m.id)}><Icon n="x" cls="ic-sm" /></button></span><span className="prog-inline"><span style={{ width: m.job.pct + '%' }} /></span></span>
          ) : m.installed ? (
            <span className="row" style={{ gap: 6 }}><span className="chip chip-green">Installed</span>{m.kind !== 'essentials' && <button className="btn btn-ghost btn-sm icon-btn" aria-label={'Remove ' + m.name} onClick={async () => { await nova.invoke('models:remove', m.id); say(`${m.name} removed — ${sizeLabel(m.sizeMb)} freed`); }}><Icon n="trash" cls="ic-sm" /></button>}</span>
          ) : (
            <button className="btn btn-sm" onClick={() => { nova.invoke('models:install', m.id); if (onPick && !models.some((x) => x.kind === m.kind && x.installed)) onPick(); }}><Icon n="download" cls="ic-sm" />Install</button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Workspace</div><h1 className="h1">AI Models</h1><p className="faint small" style={{ marginTop: 4 }}>Every model runs on this computer. Install with one click — no account, no cloud.</p></div>
      </div>

      <div className="pmode">
        <button className="pm on"><span className="pm-t"><Icon n="laptop" />On this device<span className="chip chip-green" style={{ marginLeft: 'auto' }}>Active</span></span><span className="pm-d">Audio, transcripts and reports never leave your computer.</span></button>
        <button className="pm" disabled><span className="pm-t"><Icon n="shield" />Hybrid<span className="chip" style={{ marginLeft: 'auto' }}>Coming soon</span></span><span className="pm-d">Transcription stays local; only the text goes to the cloud for the report.</span></button>
        <button className="pm" disabled><span className="pm-t"><Icon n="cloud" />Cloud<span className="chip" style={{ marginLeft: 'auto' }}>Coming soon</span></span><span className="pm-d">Encrypted processing for computers that can't run models.</span></button>
      </div>

      <div className="hw">
        <section className="card pad">
          <div className="sec-h"><span className="label">This computer</span>{hw && <span className="chip chip-green grow" style={{ marginLeft: 'auto' }}><Icon n="check" cls="ic-sm" />Compatible</span>}</div>
          {hw ? <><div className="f-title">{hw.os} · {hw.cpu}</div><div className="stack small muted" style={{ marginTop: 8, gap: 4 }}><span>{hw.ramGb} GB memory · {hw.cores} cores</span><span>{gpuText}</span></div></> : <div className="row"><span className="spin-sm" /><span className="muted small">Checking hardware…</span></div>}
        </section>
        <section className="card pad">
          <div className="sec-h"><span className="label">Disk space</span>{info && <span className="faint small grow mono" style={{ marginLeft: 'auto' }}>{gb(info.disk)} used by models</span>}</div>
          {info && <><div className="bar" style={{ margin: '6px 0 10px', height: 8 }}><span style={{ width: Math.max(2, Math.min(100, (info.disk / Math.max(1, info.disk + info.free)) * 100)) + '%' }} /></div><div className="small muted">{gb(info.free)} free</div></>}
        </section>
      </div>

      {!speech.some((m) => m.installed) && <InstallRecommended {...props} />}

      <section className="card pad">
        <div className="sec-h"><h3 className="h3">Speech to text</h3><span className="faint small grow" style={{ marginLeft: 'auto' }}>Pick the one to use</span></div>
        {speech.map((m) => <Row key={m.id} m={m} active={settings.speechModel === m.id} pickLabel={'Use ' + m.name} onPick={() => saveSettings({ speechModel: m.id })} />)}
        {ess && <Row m={ess} />}
      </section>

      <section className="card pad">
        <div className="sec-h"><h3 className="h3">Report writer</h3><span className="faint small grow" style={{ marginLeft: 'auto' }}>Finds decisions, actions, risks and contradictions</span></div>
        {report.map((m) => <Row key={m.id} m={m} active={activeReport === m.id} pickLabel={'Use ' + m.name} onPick={() => saveSettings({ report: Object.assign({}, rep, { type: 'llama', modelId: m.id }) })} />)}
      </section>

      <section className="card pad">
        <div className="sec-h">
          <h3 className="h3">Ollama</h3>
          <span className={ollama && ollama.running ? 'chip chip-green' : 'chip'}>{!info ? 'Checking…' : ollama.running ? 'Connected' : 'Not running'}</span>
          <button className="btn btn-ghost btn-sm grow" style={{ marginLeft: 'auto' }} onClick={refresh}><Icon n="refresh" cls="ic-sm" />Refresh</button>
        </div>
        {info && !ollama.running && <p className="muted small">Already use Ollama? Start it and NovaMeet can write reports with any of your Ollama models. <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Get Ollama</a></p>}
        {info && ollama.running && (
          <>
            {ollama.models.length === 0 && <p className="faint small" style={{ marginBottom: 10 }}>No models in Ollama yet.</p>}
            {ollama.models.map((om) => {
              const idv = 'ollama:' + om.name;
              return (
                <div key={om.name} className="model">
                  <button className={'radio-pick' + (activeReport === idv ? ' on' : '')} aria-label={'Use ' + om.name} onClick={() => saveSettings({ report: Object.assign({}, rep, { type: 'ollama', ollamaModel: om.name }) })} />
                  <span className="m-ic"><Icon n="brain" cls="ic-lg" /></span>
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}><div className="m-name">{om.name}{om.params && <span className="chip">{om.params}</span>}{activeReport === idv && <span className="chip chip-green">In use</span>}</div><div className="m-desc">{om.family || 'Ollama model'}</div></div>
                  <span className="m-size">{gb(om.size)}</span>
                  <span className="m-act" />
                </div>
              );
            })}
            <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
              <span className="small muted">One-click download:</span>
              {(info.suggestedOllama || []).filter((n) => !ollama.models.some((x) => x.name === n || x.name === n + ':latest')).map((n) => {
                const p = pulls['ollama:' + n];
                return <button key={n} className="fchip" disabled={!!p && p.step !== 'done'} onClick={() => nova.invoke('ollama:pull', n)}>{p && p.step !== 'done' ? `${n} · ${p.pct || 0}%` : <><Icon n="download" cls="ic-sm" />{n}</>}</button>;
              })}
              <label className="field" style={{ height: 32, flex: '0 1 220px' }}><input placeholder="Any model, e.g. mistral" value={pull} onChange={(e) => setPull(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pull.trim()) { nova.invoke('ollama:pull', pull.trim()); setPull(''); } }} /></label>
            </div>
          </>
        )}
      </section>

      <section className="card pad">
        <div className="sec-h"><h3 className="h3">Languages</h3></div>
        <div className="set-row"><div><div className="sr-t">Meeting language</div><div className="sr-d">Parakeet detects the language on its own. For Whisper you can force one language.</div></div>
          <select className="select" aria-label="Meeting language" value={settings.language || ''} onChange={(e) => saveSettings({ language: e.target.value })}>
            <option value="">Detect automatically</option>
            {[['en', 'English'], ['pt', 'Portuguese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['nl', 'Dutch'], ['pl', 'Polish']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="set-row"><div><div className="sr-t">Multilingual meetings</div><div className="sr-d">Each sentence is transcribed in the language it was spoken in.</div></div><Switch on={!settings.language} label="Multilingual meetings" onChange={(v) => saveSettings({ language: v ? '' : 'en' })} /></div>
      </section>
    </div>
  );
}

export { Seg };
