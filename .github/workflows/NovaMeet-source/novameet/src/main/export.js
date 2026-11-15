// Export a meeting as TXT, DOCX or PDF — report, transcript, or both.
'use strict';

const fs = require('fs');
const path = require('path');
const { fmtTime } = require('./ai/report');

function lineIndex(m) { const map = {}; for (const l of m.lines || []) map[l.id] = l; return map; }
function ts(m, id) { const l = lineIndex(m)[id]; return l ? fmtTime(l.start) : ''; }
function nameOf(m, sp) { return (m.speakers || {})[sp] || sp; }
function dateLabel(m) { return new Date(m.startedAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }); }
function durLabel(m) { const s = Math.round(m.duration || 0); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`; }

function sections(m) {
  const r = m.report || {};
  const sev = { crit: 'Critical', risk: 'Risk', conflict: 'Contradiction', review: 'Needs review' };
  return [
    { h: 'Executive summary', p: r.summary ? [r.summary] : [] },
    { h: 'Decisions', items: (r.decisions || []).map((d) => `${d.title}${d.by ? ' — ' + d.by : ''} [${ts(m, d.line)}]`) },
    { h: 'Action items', items: (r.actions || []).map((a) => `${a.done ? '[x]' : '[ ]'} ${a.title} — ${a.owner || 'no owner'} · ${a.due || 'no deadline'} [${ts(m, a.line)}]`) },
    { h: 'Warnings', items: (r.warnings || []).map((w) => `${sev[w.sev] || w.sev}: ${w.title} — ${w.detail} [${ts(m, w.line)}]`) },
    { h: 'Unresolved questions', items: (r.unresolved || []).map((u) => `${u.title}${u.detail ? ' — ' + u.detail : ''} [${ts(m, u.line)}]`) },
    { h: 'Key figures', items: (r.figures || []).map((f) => `${f.v} — ${f.l} [${ts(m, f.line)}]`) },
    { h: 'Topics', items: (r.topics || []).map((t) => `${fmtTime(t.start)} ${t.name}: ${t.summary}`) }
  ].filter((s) => (s.p && s.p.length) || (s.items && s.items.length));
}

function transcriptRows(m) { return (m.lines || []).map((l) => ({ t: fmtTime(l.start), who: nameOf(m, l.speaker), text: l.text })); }

function toTxt(m, content) {
  const out = [m.title, `${dateLabel(m)} · ${durLabel(m)} · ${Object.values(m.speakers || {}).join(', ')}`, ''];
  if (content !== 'transcript' && m.report) {
    for (const s of sections(m)) {
      out.push(s.h.toUpperCase());
      for (const p of s.p || []) out.push(p);
      for (const i of s.items || []) out.push('• ' + i);
      out.push('');
    }
  }
  if (content !== 'report') {
    out.push('FULL TRANSCRIPT');
    for (const r of transcriptRows(m)) out.push(`[${r.t}] ${r.who}: ${r.text}`);
  }
  return out.join('\n');
}

async function toDocx(m, content) {
  const d = require('docx');
  const kids = [
    new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(m.title)] }),
    new d.Paragraph({ children: [new d.TextRun({ text: `${dateLabel(m)} · ${durLabel(m)} · ${Object.values(m.speakers || {}).join(', ')}`, color: '5D6982' })] })
  ];
  if (content !== 'transcript' && m.report) {
    for (const s of sections(m)) {
      kids.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun(s.h)] }));
      for (const p of s.p || []) kids.push(new d.Paragraph({ children: [new d.TextRun(p)] }));
      for (const i of s.items || []) kids.push(new d.Paragraph({ bullet: { level: 0 }, children: [new d.TextRun(i)] }));
    }
  }
  if (content !== 'report') {
    kids.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: content === 'both', children: [new d.TextRun('Full transcript')] }));
    for (const r of transcriptRows(m)) {
      kids.push(new d.Paragraph({ spacing: { after: 80 }, children: [new d.TextRun({ text: `${r.t}  `, color: '1F5BFF', bold: true }), new d.TextRun({ text: `${r.who}: `, bold: true }), new d.TextRun(r.text)] }));
    }
  }
  const doc = new d.Document({ creator: 'NovaMeet', title: m.title, styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }, sections: [{ children: kids }] });
  return d.Packer.toBuffer(doc);
}

function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function toHtml(m, content) {
  let body = `<h1>${esc(m.title)}</h1><p class="meta">${esc(dateLabel(m))} · ${esc(durLabel(m))} · ${esc(Object.values(m.speakers || {}).join(', '))}</p>`;
  if (content !== 'transcript' && m.report) {
    for (const s of sections(m)) {
      body += `<h2>${esc(s.h)}</h2>`;
      for (const p of s.p || []) body += `<p>${esc(p)}</p>`;
      if (s.items && s.items.length) body += '<ul>' + s.items.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';
    }
  }
  if (content !== 'report') {
    body += `<h2 class="${content === 'both' ? 'break' : ''}">Full transcript</h2><table>`;
    for (const r of transcriptRows(m)) body += `<tr><td class="t">${r.t}</td><td class="w">${esc(r.who)}</td><td>${esc(r.text)}</td></tr>`;
    body += '</table>';
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#0D1B34;font-size:11pt;line-height:1.5;margin:0}
    h1{font-size:20pt;margin:0 0 4pt}h2{font-size:13pt;margin:18pt 0 6pt;border-bottom:1px solid #E3E7ED;padding-bottom:4pt}
    .meta{color:#5D6982;margin:0 0 12pt}ul{padding-left:16pt}li{margin:3pt 0}
    table{border-collapse:collapse;width:100%}td{vertical-align:top;padding:3pt 6pt 3pt 0}
    td.t{color:#1F5BFF;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}td.w{font-weight:600;white-space:nowrap}
    .break{page-break-before:always}</style></head><body>${body}</body></html>`;
}

/** @returns {Promise<Buffer|string>} */
async function render(m, format, content, printToPdf) {
  if (format === 'txt') return toTxt(m, content);
  if (format === 'docx') return toDocx(m, content);
  if (format === 'pdf') return printToPdf(toHtml(m, content));
  throw new Error('Unknown format ' + format);
}

function fileName(m, format, content) {
  const d = new Date(m.startedAt);
  const p = (n) => String(n).padStart(2, '0');
  const label = { report: 'Report', transcript: 'Transcript', both: 'Report + Transcript' }[content];
  const safe = String(m.title).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} · ${safe} · ${label}.${format}`;
}

async function writeExport(m, format, content, folder, printToPdf) {
  const data = await render(m, format, content, printToPdf);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, fileName(m, format, content));
  fs.writeFileSync(file, data);
  return file;
}

module.exports = { render, writeExport, fileName, toTxt, toHtml };
