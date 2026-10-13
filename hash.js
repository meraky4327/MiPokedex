/* Huella de la ilustracion de una carta.
 *
 * Es el MISMO algoritmo que huella() en generar_indice.py. Si cambias algo
 * aqui, cambialo alli y vuelve a generar el indice: si la foto y las cartas
 * de referencia no se procesan igual, nada coincide.
 *
 *  1. La carta se describe por su centro, su tamaño y su giro. Asi se puede
 *     leer una carta algo torcida sin enderezar antes la imagen entera.
 *  2. Se toma la ventana de la ilustracion (ARTE). El marco y el cuadro de
 *     texto son casi iguales en todo un set y taparian lo que distingue una
 *     carta de otra.
 *  3. Se parte en 4 cuadrantes. Un trozo puede coincidir por azar, los
 *     cuatro a la vez casi nunca; y si un reflejo quema uno, quedan tres.
 *  4. Cada cuadrante se reduce a 32x32 grises (promediando 2x2 muestras por
 *     casilla), se le aplica la DCT y se comparan las 8x8 frecuencias bajas
 *     con su mediana. Resultado: 4 x 64 = 256 bits.
 */
(function (raiz) {
  "use strict";

  const ARTE = [0.07, 0.11, 0.93, 0.52]; // izq, arriba, der, abajo
  const N = 32;   // casillas por lado de cada cuadrante
  const S = 2;    // muestras por casilla y eje
  const M = N * S;
  const L = 8;    // frecuencias que se conservan por eje
  const PALABRAS = 8; // 256 bits = 8 enteros de 32

  // Fila k, columna n: coseno de la DCT-II. Solo hacen falta las 8 primeras.
  const DCT = new Float64Array(L * N);
  for (let k = 0; k < L; k++)
    for (let n = 0; n < N; n++)
      DCT[k * N + n] = Math.cos(Math.PI * k * (2 * n + 1) / (2 * N));

  /* Valor interpolado en (x, y), con los centros de pixel en +0.5. */
  function muestra(gris, ancho, alto, x, y) {
    let fx = x - 0.5, fy = y - 0.5;
    if (fx < 0) fx = 0; else if (fx > ancho - 1) fx = ancho - 1;
    if (fy < 0) fy = 0; else if (fy > alto - 1) fy = alto - 1;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 > ancho - 2) x0 = Math.max(0, ancho - 2);
    if (y0 > alto - 2) y0 = Math.max(0, alto - 2);
    const tx = fx - x0, ty = fy - y0, p = y0 * ancho + x0;
    const a = gris[p], b = gris[p + 1], c = gris[p + ancho], d = gris[p + ancho + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /* Cuadrante 32x32: (u0, v0) esquina y (du, dv) tamaño, en coordenadas de
   * la carta con origen en su centro. cos/sen: giro de la carta. */
  function reducir(gris, ancho, alto, r, cos, sen, u0, v0, du, dv) {
    const out = new Float64Array(N * N);
    const pu = du / M, pv = dv / M;
    for (let i = 0; i < M; i++) {
      const v = v0 + (i + 0.5) * pv;
      const fila = (i / S | 0) * N;
      for (let j = 0; j < M; j++) {
        const u = u0 + (j + 0.5) * pu;
        const x = r.cx + u * cos - v * sen;
        const y = r.cy + u * sen + v * cos;
        out[fila + (j / S | 0)] += muestra(gris, ancho, alto, x, y);
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= S * S;
    return out;
  }

  /* 64 bits de un cuadrante 32x32, en dos palabras de 32 (bit alto primero). */
  function bitsCuadrante(m, palabras, pos) {
    const tmp = new Float64Array(L * N);       // DCT (8x32) * m (32x32)
    for (let k = 0; k < L; k++)
      for (let j = 0; j < N; j++) {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += DCT[k * N + i] * m[i * N + j];
        tmp[k * N + j] = acc;
      }
    const baja = new Float64Array(L * L);      // tmp * DCT^T (8x8)
    for (let k = 0; k < L; k++)
      for (let q = 0; q < L; q++) {
        let acc = 0;
        for (let j = 0; j < N; j++) acc += tmp[k * N + j] * DCT[q * N + j];
        baja[k * L + q] = acc;
      }
    const orden = Array.from(baja).sort((a, b) => a - b);
    const mediana = (orden[31] + orden[32]) / 2;
    let alta = 0, bajaPal = 0;
    for (let b = 0; b < 64; b++) {
      const bit = baja[b] > mediana ? 1 : 0;
      if (b < 32) alta = (alta << 1) | bit;
      else bajaPal = (bajaPal << 1) | bit;
    }
    palabras[pos] = alta >>> 0;
    palabras[pos + 1] = bajaPal >>> 0;
  }

  /* Huella de la carta descrita por r = {cx, cy, w, h, giro} (giro en
   * radianes) dentro de una imagen en grises de ancho x alto. */
  function huella(gris, ancho, alto, r) {
    const cos = Math.cos(r.giro || 0), sen = Math.sin(r.giro || 0);
    const u0 = (ARTE[0] - 0.5) * r.w, v0 = (ARTE[1] - 0.5) * r.h;
    const du = (ARTE[2] - ARTE[0]) * r.w / 2, dv = (ARTE[3] - ARTE[1]) * r.h / 2;
    const palabras = new Uint32Array(PALABRAS);
    let pos = 0;
    for (let fi = 0; fi < 2; fi++)
      for (let co = 0; co < 2; co++) {
        const m = reducir(gris, ancho, alto, r, cos, sen,
          u0 + co * du, v0 + fi * dv, du, dv);
        bitsCuadrante(m, palabras, pos);
        pos += 2;
      }
    return palabras;
  }

  /* RGBA (de un canvas) -> grises con los pesos de luminancia de siempre. */
  function aGris(rgba, n) {
    const g = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4)
      g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    return g;
  }

  function aHex(palabras) {
    let s = "";
    for (const p of palabras) s += p.toString(16).padStart(8, "0");
    return s;
  }

  function deHex(hex, destino, pos) {
    for (let i = 0; i < PALABRAS; i++)
      destino[pos + i] = parseInt(hex.substr(i * 8, 8), 16) >>> 0;
  }

  function bitsDistintos(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  /* Distancia entre una huella y la fila f de una tabla. */
  function distancia(q, tabla, f) {
    let d = 0;
    for (let i = 0, b = f * PALABRAS; i < PALABRAS; i++) d += bitsDistintos(tabla[b + i] ^ q[i]);
    return d;
  }

  /* Las k filas mas parecidas: [[distancia, fila], ...] de menor a mayor. */
  function masParecidas(q, tabla, cuantas, k) {
    const mejores = [];
    let peor = Infinity;
    for (let c = 0; c < cuantas; c++) {
      const d = distancia(q, tabla, c);
      if (mejores.length < k || d < peor) {
        let pos = mejores.length;
        while (pos > 0 && mejores[pos - 1][0] > d) pos--;
        mejores.splice(pos, 0, [d, c]);
        if (mejores.length > k) mejores.pop();
        peor = mejores[mejores.length - 1][0];
      }
    }
    return mejores;
  }

  const api = { ARTE, PALABRAS, huella, aGris, aHex, deHex, distancia, masParecidas, bitsDistintos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Huella = api;
})(typeof self !== "undefined" ? self : this);
