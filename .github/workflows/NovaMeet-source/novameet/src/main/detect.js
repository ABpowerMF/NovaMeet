// Notices when an online meeting starts so NovaMeet can *suggest* recording.
// It only reads window titles and never starts recording on its own.
'use strict';

const RULES = [
  { app: 'Zoom', re: /^Zoom (Meeting|Webinar)|Zoom Meeting$/i },
  { app: 'Microsoft Teams', re: /(Meeting|Call|Reunião|Chamada).*\|\s*Microsoft Teams|Microsoft Teams.*(Meeting|Call)/i },
  { app: 'Google Meet', re: /(^|\s)Meet\s*[-–—]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}|Google Meet/i },
  { app: 'Webex', re: /Webex.*(Meeting|Reunião)|Cisco Webex Meetings/i },
  { app: 'Slack', re: /Huddle.*Slack|Slack.*Huddle/i },
  { app: 'Discord', re: /Discord.*Voice Connected/i }
];

function cleanTitle(app, title) {
  let t = title.replace(/\s*[|–—-]\s*(Microsoft Teams|Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Arc|Safari)\s*$/i, '');
  if (app === 'Google Meet') t = t.replace(/^Meet\s*[-–—]\s*/i, '');
  if (/^Zoom (Meeting|Webinar)$/i.test(t)) return '';
  return t.replace(/^(Meeting with|Meeting in|Call with)\s*/i, '').trim();
}

/** @param {import('electron').DesktopCapturer} desktopCapturer */
async function detectMeeting(desktopCapturer) {
  let sources = [];
  try { sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }); } catch (e) { return null; }
  for (const s of sources) {
    for (const r of RULES) {
      if (r.re.test(s.name)) return { app: r.app, title: cleanTitle(r.app, s.name), windowId: s.id };
    }
  }
  return null;
}

module.exports = { detectMeeting, RULES };
