/* Busca que carta hay en una imagen en grises.
 *
 * Dos pasos:
 *
 *  1. Tanteo. La carta esta mas o menos en el marco guia, pero nunca exacta.
 *     Probamos unos cuantos recortes alrededor y apuntamos que cartas del
 *     indice salen mas parecidas.
 *
 *  2. Ajuste fino. La huella es muy sensible al encuadre: desplazar la carta
 *     un 2% ya cambia unos 50 de los 256 bits. Asi que, para cada una de las
 *     pocas candidatas, movemos, escalamos y giramos el recorte poco a poco
 *     hasta que se parezca lo mas posible. Todas reciben el mismo trato, asi
 *     que la comparacion entre ellas es justa.
 *
 * Lo que decide NO es la distancia sino el MARGEN con la mejor rival: solo
 * la carta buena encaja mucho mejor que las demas cuando se la ajusta.
 *
 * Las reimpresiones (misma ilustracion en otro set) vienen agrupadas en el
 * indice. El margen se mide contra la primera carta de OTRO grupo; si no,
 * dos reimpresiones identicas darian margen cero y nunca habria acierto.
 */
(function (raiz) {
  "use strict";
  const H = raiz.Huella || (typeof require !== "undefined" ? require("./hash.js") : null);

  // Sobre 256 bits. Ver la calibracion en LEEME.md.
  const UMBRAL = { maxDist: 80, seguro: 30, dudoso: 16 };
  const SIN_RIVAL = 64;   // margen si no hay otra candidata a la vista
  const VECINAS = 8;
  const CANDIDATAS = 3;

  const CAMARA = { escalas: [1, 0.96, 1.04, 0.92, 1.08], desp: [0, -0.025, 0.025, -0.05, 0.05] };
  // En una foto la carta puede estar en cualquier sitio: se recorre toda la
  // imagen con pasos proporcionales a la carta. Por debajo de la mitad de
  // la foto ya no se encuentra bien, y se pide hacerla mas de cerca.
  const FOTO = { cubrir: true, escalas: [1, .95, .9, .85, .8, .76, .72, .68, .64, .6, .57, .54], paso: 0.045 };

  /* Prepara el indice para buscar: una tabla compacta con las huellas. */
  function prepararIndice(cartas, campoHuella, campoGrupo) {
    const filas = [];
    cartas.forEach((c, i) => { if (c[campoHuella]) filas.push(i); });
    const tabla = new Uint32Array(filas.length * H.PALABRAS);
    filas.forEach((i, f) => H.deHex(cartas[i][campoHuella], tabla, f * H.PALABRAS));
    const grupo = cartas.map((c, i) => (c[campoGrupo] == null ? i : c[campoGrupo]));
    const miembros = {};
    filas.forEach(i => (miembros[grupo[i]] = miembros[grupo[i]] || []).push(i));
    return { tabla, filas, n: filas.length, grupo, miembros };
  }

  function* tanteos(guia, ancho, alto, op) {
    if (op.cubrir) {
      for (const s of op.escalas) {
        const w = guia.w * s, h = guia.h * s, paso = op.paso * w;
        const nx = Math.max(0, Math.floor((guia.w - w) / 2 / paso));
        const ny = Math.max(0, Math.floor((guia.h - h) / 2 / paso));
        for (let j = -ny; j <= ny; j++)
          for (let i = -nx; i <= nx; i++)
            yield { cx: guia.x + guia.w / 2 + i * paso, cy: guia.y + guia.h / 2 + j * paso, w, h, giro: 0 };
      }
      return;
    }
    for (const s of op.escalas)
      for (const dy of op.desp)
        for (const dx of op.desp) {
          const w = guia.w * s, h = guia.h * s;
          const cx = guia.x + guia.w / 2 + dx * guia.w;
          const cy = guia.y + guia.h / 2 + dy * guia.h;
          if (cx - w / 2 < -2 || cy - h / 2 < -2 || cx + w / 2 > ancho + 2 ||
              cy + h / 2 > alto + 2) continue;
          yield { cx, cy, w, h, giro: 0 };
        }
  }

  /* Mueve el recorte poco a poco mientras se parezca mas a la fila f. */
  function ajustar(gris, ancho, alto, ix, f, inicio, dist0) {
    let r = Object.assign({}, inicio), mejor = dist0, evals = 0;
    const base = r.w;
    let paso = { pos: 0.02, esc: 0.025, giro: 0.026, forma: 0.02 };
    const mover = [
      (r, s) => ({ ...r, cx: r.cx + s * paso.pos * base }),
      (r, s) => ({ ...r, cy: r.cy + s * paso.pos * base }),
      (r, s) => ({ ...r, w: r.w * (1 + s * paso.esc), h: r.h * (1 + s * paso.esc) }),
      (r, s) => ({ ...r, giro: r.giro + s * paso.giro }),
      (r, s) => ({ ...r, h: r.h * (1 + s * paso.forma) }),
    ];
    while (paso.pos > 0.003 && evals < 70) {
      let mejora = false;
      for (const m of mover)
        for (const s of [1, -1]) {
          const prueba = m(r, s);
          const d = H.distancia(H.huella(gris, ancho, alto, prueba), ix.tabla, f);
          evals++;
          if (d < mejor) { mejor = d; r = prueba; mejora = true; break; }
        }
      if (!mejora) for (const k in paso) paso[k] /= 2;
    }
    return { r, dist: mejor };
  }

  function veredicto(res) {
    if (res.dist <= UMBRAL.maxDist && res.margen >= UMBRAL.seguro) return "seguro";
    if (res.margen >= UMBRAL.dudoso && res.dist <= UMBRAL.maxDist + 16) return "dudoso";
    return "nada";
  }

  /* gris: Float32Array ancho*alto. guia: {x,y,w,h} donde se espera la carta.
   * modo: "camara" (la carta esta en el marco) o "foto" (puede estar en
   * cualquier sitio y a cualquier tamaño: mas lento). */
  function analizar(gris, ancho, alto, guia, ix, modo) {
    if (!ix.n) return null;
    const op = modo === "foto" ? FOTO : CAMARA;

    // 1. Tanteo: mejor distancia de cada fila y en que recorte
    const vistas = new Map();
    for (const r of tanteos(guia, ancho, alto, op)) {
      const q = H.huella(gris, ancho, alto, r);
      for (const [d, f] of H.masParecidas(q, ix.tabla, ix.n, VECINAS)) {
        const v = vistas.get(f);
        if (!v || d < v.dist) vistas.set(f, { dist: d, r });
      }
    }
    // Una candidata por grupo: la que mejor salio
    const porGrupo = new Map();
    for (const [f, v] of vistas) {
      const g = ix.grupo[ix.filas[f]];
      const actual = porGrupo.get(g);
      if (!actual || v.dist < actual.dist) porGrupo.set(g, { f, ...v });
    }
    const elegidas = [...porGrupo.values()].sort((a, b) => a.dist - b.dist).slice(0, CANDIDATAS);

    // 2. Ajuste fino de cada candidata
    const ajustadas = elegidas.map(c => {
      const a = ajustar(gris, ancho, alto, ix, c.f, c.r, c.dist);
      return { carta: ix.filas[c.f], dist: a.dist, r: a.r };
    }).sort((a, b) => a.dist - b.dist);

    const mejor = ajustadas[0];
    const g = ix.grupo[mejor.carta];
    // Rivales: las otras ajustadas y todo el indice visto desde el mejor recorte
    let rival = Infinity;
    for (const c of ajustadas.slice(1)) rival = Math.min(rival, c.dist);
    const q = H.huella(gris, ancho, alto, mejor.r);
    const desde = H.masParecidas(q, ix.tabla, ix.n, VECINAS)
      .map(([d, f]) => ({ carta: ix.filas[f], dist: d }));
    for (const c of desde)
      if (ix.grupo[c.carta] !== g) { rival = Math.min(rival, c.dist); break; }

    const lista = [mejor];
    for (const c of [...ajustadas.slice(1), ...desde])
      if (!lista.some(x => ix.grupo[x.carta] === ix.grupo[c.carta])) lista.push(c);

    const res = {
      lista: lista.slice(0, 5),
      dist: mejor.dist,
      margen: Math.min(SIN_RIVAL, (rival === Infinity ? SIN_RIVAL : rival - mejor.dist)),
      grupo: g,
      mismas: ix.miembros[g] || [mejor.carta],
      recorte: mejor.r,
    };
    res.veredicto = veredicto(res);
    return res;
  }

  const api = { UMBRAL, prepararIndice, analizar, veredicto };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Reconocer = api;
})(typeof self !== "undefined" ? self : this);
