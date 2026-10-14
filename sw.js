// Deadlink: отдаёт обложки и треки по старым адресам /_blob/<id>.
// Файлы лежат в media/ на GitHub Pages, новые загрузки — в базе на Netlify.
importScripts('config.js');
let MAP = null;
const scope = self.registration.scope;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
async function getMap() {
  if (!MAP) {
    try { MAP = await (await fetch(new URL('media-map.json', scope), { cache: 'no-cache' })).json(); }
    catch (e) { MAP = null; return {}; }
  }
  return MAP;
}
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  const m = u.pathname.match(/\/_blob\/([0-9a-f]{32})$/);
  if (!m) return;
  e.respondWith((async () => {
    const map = await getMap(), p = map[m[1]];
    const target = p ? new URL(p.split('/').map(encodeURIComponent).join('/'), scope).href : self.DL_API + '/api/blob/' + m[1];
    const h = new Headers(), r = e.request.headers.get('range');
    if (r) h.set('Range', r);
    return fetch(target, { headers: h, mode: p ? 'same-origin' : 'cors' });
  })());
});
