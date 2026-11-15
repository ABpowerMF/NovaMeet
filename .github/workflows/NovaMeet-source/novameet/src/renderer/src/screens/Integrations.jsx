import { nova, Icon, Switch, Seg } from '../lib';

export default function Integrations({ settings, saveSettings, boot }) {
  const folder = settings.savePath || boot.paths.defaultSave;
  const fmt = settings.defFormat === 'gdocs' ? 'pdf' : settings.defFormat;
  const tile = (k, label, ext, icon) => (
    <button className={'fmt' + (fmt === k ? ' on' : '')} style={{ padding: 16 }} onClick={() => saveSettings({ defFormat: k })}><Icon n={icon} />{label}<span className="opt-s" style={{ fontWeight: 400 }}>{ext}</span></button>
  );
  return (
    <div className="page">
      <div><div className="eyebrow">Workspace</div><h1 className="h1">Integrations &amp; export</h1><p className="faint small" style={{ marginTop: 4 }}>Decide where finished transcripts and reports go.</p></div>
      <div className="split">
        <section className="card pad a">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="big-ic blue"><Icon n="gdoc" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}><h3 className="h3">Google Docs</h3><span className="chip">Coming soon</span></div>
              <p className="muted small" style={{ marginTop: 4 }}>Create a formatted Google Doc for each meeting, in a folder you choose. NovaMeet will only be able to access the documents it creates.</p>
              <p className="faint small" style={{ marginTop: 8 }}>Until then, export as DOCX and drop it into Google Drive — it opens in Google Docs with formatting intact.</p>
            </div>
          </div>
        </section>
        <section className="card pad b">
          <div className="sec-h"><h3 className="h3">Automatic saving</h3></div>
          <div className="set-row"><div><div className="sr-t">Save reports automatically</div><div className="sr-d">After every meeting, in your default format.</div></div><Switch on={settings.autoSave} label="Save reports automatically" onChange={(v) => saveSettings({ autoSave: v })} /></div>
          <div className="set-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
            <div className="sr-t">Export folder</div>
            <div className="dest" style={{ width: '100%' }}><Icon n="folder" /><b className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder}</b>
              <button className="link" onClick={async () => { const p = await nova.invoke('dialog:folder', folder); if (p) saveSettings({ savePath: p }); }}>Change</button>
              <button className="link" onClick={() => nova.invoke('shell:open', folder)}>Open</button>
            </div>
          </div>
          <div className="set-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}><div className="sr-t">File name</div><div className="quote mono" style={{ width: '100%', padding: '8px 12px' }}>2026-11-09 · Project Phoenix — Weekly Meeting · Report.{fmt}</div></div>
        </section>
      </div>
      <section className="card pad">
        <div className="sec-h"><h3 className="h3">Default export format</h3></div>
        <div className="fmts" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {tile('txt', 'Plain text', '.txt', 'docPlain')}
          {tile('docx', 'Word', '.docx', 'doc')}
          {tile('pdf', 'PDF', '.pdf', 'pdf')}
          <button className="fmt soon" style={{ padding: 16 }} disabled><Icon n="gdoc" />Google Docs<span className="opt-s" style={{ fontWeight: 400 }}>Coming soon</span></button>
        </div>
        <div className="set-row" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div><div className="sr-t">Content to export</div><div className="sr-d">What goes into the file by default.</div></div>
          <Seg label="Content" value={settings.defContent} onChange={(v) => saveSettings({ defContent: v })} options={[['report', 'Report'], ['transcript', 'Transcript'], ['both', 'Both']]} />
        </div>
      </section>
    </div>
  );
}
