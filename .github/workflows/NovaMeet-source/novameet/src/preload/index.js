// The only bridge between NovaMeet's pages and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:init', 'settings:set', 'meetings:list', 'meetings:get', 'meetings:update', 'meetings:delete', 'meetings:deleteAll',
  'meetings:reprocess', 'search', 'models:list', 'models:install', 'models:installRecommended', 'models:cancel', 'models:remove',
  'ollama:pull', 'ollama:remove', 'hw:info', 'session:start', 'session:pause', 'session:end', 'session:cancelReport',
  'export', 'shell:show', 'shell:open', 'dialog:folder', 'app:show', 'notch:interactive', 'notch:startFromNotch'
]);
const EVENTS = new Set(['state', 'models', 'meetings-changed', 'toast', 'navigate', 'settings', 'notch:toggle', 'rec:start', 'rec:stop', 'rec:pause']);
const SEND = new Set(['rec:reply', 'rec:chunk', 'rec:levels', 'rec:fatal']);

contextBridge.exposeInMainWorld('nova', {
  platform: process.platform,
  invoke: (channel, ...args) => {
    if (!INVOKE.has(channel)) throw new Error('Blocked channel ' + channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, fn) => {
    if (!EVENTS.has(channel)) throw new Error('Blocked channel ' + channel);
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  send: (channel, ...args) => {
    if (!SEND.has(channel)) throw new Error('Blocked channel ' + channel);
    ipcRenderer.send(channel, ...args);
  }
});
