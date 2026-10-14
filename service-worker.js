/* Disk Dourado Artes — Service Worker
 * - Pré-cache do "shell" do app (abre offline).
 * - Bibliotecas/fontes de CDN: cache sob demanda (cache-first).
 * - NÃO intercepta Firestore, Auth nem Storage: imagens do Storage só ficam offline
 *   se o usuário usar "Salvar offline" (IndexedDB, feito pelo app.js).
 * Atualização: aumente VERSION a cada publicação. O app mostra "Atualizar" quando há versão nova.
 */
const VERSION = "v1.0.4";
const SHELL_CACHE = `dda-shell-${VERSION}`;
const CDN_CACHE = "dda-cdn-v1";

const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "offline.html",
  "logo.png",
  "icon-192.png",
  "icon-512.png",
];

const CDN_HOSTS = [
  "www.gstatic.com",          // SDK do Firebase (módulos)
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",     // JSZip
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("dda-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Navegação: rede primeiro, cai para o shell em cache e por fim para a página offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("index.html")) || (await cache.match("offline.html")) || Response.error();
        }
      })()
    );
    return;
  }

  // Arquivos do próprio app: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || (await network) || (await cache.match("offline.html")) || Response.error();
      })()
    );
    return;
  }

  // CDNs conhecidas: cache-first.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CDN_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === "opaque") cache.put(req, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      })()
    );
  }
  // Qualquer outra origem (Firebase APIs, Storage): sem interceptação.
});
