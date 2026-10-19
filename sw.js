// Service worker do app instalável (PWA).
// Rede primeiro: com internet, tudo vem sempre fresco do site (os ?v= dos
// scripts continuam valendo) e a cópia fica guardada. Sem internet, abre a
// última cópia guardada — dá para ver as telas, mas os dados (Firebase)
// precisam de conexão. Só mexe em GET do próprio site; Firebase, Mercado Pago
// e CDNs passam direto.

const VERSAO = "20261116a";
const CACHE = "interclasse-" + VERSAO;
const GUARDAR = /\.(html|js|css|png|svg|webp|webmanifest|ttf|woff2?)$/i;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n.startsWith("interclasse-") && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const pagina = req.mode === "navigate";
  if (!pagina && !GUARDAR.test(url.pathname)) return;

  ev.respondWith((async () => {
    try {
      const resp = await fetch(req);
      if (resp.ok) {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
      }
      return resp;
    } catch (e) {
      const cache = await caches.open(CACHE);
      // Página: qualquer cópia dela serve (time.html?id=A abre a de ?id=B).
      const guardada = await cache.match(req) || (pagina ? await cache.match(req, { ignoreSearch: true }) : null);
      if (guardada) return guardada;
      if (pagina) {
        const inicio = await cache.match("index.html", { ignoreSearch: true });
        if (inicio) return inicio;
      }
      throw e;
    }
  })());
});
