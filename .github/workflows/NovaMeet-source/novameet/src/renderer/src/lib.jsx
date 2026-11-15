// Shared helpers, icons and small components (same visual language as the prototype).
import { useEffect, useState, useRef } from 'react';

export const nova = window.nova;
export const isMac = nova.platform === 'darwin';

export function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const p = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}
export function durLabel(s) {
  s = Math.round(s || 0);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
  return `${Math.max(1, Math.round(s / 60))} min`;
}
export function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, now)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function timeLabel(iso) { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
export function daysAgo(iso) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
export function gb(bytes) { return bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(bytes / 1e6)) + ' MB'; }
export function sizeLabel(mb) { return mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB'; }
export function initials(name) {
  const p = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (/^Speaker \d+$/i.test(name)) return 'S' + p[1];
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ''))).toUpperCase();
}
export function avClass(speakerId, order) {
  if (speakerId === 'unknown') return 'av av-u';
  if (speakerId === 'me') return 'av av-1';
  const i = order.indexOf(speakerId);
  return 'av av-' + (2 + ((i < 0 ? 0 : i) % 7));
}
export function speakerOrder(speakers) { return Object.keys(speakers || {}).filter((k) => k !== 'me' && k !== 'unknown'); }

export function useNova(channel, fn, deps = []) {
  useEffect(() => nova.on(channel, fn), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useOutside(ref, onOut, active) {
  useEffect(() => {
    if (!active) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onOut(); };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ---------------------------------------------------------------- icons
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  cal: 'M3 7a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 7v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18zM3 9.5h18M8 2.5v4M16 2.5v4',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5',
  cpu: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5M10.5 9.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z',
  plug: 'M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM17 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  mic: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  drive: 'M5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM5 13l2.5-8h9L19 13M7 16.5h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.5h.01',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  help: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 17h.01',
  q: 'M9.2 9a2.9 2.9 0 1 1 4 2.7c-.7.3-1.2.9-1.2 1.6v.4M12 17.5h.01',
  task: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8.5 12.2l2.4 2.4 4.6-4.9',
  lines: 'M4 6h16M4 10h16M4 14h10M4 18h7',
  doc: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  docPlain: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5',
  pdf: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 15h1.5a1.5 1.5 0 0 0 0-3H9v5',
  gdoc: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M10 14.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V12l3 2',
  users: 'M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  shield: 'M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6zM9 12l2 2 4-4',
  lock: 'M7 10.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 10.5V7.5a4 4 0 0 1 8 0v3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  jump: 'M7 17 17 7M9 7h8v8',
  chevL: 'M15 18l-6-6 6-6',
  chevR: 'M9 6l6 6-6 6',
  chevD: 'M6 9l6 6 6-6',
  chevU: 'M6 15l6-6 6 6',
  x: 'M6 6l12 12M18 6 6 18',
  pause: 'M8 5v14M16 5v14',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  laptop: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5V16H4V6.5A1.5 1.5 0 0 1 5.5 5zM2 19h20',
  cloud: 'M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9z',
  brain: 'M12 5v14M8.5 4.5A3.5 3.5 0 0 0 5 8v.5A3.5 3.5 0 0 0 4 15a3.5 3.5 0 0 0 4.5 4.5M15.5 4.5A3.5 3.5 0 0 1 19 8v.5a3.5 3.5 0 0 1 1 6.5 3.5 3.5 0 0 1-4.5 4.5',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  bolt: 'M13 3 4 14h7l-1 7 9-11h-7z'
};
export function Icon({ n, cls, style }) {
  return <svg className={'ic' + (cls ? ' ' + cls : '')} style={style} viewBox="0 0 24 24" aria-hidden="true"><path d={P[n] || ''} /></svg>;
}
export function PlayIcon() { return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path className="fill" d="M8 5.5v13l11-6.5z" /></svg>; }
export function StopIcon() { return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" /></svg>; }

export function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="7" width="30" height="18" rx="9" fill="#05070D" />
      <circle cx="9.5" cy="16" r="3.2" fill="#3E74FF" />
      <rect x="15.5" y="13.5" width="2.2" height="5" rx="1.1" fill="#fff" />
      <rect x="19.5" y="11.5" width="2.2" height="9" rx="1.1" fill="#fff" />
      <rect x="23.5" y="13" width="2.2" height="6" rx="1.1" fill="#fff" />
    </svg>
  );
}

export function Wave({ bars = 24, lg, paused, dim }) {
  return <span className={'wave' + (lg ? ' lg' : '') + (paused ? ' paused' : '') + (dim ? ' dim' : '')} aria-hidden="true">{Array.from({ length: bars }, (_, i) => <i key={i} />)}</span>;
}

export function Switch({ on, onChange, label, disabled, locked }) {
  return <button className={'switch' + (on ? ' on' : '') + (locked ? ' locked' : '')} aria-pressed={!!on} aria-label={label} disabled={disabled || locked} onClick={() => onChange(!on)} />;
}

export function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l, dis]) => <button key={v} className={value === v ? 'on' : ''} disabled={dis} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Modal({ children, label, onClose, width }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={label} style={width ? { width: `min(${width}px, 100%)` } : undefined}>{children}</div>
    </div>
  );
}

export const STATUS = {
  recording: ['Recording', 'chip chip-red'],
  processing: ['Processing', 'chip chip-blue'],
  done: ['Completed', 'chip chip-green'],
  review: ['Needs review', 'chip chip-amber'],
  failed: ['Failed', 'chip chip-red']
};
export const SEV = {
  crit: { cls: 'find crit', fi: 'fi red', icon: 'alert', chip: 'chip chip-red', kind: 'Critical' },
  risk: { cls: 'find risk', fi: 'fi amber', icon: 'alert', chip: 'chip chip-amber', kind: 'Potential risk' },
  conflict: { cls: 'find conflict', fi: 'fi amber', icon: 'swap', chip: 'chip chip-amber', kind: 'Contradiction' },
  review: { cls: 'find review', fi: 'fi grey', icon: 'q', chip: 'chip', kind: 'Needs review' },
  open: { cls: 'find', fi: 'fi grey', icon: 'help', chip: 'chip', kind: 'Open question' }
};
export const CATEGORIES = ['Project', 'Client', 'Engineering', 'Design', 'Hiring', 'Finance', '1:1', 'Other'];
