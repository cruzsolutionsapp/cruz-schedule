/* Service worker: deixa o app abrir sem internet.
   Arquivos do app: rede primeiro (pega a versão nova), cache se estiver offline.
   Bibliotecas do Firebase e fontes: cache primeiro (são versões fixas). */
const VERSION = 'v116';
const SHELL = ['./', 'index.html', 'style.css', 'app-core.js', 'i18n.js', 'auth.js', 'manifest.webmanifest',
  'img/logo-mask.png', 'img/icon-192.png', 'img/icon-512.png', 'img/apple-touch-icon.png', 'img/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open('shell-' + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== 'shell-' + VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const staticLib = url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (sameOrigin) {
    // ?_=hora: passa direto pelo cache do GitHub (que guarda arquivos por até 10 min) e sempre pega a versão nova
    const fresh = req.url.split('#')[0] + (url.search ? '&' : '?') + '_=' + Date.now();
    e.respondWith(fetch(new Request(fresh, { cache: 'no-store', credentials: 'same-origin' })).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open('shell-' + VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else if (staticLib) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open('libs').then(c => c.put(req, copy)); return res;
    })));
  }
});
