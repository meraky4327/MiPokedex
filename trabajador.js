/* Hilo aparte para el reconocimiento: asi la camara y la pantalla no se
 * congelan mientras se calculan huellas. */
importScripts("hash.js", "reconocer.js");

let indice = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.tipo === "indice") {
    // m.cartas: [[huella, grupo], ...] en el mismo orden que en la app
    indice = Reconocer.prepararIndice(m.cartas, 0, 1);
    self.postMessage({ tipo: "listo", reconocibles: indice.n });
    return;
  }
  if (m.tipo === "analizar") {
    let res = null, error = null;
    const t0 = performance.now();
    try {
      if (indice) res = Reconocer.analizar(new Float32Array(m.gris), m.ancho, m.alto,
                                            m.guia, indice, m.modo);
    } catch (err) {
      error = String(err && err.message || err);
    }
    self.postMessage({ tipo: "resultado", id: m.id, res, error, modo: m.modo,
                       ms: Math.round(performance.now() - t0) });
  }
};
