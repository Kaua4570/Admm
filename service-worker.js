/* Service Worker — BS Açaiteria PWA
   Estratégia: NETWORK-FIRST para os arquivos principais do app (HTML/CSS/JS) —
   sempre busca a versão mais nova na internet primeiro, e só usa o cache
   como reserva se o celular estiver sem conexão. Isso evita que arquivos
   antigos e novos fiquem misturados em cache (bug de "versões trocadas").
   Recursos externos (Firebase, jsPDF via CDN) passam direto pela rede. */

const CACHE_NAME = 'bs-acaiteria-v28';
const APP_SHELL = [
  './',
  './index.html',
  './cliente.html',
  './style.css',
  './app.js',
  './manifest.json',
  './logo-small.png',
  './icon-192.png',
  './icon-512.png',
  './acai-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Não interceptar chamadas externas (Firebase/Firestore/jsPDF/Google APIs) —
  // deixa passar direto pra rede para não quebrar a sincronização em nuvem.
  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST: tenta buscar a versão mais nova na rede.
  // Só usa o cache se estiver offline. Isso garante que HTML, CSS e JS
  // fiquem sempre sincronizados entre si, nunca uma mistura de versões.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
