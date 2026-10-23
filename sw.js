/* Guarda la app en el movil para que abra al instante y funcione sin
 * cobertura. Si cambias algun fichero de la app, sube VERSION para que los
 * moviles descarguen la nueva. El catalogo (indice.json) no hace falta: se
 * pide siempre a la red primero y solo se usa la copia guardada sin conexion. */
const VERSION = "mipokedex-11";
const APP = ["./", "index.html", "estilos.css", "app.js", "mazos.js", "hash.js", "reconocer.js",
             "trabajador.js", "manifest.webmanifest", "iconos/icono.svg",
             "iconos/icono-180.png", "iconos/icono-192.png", "iconos/icono-512.png",
             "iconos/icono-mascara-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.endsWith("/indice.json")) {
    // Red primero: si has publicado sets nuevos, que se vean ya.
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // El resto: lo guardado, y por detras se refresca para la proxima vez.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((guardado) => {
    const red = fetch(e.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => guardado);
    return guardado || red;
  }));
});
