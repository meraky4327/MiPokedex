/* MiPokedex: escanear cartas y llevar la colección, todo en el móvil.
 *
 * No hay servidor. El catálogo (indice.json) se genera en el PC con
 * generar_indice.py y se publica junto a esta página. Tu colección vive en
 * este navegador; desde Ajustes puedes sacar una copia y recuperarla.
 */
"use strict";

const IMAGENES = "https://assets.tcgdex.net/";
const VARIANTE = { n: "normal", r: "reverse", h: "holo", f: "firstEdition", p: "wPromo" };
const NOMBRE_VARIANTE = { normal: "Normal", reverse: "Reverse", holo: "Holo",
                          firstEdition: "1ª edición", wPromo: "Promo" };
const ETIQUETA_VARIANTE = { normal: "", reverse: "REV", holo: "HOLO", firstEdition: "1ED", wPromo: "PROMO" };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
               "septiembre", "octubre", "noviembre", "diciembre"];

// La carta se reduce a este ancho antes de calcular su huella: el mismo
// que usa generar_indice.py con las imágenes de referencia.
const ANCHO_CARTA = 245;
const MARGEN_RECORTE = 0.10;   // lo que se coge alrededor del marco guía
const MARGEN_DOS_SEGUIDAS = 18; // ver la calibración en LEEME.md

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normaliza = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function aviso(texto, ms = 2600) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.add("visible");
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove("visible"), ms);
}

function fechaLarga(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-").map(Number);
  if (d) return `${d} de ${MESES[m - 1]} de ${a}`;
  if (m) return `${MESES[m - 1]} de ${a}`;
  return String(a);
}

function hace(iso) {
  if (!iso) return null;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

/* ---------------------------------------------------------------------
 * Lo tuyo: colección y preferencias, guardadas en este navegador
 * ------------------------------------------------------------------- */

const Guardado = (() => {
  const CLAVE = "mipokedex.v1";
  let d = { coleccion: {}, master: [], mazos: [], ocultos: [], copia: null, cambios: 0 };
  try {
    const t = localStorage.getItem(CLAVE);
    if (t) d = Object.assign(d, JSON.parse(t));
  } catch (e) { /* sin almacenamiento: seguimos en memoria */ }
  let pedidoPersistir = false;

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(d));
    } catch (e) {
      aviso("No he podido guardar: el navegador no deja espacio.", 5000);
    }
    // Pide al navegador que no borre estos datos cuando le falte sitio.
    if (!pedidoPersistir && navigator.storage && navigator.storage.persist) {
      pedidoPersistir = true;
      navigator.storage.persist().catch(() => {});
    }
  }

  return {
    cantidad: (id, v) => (d.coleccion[id] && d.coleccion[id][v]) || 0,
    total(id) {
      const c = d.coleccion[id];
      let s = 0;
      if (c) for (const k in c) s += c[k];
      return s;
    },
    de: (id) => d.coleccion[id] || {},
    poner(id, v, q) {
      q = Math.max(0, Math.floor(q));
      const c = d.coleccion[id] || (d.coleccion[id] = {});
      if (q) c[v] = q; else delete c[v];
      if (!Object.keys(c).length) delete d.coleccion[id];
      d.cambios++;
      guardar();
      return q;
    },
    sumar(id, v, delta) { return this.poner(id, v, this.cantidad(id, v) + delta); },
    esMaster: (clave) => d.master.includes(clave),
    ponerMaster(clave, si) {
      d.master = d.master.filter((x) => x !== clave);
      if (si) d.master.push(clave);
      guardar();
    },
    exportar() {
      d.copia = new Date().toISOString();
      d.cambios = 0;
      guardar();
      return { tipo: "pokedex-coleccion", v: 1, fecha: d.copia,
               coleccion: d.coleccion, master: d.master, mazos: d.mazos, ocultos: d.ocultos };
    },
    importar(datos, modo) {
      const nueva = modo === "reemplazar" ? {} : JSON.parse(JSON.stringify(d.coleccion));
      let copias = 0;
      for (const [id, vars] of Object.entries(datos.coleccion || {}))
        for (const [v, q] of Object.entries(vars || {})) {
          const n = Math.floor(Number(q));
          if (!(n > 0)) continue;
          nueva[id] = nueva[id] || {};
          nueva[id][v] = (modo === "reemplazar" ? 0 : nueva[id][v] || 0) + n;
          copias += n;
        }
      d.coleccion = nueva;
      d.master = [...new Set([...(modo === "reemplazar" ? [] : d.master), ...(datos.master || [])])];
      if (Array.isArray(datos.ocultos))
        d.ocultos = [...new Set([...(modo === "reemplazar" ? [] : d.ocultos), ...datos.ocultos])];
      // Copias antiguas no traen mazos: entonces se conservan los de aquí.
      if (Array.isArray(datos.mazos)) {
        const ya = new Set(d.mazos.map((m) => m.id));
        d.mazos = modo === "reemplazar" ? datos.mazos
          : [...d.mazos, ...datos.mazos.filter((m) => !ya.has(m.id))];
      }
      d.cambios++;
      guardar();
      return copias;
    },
    borrar() { d.coleccion = {}; d.cambios++; guardar(); },
    // Mazos: cada uno con su propia cuenta, independiente de la colección.
    get mazos() { return d.mazos; },
    mazo: (id) => d.mazos.find((m) => m.id === id),
    guardarMazo(m) {
      const i = d.mazos.findIndex((x) => x.id === m.id);
      if (i >= 0) d.mazos[i] = m; else d.mazos.push(m);
      d.cambios++;
      guardar();
    },
    borrarMazo(id) { d.mazos = d.mazos.filter((m) => m.id !== id); d.cambios++; guardar(); },
    // Sets, Pokémon e ilustradores quitados de la lista con la papelera.
    // Claves: "set:sv08", "dex:248", "ilu:Mitsuhiro Arita".
    oculto: (clave) => d.ocultos.includes(clave),
    get ocultos() { return d.ocultos; },
    ocultar(clave, si) {
      d.ocultos = d.ocultos.filter((x) => x !== clave);
      if (si) d.ocultos.push(clave);
      d.cambios++;
      guardar();
    },
    get copia() { return d.copia; },
    get cambios() { return d.cambios; },
    get todo() { return d.coleccion; },
  };
})();

/* ---------------------------------------------------------------------
 * El catálogo
 * ------------------------------------------------------------------- */

const Cat = { listo: false, error: null, sets: [], cartas: [], porId: new Map(),
              porSet: new Map(), porGrupo: new Map(), generado: null, reconocibles: 0,
              porDex: new Map(), porIlustrador: new Map(), pokemon: [], ilustradores: [], codigos: {} };

async function cargarIndice() {
  let datos;
  try {
    const r = await fetch("indice.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status === 404 ? "sin-indice" : `HTTP ${r.status}`);
    datos = await r.json();
  } catch (e) {
    Cat.error = e.message === "sin-indice" ? "sin-indice" : "No he podido leer indice.json: " + e.message;
    return;
  }
  if (datos.tipo !== "pokedex-indice") { Cat.error = "indice.json no tiene el formato esperado."; return; }
  const campo = Object.fromEntries(datos.campos.map((c, i) => [c, i]));
  Cat.generado = datos.generado;
  Cat.sets = datos.sets.map((s, i) => ({ ...s, i }));
  Cat.cartas = datos.cartas.map((f, i) => ({
    i,
    id: f[campo.id], nombre: f[campo.nombre], set: Cat.sets[f[campo.set]],
    numero: f[campo.numero], rareza: f[campo.rareza],
    dexs: Array.isArray(f[campo.dex]) ? f[campo.dex] : (f[campo.dex] ? [f[campo.dex]] : []),
    ilustrador: f[campo.ilustrador], categoria: f[campo.categoria], hp: f[campo.hp],
    tipos: f[campo.tipos] ? f[campo.tipos].split(",") : [],
    variantes: [...(f[campo.variantes] || "n")].map((l) => VARIANTE[l]).filter(Boolean),
    imagen: f[campo.imagen], huella: f[campo.huella], grupo: f[campo.grupo],
  }));
  for (const c of Cat.cartas) {
    Cat.porId.set(c.id, c);
    if (!Cat.porSet.has(c.set.id)) Cat.porSet.set(c.set.id, []);
    Cat.porSet.get(c.set.id).push(c);
    if (c.huella) {
      if (!Cat.porGrupo.has(c.grupo)) Cat.porGrupo.set(c.grupo, []);
      Cat.porGrupo.get(c.grupo).push(c);
    }
    c.dex = c.dexs[0] || 0;
    for (const d of c.dexs) {
      if (!Cat.porDex.has(d)) Cat.porDex.set(d, []);
      Cat.porDex.get(d).push(c);
    }
    if (c.ilustrador) {
      if (!Cat.porIlustrador.has(c.ilustrador)) Cat.porIlustrador.set(c.ilustrador, []);
      Cat.porIlustrador.get(c.ilustrador).push(c);
    }
  }
  Cat.codigos = datos.codigos || {};
  Cat.pokemon = (datos.pokemon || []).filter((p) => Cat.porDex.has(p.dex));
  Cat.ilustradores = (datos.ilustradores || []).filter((n) => Cat.porIlustrador.has(n));
  Cat.reconocibles = Cat.cartas.filter((c) => c.huella).length;
  Cat.listo = true;
}

function urlImagen(c, calidad = "low") {
  if (!c.imagen) return null;
  const base = c.imagen.startsWith("http") ? c.imagen : IMAGENES + c.imagen;
  return `${base}/${calidad}.webp`;
}

function imgCarta(c, calidad = "low", extra = "") {
  const url = urlImagen(c, calidad);
  return url ? `<img src="${url}" loading="lazy" decoding="async" alt="" ${extra} onerror="this.remove()">` : "";
}

function numeroCompleto(c) {
  return c.set.oficial ? `${c.numero}/${String(c.set.oficial).padStart(String(c.numero).length, "0")}` : c.numero;
}

/* Progreso: (tengo, de) contando variantes aparte o no. */
function progreso(cartas, master) {
  let tengo = 0, de = 0;
  for (const c of cartas) {
    if (master) {
      for (const v of c.variantes) { de++; if (Guardado.cantidad(c.id, v) > 0) tengo++; }
    } else {
      de++;
      if (Guardado.total(c.id) > 0) tengo++;
    }
  }
  return { tengo, de };
}

/* ---------------------------------------------------------------------
 * Piezas comunes
 * ------------------------------------------------------------------- */

function pastillas(c) {
  return `<div class="pastillas">${c.variantes.map((v) => {
    const q = Guardado.cantidad(c.id, v);
    return `<span class="past${q ? " mia" : ""}" data-past="${esc(c.id)}|${v}">` +
      `<button type="button" data-accion="sumar" data-id="${esc(c.id)}" data-var="${v}" data-delta="1">` +
      `${NOMBRE_VARIANTE[v]}<span class="cuenta">${q || ""}</span></button>` +
      `<button type="button" class="menos" data-accion="sumar" data-id="${esc(c.id)}" data-var="${v}" data-delta="-1" aria-label="Quitar una ${NOMBRE_VARIANTE[v]}">&minus;</button></span>`;
  }).join("")}</div>`;
}

function refrescarPastillas(id) {
  const c = Cat.porId.get(id);
  for (const el of $$(`[data-past^="${CSS.escape(id)}|"]`)) {
    const v = el.dataset.past.split("|")[1];
    const q = Guardado.cantidad(id, v);
    el.classList.toggle("mia", q > 0);
    $(".cuenta", el).textContent = q || "";
  }
  for (const el of $$(`[data-estado="${CSS.escape(id)}"]`)) el.outerHTML = chipEstado(c);
  const res = $(".res");
  if (res && res.dataset.id === id) res.classList.toggle("falta", !Guardado.total(id));
}

function chipEstado(c) {
  const t = Guardado.total(c.id);
  return t ? `<span class="chip" data-estado="${esc(c.id)}">Ya la tienes${t > 1 ? " ×" + t : ""}</span>`
           : `<span class="chip falta" data-estado="${esc(c.id)}">Te falta</span>`;
}

const LUPA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

function buscador(marcador) {
  return `<div class="buscador">${LUPA}<input type="search" enterkeyhint="search" ` +
         `placeholder="${esc(marcador)}" data-filtro></div>`;
}

function dialogo(titulo, texto, botones) {
  return new Promise((resolver) => {
    const velo = document.createElement("div");
    velo.className = "velo";
    velo.innerHTML = `<div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="dlg-t">` +
      `<h3 id="dlg-t">${esc(titulo)}</h3><p>${esc(texto)}</p><div class="botones">` +
      botones.map((b, i) => `<button type="button" class="boton ${b.clase || ""}" data-i="${i}">${esc(b.texto)}</button>`).join("") +
      `</div></div>`;
    const cerrar = (valor) => { velo.remove(); resolver(valor); };
    velo.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (b) cerrar(botones[+b.dataset.i].valor);
      else if (e.target === velo) cerrar(null);
    });
    document.body.appendChild(velo);
    $("button", velo).focus();
  });
}

/* ---------------------------------------------------------------------
 * Escáner
 * ------------------------------------------------------------------- */

const Escaner = {
  trabajador: null, listo: false, stream: null, pista: null, video: null,
  activo: false, ocupado: false, fijado: false, previo: null, pedido: 0,
  ultimoMs: 0, fallos: 0, linterna: false,

  iniciarTrabajador() {
    if (this.trabajador) return;
    this.trabajador = new Worker("trabajador.js");
    this.trabajador.onmessage = (e) => this.alRecibir(e.data);
    this.trabajador.postMessage({ tipo: "indice",
      cartas: Cat.cartas.map((c) => [c.huella || "", c.grupo]) });
  },

  async encender() {
    this.video = $("#video");
    if (!this.video) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return this.sinCamara("La cámara solo funciona si abres la app con https:// (o en este mismo equipo con localhost).");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    } catch (e) {
      if (e.name === "NotAllowedError")
        return this.sinCamara("No tengo permiso para usar la cámara. Actívalo en los ajustes del navegador para esta web y recarga.");
      if (e.name === "NotFoundError" || e.name === "OverconstrainedError")
        return this.sinCamara("No encuentro ninguna cámara en este dispositivo.");
      return this.sinCamara("No he podido abrir la cámara: " + e.message);
    }
    if (!$("#video")) { this.apagar(); return; }   // te fuiste de la pestaña mientras tanto
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.pista = this.stream.getVideoTracks()[0];
    const cap = this.pista.getCapabilities ? this.pista.getCapabilities() : {};
    if (cap.torch) $("#linterna").hidden = false;
    this.activo = true;
    this.fijado = false;
    this.previo = null;
    this.estado("Encuadra la carta dentro del marco");
    this.bucle();
  },

  apagar() {
    this.activo = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.pista = null;
    this.linterna = false;
  },

  sinCamara(texto) {
    const visor = $(".visor");
    if (!visor) return;
    visor.insertAdjacentHTML("beforeend", `<div class="mensaje-visor"><p>${esc(texto)}</p>` +
      `<p>Mientras tanto, puedes usar <b>Subir foto</b>.</p></div>`);
  },

  estado(texto) { const el = $("#estado-visor"); if (el) el.textContent = texto; },

  marcar(clase) {
    const m = $(".marco");
    if (m) { m.classList.remove("casi", "fijado"); if (clase) m.classList.add(clase); }
  },

  /* Ajusta el tamaño del marco guía al hueco disponible. */
  dimensionar() {
    const visor = $(".visor"), marco = $(".marco");
    if (!visor || !marco) return;
    const W = visor.clientWidth, H = visor.clientHeight;
    let w = W * 0.66;
    if (w * 88 / 63 > H * 0.84) w = H * 0.84 * 63 / 88;
    marco.style.width = w + "px";
  },

  /* Rectángulo del marco guía en píxeles del vídeo. */
  guiaEnVideo() {
    const v = this.video, marco = $(".marco");
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh || !marco) return null;
    const ev = v.getBoundingClientRect(), em = marco.getBoundingClientRect();
    const escala = Math.max(ev.width / vw, ev.height / vh);   // object-fit: cover
    const ox = (ev.width - vw * escala) / 2, oy = (ev.height - vh * escala) / 2;
    return { x: (em.left - ev.left - ox) / escala, y: (em.top - ev.top - oy) / escala,
             w: em.width / escala, h: em.height / escala, vw, vh };
  },

  /* Recorta el marco (con margen) y lo deja a la escala de las referencias. */
  capturar(fuente, guia, anchoCarta, modo) {
    const f = anchoCarta / guia.w;
    const sx = guia.x - MARGEN_RECORTE * guia.w, sy = guia.y - MARGEN_RECORTE * guia.h;
    const sw = guia.w * (1 + 2 * MARGEN_RECORTE), sh = guia.h * (1 + 2 * MARGEN_RECORTE);
    const W = Math.round(sw * f), H = Math.round(sh * f);
    const lienzo = this.lienzo || (this.lienzo = document.createElement("canvas"));
    lienzo.width = W; lienzo.height = H;
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, W, H);
    // Solo la parte que cae dentro de la imagen: fuera de ella, gris.
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    const x1 = Math.min(guia.vw, sx + sw), y1 = Math.min(guia.vh, sy + sh);
    if (x1 > x0 && y1 > y0)
      ctx.drawImage(fuente, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * f, (y0 - sy) * f, (x1 - x0) * f, (y1 - y0) * f);
    const gris = Huella.aGris(ctx.getImageData(0, 0, W, H).data, W * H);
    return { gris, ancho: W, alto: H, modo,
             guia: { x: MARGEN_RECORTE * guia.w * f, y: MARGEN_RECORTE * guia.h * f, w: guia.w * f, h: guia.h * f } };
  },

  enviar(datos, manual) {
    this.ocupado = true;
    this.pedido++;
    this.manual = manual ? this.pedido : this.manual;
    this.trabajador.postMessage({ tipo: "analizar", id: this.pedido, gris: datos.gris.buffer,
      ancho: datos.ancho, alto: datos.alto, guia: datos.guia, modo: datos.modo }, [datos.gris.buffer]);
  },

  bucle() {
    if (!this.activo || this.fijado || this.ocupado || document.hidden) return;
    const guia = this.guiaEnVideo();
    if (!guia || this.video.readyState < 2) { setTimeout(() => this.bucle(), 150); return; }
    this.enviar(this.capturar(this.video, guia, ANCHO_CARTA, "camara"), false);
  },

  disparar() {
    if (!this.activo || !this.video) return;
    const guia = this.guiaEnVideo();
    if (!guia) return;
    this.fijado = false;
    if (this.ocupado) { this.pendienteManual = true; return; }
    this.enviar(this.capturar(this.video, guia, ANCHO_CARTA, "camara"), true);
  },

  async foto(archivo) {
    let img;
    try {
      img = await createImageBitmap(archivo, { imageOrientation: "from-image" });
    } catch (e) {
      try {
        img = await createImageBitmap(archivo);
      } catch (e2) {
        aviso("No puedo leer esa imagen.");
        return;
      }
    }
    // La carta puede estar en cualquier sitio: tomamos como guía el mayor
    // rectángulo con forma de carta y el análisis prueba tamaños menores.
    const r = 63 / 88;
    let gw = img.width, gh = gw / r;
    if (gh > img.height) { gh = img.height; gw = gh * r; }
    const guia = { x: (img.width - gw) / 2, y: (img.height - gh) / 2, w: gw, h: gh,
                   vw: img.width, vh: img.height };
    this.fijado = true;
    this.estado("Analizando la foto…");
    const datos = this.capturar(img, guia, ANCHO_CARTA / 0.62, "foto");
    if (this.ocupado) { this.fotoPendiente = datos; return; }
    this.enviar(datos, true);
  },

  alRecibir(m) {
    if (m.tipo === "listo") { this.listo = true; return; }
    if (m.tipo !== "resultado") return;
    this.ocupado = false;
    this.ultimoMs = m.ms;
    if (this.fotoPendiente) { const d = this.fotoPendiente; this.fotoPendiente = null; this.enviar(d, true); return; }
    if (this.pendienteManual) { this.pendienteManual = false; this.disparar(); return; }
    const res = m.res;
    if (!$("#estado-visor")) return;            // ya no estás en el escáner
    if (m.error) { this.estado("Error: " + m.error); return; }
    const manual = m.id === this.manual;

    if (!res) {
      this.estado("El catálogo no tiene cartas reconocibles");
      return;
    }
    // Aceptamos al momento si es "seguro", o si dos análisis seguidos
    // apuntan a la misma ilustración con un margen decente.
    const dos = this.previo && this.previo.grupo === res.grupo &&
                this.previo.margen >= MARGEN_DOS_SEGUIDAS && res.margen >= MARGEN_DOS_SEGUIDAS &&
                res.dist <= Reconocer_UMBRAL_DIST;
    this.previo = res;
    const acierto = res.veredicto === "seguro" || dos;
    // Tras "Escanear otra", la carta anterior suele seguir delante un
    // momento: no la volvemos a dar hasta que deje de verse.
    if (this.ignorar != null && !manual) {
      if (acierto && res.grupo === this.ignorar) {
        this.estado("Pon la siguiente carta");
        requestAnimationFrame(() => this.bucle());
        return;
      }
      if (res.grupo !== this.ignorar || res.veredicto === "nada") this.ignorar = null;
    }
    if (acierto) {
      this.fijar(res);
      return;
    }
    if (manual) {
      this.fijado = true;
      this.marcar(null);
      res.modo = m.modo;
      mostrarDudas(res);
      return;
    }
    if (res.veredicto === "dudoso") { this.estado("Casi… mantén la carta quieta"); this.marcar("casi"); }
    else { this.fallos++; this.estado(this.fallos > 6 ? "Acerca la carta y evita reflejos" : "Encuadra la carta dentro del marco"); this.marcar(null); }
    requestAnimationFrame(() => this.bucle());
  },

  /* Con un resultado en pantalla el visor se encoge para que se vea entero. */
  plegar(si) {
    const e = $(".escaner");
    if (!e) return;
    e.classList.toggle("con-resultado", si);
    this.dimensionar();
  },

  fijar(res) {
    this.fijado = true;
    this.fallos = 0;
    this.marcar("fijado");
    if (navigator.vibrate) navigator.vibrate(25);
    const mismas = res.mismas.map((i) => Cat.cartas[i]).filter(Boolean);
    if (mismas.length > 1) mostrarEleccion(mismas, res);
    else mostrarResultado(Cat.cartas[res.lista[0].carta], res);
  },

  seguir() {
    this.ignorar = this.ultimo ? this.ultimo.grupo : null;
    this.fijado = false;
    this.previo = null;
    this.marcar(null);
    $("#resultado").innerHTML = "";
    this.plegar(false);
    this.estado("Encuadra la carta dentro del marco");
    this.bucle();
  },

  async alternarLinterna() {
    if (!this.pista) return;
    this.linterna = !this.linterna;
    try {
      await this.pista.applyConstraints({ advanced: [{ torch: this.linterna }] });
    } catch (e) { this.linterna = false; }
    $("#linterna").classList.toggle("encendida", this.linterna);
  },
};
// El trabajador decide el veredicto; esto solo hace falta para la regla de dos seguidas.
const Reconocer_UMBRAL_DIST = 96;

function textoDiag(res) {
  return `<p class="diag">distancia ${res.dist} · margen ${res.margen} · ${Escaner.ultimoMs} ms</p>`;
}

function mostrarResultado(c, res) {
  const zona = $("#resultado");
  if (!zona) return;
  Escaner.plegar(true);
  Escaner.estado(c.nombre);
  zona.innerHTML = `<div class="res${Guardado.total(c.id) ? "" : " falta"}" data-id="${esc(c.id)}">` +
    `<a href="#/carta/${encodeURIComponent(c.id)}">${imgCarta(c)}</a><div>` +
    chipEstado(c) +
    `<h2>${esc(c.nombre)}</h2><p>${esc(c.set.nombre)} · ${esc(numeroCompleto(c))}</p>` +
    (res ? textoDiag(res) : "") + `</div></div>` + pastillas(c) +
    `<div class="botones"><button type="button" class="boton" data-accion="no-es">No es esta</button>` +
    `<button type="button" class="boton pri" data-accion="seguir">Escanear otra</button></div>`;
  Escaner.ultimo = res;
}

/* Misma ilustración en varias cartas: hay que elegir cuál es. */
function mostrarEleccion(cartas, res) {
  const zona = $("#resultado");
  if (!zona) return;
  Escaner.plegar(true);
  Escaner.estado("Misma ilustración en " + cartas.length + " cartas");
  zona.innerHTML = `<p class="titular">¿Cuál de estas es?<small>La ilustración es la misma; ` +
    `mira el símbolo y el número de la esquina inferior.</small></p>` +
    cartas.map((c) => opcion(c)).join("") +
    `<div class="botones"><button type="button" class="boton" data-accion="seguir">Ninguna, seguir</button></div>`;
  Escaner.ultimo = res;
}

function opcion(c) {
  return `<button type="button" class="opcion" data-accion="elegir" data-id="${esc(c.id)}">` +
    `${imgCarta(c)}<span><b>${esc(c.nombre)}</b><small>${esc(c.set.nombre)} · ${esc(numeroCompleto(c))}` +
    `${c.set.fecha ? " · " + c.set.fecha.slice(0, 4) : ""}</small></span>${chipEstado(c)}</button>`;
}

/* Disparo manual sin acierto claro: enseñamos las mejores candidatas. */
function mostrarDudas(res) {
  const zona = $("#resultado");
  if (!zona) return;
  Escaner.plegar(true);
  const vistas = new Set(), cartas = [];
  for (const x of res.lista) {
    const g = Cat.cartas[x.carta];
    for (const c of (Cat.porGrupo.get(g.grupo) || [g]))
      if (!vistas.has(c.id)) { vistas.add(c.id); cartas.push(c); }
  }
  Escaner.estado(res.veredicto === "dudoso" ? "No estoy seguro" : "No la reconozco");
  zona.innerHTML = `<p class="titular">${res.veredicto === "dudoso" ? "¿Es alguna de estas?" : "No la reconozco"}` +
    `<small>${res.veredicto === "dudoso" ? "Elige la buena o vuelve a intentarlo." :
      (res.modo === "foto" ? "Haz la foto más de cerca, que la carta ocupe casi toda la imagen. " :
       "Puede que no esté en tu catálogo, o que no la capte bien. ") + "Estas son las más parecidas:"}</small></p>` +
    cartas.slice(0, 5).map(opcion).join("") + textoDiag(res) +
    `<div class="botones"><button type="button" class="boton pri" data-accion="seguir">Volver a intentarlo</button></div>`;
}

function vistaEscaner() {
  if (!Cat.listo) return vistaSinIndice();
  Escaner.iniciarTrabajador();
  $("#vista").innerHTML = `<section class="escaner">
    <div class="visor">
      <video id="video" playsinline muted autoplay></video>
      <div class="marco"><i></i><i></i><i></i><i></i><div class="zona"></div></div>
      <div class="estado-visor" id="estado-visor">Abriendo la cámara…</div>
    </div>
    <div class="mandos">
      <label class="redondo" aria-label="Subir una foto">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>
        <input type="file" accept="image/*" id="subir-foto">
      </label>
      <button type="button" class="disparador" data-accion="disparar" aria-label="Analizar ahora"><span></span></button>
      <button type="button" class="redondo" id="linterna" data-accion="linterna" aria-label="Linterna" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6h4l-8 12 2-9H8z"/></svg>
      </button>
    </div>
    <div class="resultado" id="resultado"></div>
  </section>`;
  Escaner.dimensionar();
  $("#subir-foto").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) Escaner.foto(f);
    e.target.value = "";
  });
  Escaner.encender();
}

/* ---------------------------------------------------------------------
 * Inicio
 * ------------------------------------------------------------------- */

const ICONO = {
  escanear: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8.5" y="7" width="7" height="10" rx="1"/>',
  coleccion: '<rect x="3" y="4" width="5" height="7" rx="1"/><rect x="9.5" y="4" width="5" height="7" rx="1"/><rect x="16" y="4" width="5" height="7" rx="1"/><rect x="3" y="13" width="5" height="7" rx="1"/><rect x="9.5" y="13" width="5" height="7" rx="1"/><rect x="16" y="13" width="5" height="7" rx="1"/>',
  mazos: '<rect x="7" y="3" width="11" height="15" rx="1.5"/><path d="M5 6.5v12A2.5 2.5 0 0 0 7.5 21H15"/>',
  ajustes: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  flecha: '<path d="M9 6l6 6-6 6"/>',
};
const svgIcono = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONO[n]}</svg>`;

/* Cada letra en su <span> para que el título ondee letra a letra. */
function letras(texto, clase, desde = 0) {
  return [...texto].map((l, i) =>
    `<span class="letra ${clase}" style="--i:${desde + i}" aria-hidden="true">${esc(l)}</span>`).join("");
}

function vistaInicio() {
  const distintas = Object.keys(Guardado.todo).filter((id) => Guardado.total(id) > 0).length;
  const mazos = Guardado.mazos;
  const sinCopia = Guardado.cambios > 0 && distintas > 0;
  const nSets = Cat.listo ? Cat.sets.filter((s) => s.completo && !Guardado.oculto("set:" + s.id)).length : 0;

  $("#vista").innerHTML = `<div class="pagina inicio">
    <header class="inicio-cabeza">
      <div class="flota"><img src="iconos/icono.svg" alt="" width="112" height="112"></div>
      <span class="flota-sombra" aria-hidden="true"></span>
      <h1 class="marca-grande" aria-label="MiPokedex">${letras("Mi", "")}${letras("Pokedex", "acento", 2)}</h1>
    </header>

    <div class="inicio-bloque">
    <div class="resumen">
      <div><b>${distintas}</b><span>${distintas === 1 ? "carta tuya" : "cartas tuyas"}</span></div>
      <div><b>${nSets}</b><span>${nSets === 1 ? "set" : "sets"}</span></div>
      <div><b>${mazos.length}</b><span>${mazos.length === 1 ? "mazo" : "mazos"}</span></div>
    </div>

    <a class="accion-grande" href="#/escanear">
      <span class="accion-icono">${svgIcono("escanear")}</span>
      <span><b>Escanear una carta</b><small>Apunta con la cámara y te dice si la tienes</small></span>
      ${svgIcono("flecha")}
    </a>

    <div class="accesos">
      <a class="acceso" href="#/sets">${svgIcono("coleccion")}<b>Mi colección</b><small>Sets, Pokémon e ilustradores</small></a>
      <a class="acceso" href="#/mazos">${svgIcono("mazos")}<b>Mazos</b><small>${mazos.length ? `${mazos.length} en marcha` : "Pega una lista y llévala al día"}</small></a>
    </div>
    </div>

    ${sinCopia ? `<a class="aviso-copia" href="#/ajustes">${svgIcono("ajustes")}<span><b>Tienes cambios sin copia de seguridad</b>
      <small>${Guardado.copia ? "Última copia " + hace(Guardado.copia) : "Aún no has hecho ninguna"}. Guárdala en Ajustes.</small></span></a>` : ""}
    ${!Cat.listo && Cat.error === "sin-indice" ? `<p class="pie">Aún no hay catálogo: crea <code>indice.json</code> con el generador para poder escanear y ver tus sets.</p>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------------
 * Colección
 * ------------------------------------------------------------------- */

/* Selector de arriba: Sets · Pokémon · Ilustradores */
function segmento(aqui) {
  const op = [["sets", "Sets"], ["pokemon", "Pokémon"], ["ilustradores", "Ilustradores"]];
  return `<nav class="segmento" aria-label="Ver la colección por">` +
    op.map(([r, t]) => `<a href="#/${r}"${r === aqui ? ' class="aqui" aria-current="page"' : ""}>${t}</a>`).join("") +
    `</nav>`;
}

function tomoProgreso(cartas, claveMaster) {
  const master = Guardado.esMaster(claveMaster);
  const { tengo, de } = progreso(cartas, master);
  return { master, tengo, de, pct: de ? (100 * tengo / de).toFixed(1) : 0 };
}

const PAPELERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14"/><path d="M10 10v7M14 10v7"/></svg>';

/* Fila de abajo de cada tomo: el interruptor de variantes y la papelera. */
function accionesTomo(claveMaster, master, claveOculto, nombre) {
  return `<div class="acciones">${conmutador(claveMaster, master)}` +
    (claveOculto ? `<button type="button" class="tirar" data-accion="ocultar" data-clave="${esc(claveOculto)}" ` +
      `data-nombre="${esc(nombre)}" title="Quitar de la lista" aria-label="Quitar ${esc(nombre)} de la lista">${PAPELERA}</button>` : "") +
    `</div>`;
}

/* Lo que has quitado de una lista, plegado al final, para poder recuperarlo. */
function listaOcultos(prefijo, nombreDe, que) {
  const ocultos = Guardado.ocultos.filter((k) => k.startsWith(prefijo))
    .map((k) => ({ clave: k, nombre: nombreDe(k.slice(prefijo.length)) })).filter((x) => x.nombre);
  if (!ocultos.length) return "";
  return `<details class="ocultos"><summary>${ocultos.length} ${que} quitado${ocultos.length > 1 ? "s" : ""} de la lista</summary>` +
    ocultos.map((x) => `<div class="oculto"><span>${esc(x.nombre)}</span>` +
      `<button type="button" class="boton" data-accion="desocultar" data-clave="${esc(x.clave)}">Volver a mostrar</button></div>`).join("") +
    `</details>`;
}

function conmutador(clave, master, texto = "Contar reverses y holos aparte") {
  return `<label class="conm"><input type="checkbox" data-master="${esc(clave)}"${master ? " checked" : ""}> ${texto}</label>`;
}

function vistaSets() {
  if (!Cat.listo) return vistaSinIndice();
  const distintas = Object.keys(Guardado.todo).filter((id) => Guardado.total(id) > 0).length;
  const copias = Object.keys(Guardado.todo).reduce((s, id) => s + Guardado.total(id), 0);
  // Solo los sets que sigues enteros. Las cartas sueltas (de seguir un
  // Pokémon o un ilustrador) se ven en sus pestañas.
  const completos = Cat.sets.filter((s) => s.completo && !Guardado.oculto("set:" + s.id));

  const tomo = (s) => {
    const cartas = Cat.porSet.get(s.id) || [];
    const p = tomoProgreso(cartas, s.id);
    const nota = s.total && cartas.length < s.total
      ? `<p class="nota">${s.total - cartas.length} cartas aún no están en TCGdex</p>` : "";
    return `<div class="tomo" data-busca="${esc(normaliza(s.nombre + " " + s.id + " " + (s.serie || "")))}">` +
      `<a href="#/set/${encodeURIComponent(s.id)}"><div class="fila"><h3>${esc(s.nombre)}` +
      `<small>${esc([s.serie, s.fecha && s.fecha.slice(0, 4)].filter(Boolean).join(" · "))}</small></h3>` +
      `<span class="cifra">${p.tengo}<span>/${p.de}</span></span></div>` +
      `<div class="linea"><i style="width:${p.pct}%"></i></div>${nota}</a>` +
      accionesTomo(s.id, p.master, "set:" + s.id, s.nombre) + `</div>`;
  };

  $("#vista").innerHTML = `<div class="pagina"><h1>Tu colección</h1>${segmento("sets")}
    <div class="resumen"><div><b>${distintas}</b><span>cartas distintas</span></div>
    <div><b>${copias}</b><span>copias en total</span></div></div>
    ${completos.length ? buscador("Buscar un set") : ""}
    ${completos.map(tomo).reverse().join("") || `<p class="vacio">Aún no sigues ningún set entero.</p>`}
    <p class="sinnada" id="sin-nada">Ningún set con ese nombre.</p>
    ${listaOcultos("set:", (id) => (Cat.sets.find((s) => s.id === id && s.completo) || {}).nombre, "set")}
    <p class="pie">Para añadir sets, ejecuta en el PC <code>python generar_indice.py --sets ID</code> y vuelve a publicar la carpeta app.</p></div>`;
}

/* --- Pokémon e ilustradores: una lista de los que sigues y, al buscar,
 *     también los demás que haya en tu catálogo. ------------------------- */

function nombrePokemon(dex) {
  const seguido = Cat.pokemon.find((p) => p.dex === dex);
  if (seguido) return seguido.nombre;
  // El nombre más corto, sin contar las cartas dobles ("Mewtwo & Mew GX").
  const cartas = Cat.porDex.get(dex) || [];
  const solas = cartas.filter((c) => c.dexs.length === 1);
  return (solas.length ? solas : cartas)
    .reduce((a, c) => (!a || c.nombre.length < a.length ? c.nombre : a), "");
}

/* Portada: la primera carta que tengas; si no, la más reciente. */
function portada(cartas) {
  return cartas.find((c) => Guardado.total(c.id) > 0 && c.imagen) ||
         [...cartas].reverse().find((c) => c.imagen) || cartas[0];
}

function nSets(cartas) { return new Set(cartas.map((c) => c.set.id)).size; }

function tomoGrupo({ href, titulo, sub, cartas, clave, busca, quitar, nombre }) {
  const p = tomoProgreso(cartas, clave);
  return `<div class="tomo" data-busca="${esc(normaliza(busca))}">` +
    `<a href="${href}"><div class="fila">${imgCarta(portada(cartas))}` +
    `<h3>${titulo}<small>${esc(sub)}</small></h3>` +
    `<span class="cifra">${p.tengo}<span>/${p.de}</span></span></div>` +
    `<div class="linea"><i style="width:${p.pct}%"></i></div></a>` +
    accionesTomo(clave, p.master, quitar ? clave : null, nombre) + `</div>`;
}

function filaPokemon(dex, quitar = false) {
  const cartas = Cat.porDex.get(dex) || [];
  const nombre = nombrePokemon(dex);
  return tomoGrupo({ href: `#/pokemon/${dex}`, cartas, clave: "dex:" + dex, quitar, nombre,
    titulo: `${esc(nombre)}<span class="dex">N.º ${dex}</span>`,
    sub: `${cartas.length} cartas · ${nSets(cartas)} sets`, busca: `${nombre} ${dex}` });
}

function filaIlustrador(nombre, quitar = false) {
  const cartas = Cat.porIlustrador.get(nombre) || [];
  return tomoGrupo({ href: `#/ilustrador/${encodeURIComponent(nombre)}`, cartas, clave: "ilu:" + nombre, quitar, nombre,
    titulo: esc(nombre), sub: `${cartas.length} cartas · ${nSets(cartas)} sets`, busca: nombre });
}

/* Al escribir en el buscador, además de filtrar los seguidos, enseña los
 * demás que coinciden en tu catálogo. */
function buscarOtros(q, todos, seguidos, fila) {
  const zona = $("#otros");
  if (!zona) return 0;
  if (q.length < 2) { zona.innerHTML = ""; return 0; }
  const hallados = todos.filter((x) => !seguidos.has(x.clave) && x.busca.includes(q)).slice(0, 20);
  zona.innerHTML = hallados.length
    ? `<h2>En tu catálogo</h2><p class="sub">Solo con las cartas que ya tienes en el catálogo.</p>` +
      hallados.map((x) => fila(x.clave, false)).join("") : "";
  return hallados.length;
}

function vistaListaPokemon() {
  if (!Cat.listo) return vistaSinIndice();
  const lista = Cat.pokemon.filter((p) => !Guardado.oculto("dex:" + p.dex));
  const seguidos = new Set(lista.map((p) => p.dex));
  const todos = [...Cat.porDex.keys()].sort((a, b) => a - b)
    .map((d) => ({ clave: d, busca: normaliza(nombrePokemon(d) + " " + d) }));
  $("#vista").innerHTML = `<div class="pagina"><h1>Tu colección</h1>${segmento("pokemon")}
    ${buscador("Buscar un Pokémon o su número")}
    ${lista.map((p) => filaPokemon(p.dex, true)).join("") ||
      `<p class="vacio">Aún no sigues a ningún Pokémon. Busca arriba entre los de tu catálogo,
       o tráete todas las cartas de uno desde el PC (mira abajo).</p>`}
    <div id="otros"></div>
    <p class="sinnada" id="sin-nada">Ningún Pokémon con ese nombre en tu catálogo.</p>
    ${listaOcultos("dex:", (d) => Cat.porDex.has(+d) ? nombrePokemon(+d) : "", "Pokémon")}
    <p class="pie">Para tener <b>todas</b> las cartas de un Pokémon, de cualquier set y año, ejecuta en el PC
    <code>python generar_indice.py --pokemon nombre</code> y vuelve a subir <code>indice.json</code>.</p></div>`;
  alFiltrar = (q) => buscarOtros(q, todos, seguidos, filaPokemon);
}

function vistaListaIlustradores() {
  if (!Cat.listo) return vistaSinIndice();
  const lista = Cat.ilustradores.filter((n) => !Guardado.oculto("ilu:" + n));
  const seguidos = new Set(lista);
  const todos = [...Cat.porIlustrador.keys()].sort((a, b) => a.localeCompare(b, "es"))
    .map((n) => ({ clave: n, busca: normaliza(n) }));
  $("#vista").innerHTML = `<div class="pagina"><h1>Tu colección</h1>${segmento("ilustradores")}
    ${buscador("Buscar un ilustrador")}
    ${lista.map((n) => filaIlustrador(n, true)).join("") ||
      `<p class="vacio">Aún no sigues a ningún ilustrador. Busca arriba entre los de tu catálogo,
       o tráete todas sus cartas desde el PC (mira abajo).</p>`}
    <div id="otros"></div>
    <p class="sinnada" id="sin-nada">Ningún ilustrador con ese nombre en tu catálogo.</p>
    ${listaOcultos("ilu:", (n) => Cat.porIlustrador.has(n) ? n : "", "ilustrador")}
    <p class="pie">Para tener <b>todas</b> las cartas de un ilustrador, ejecuta en el PC
    <code>python generar_indice.py --ilustrador "Nombre Apellido"</code> y vuelve a subir <code>indice.json</code>.</p></div>`;
  alFiltrar = (q) => buscarOtros(q, todos, seguidos, filaIlustrador);
}

/* --- Hojas de archivador: la de un set y la de un Pokémon o ilustrador -- */

// Lo que se ve ahora en la hoja, para recontar al marcar una casilla.
let Hoja = null;
let ordenReciente = false;
try { ordenReciente = localStorage.getItem("mipokedex.orden") === "reciente"; } catch (e) {}

function pintarHoja(cartas, clave, conSet) {
  const master = Guardado.esMaster(clave);
  const huecos = [];
  for (const c of cartas) {
    const pie = conSet ? `${c.set.codigo || c.set.id} ${c.numero}` : c.numero;
    if (master) for (const v of c.variantes) huecos.push(hueco(c, v, true, pie));
    else huecos.push(hueco(c, null, false, pie));
  }
  Hoja = { cartas, clave };
  return huecos.join("");
}

function vistaSet(id) {
  if (!Cat.listo) return vistaSinIndice();
  const s = Cat.sets.find((x) => x.id === id);
  if (!s) { location.hash = "#/sets"; return; }
  const cartas = Cat.porSet.get(id) || [];
  const { tengo, de, master } = tomoProgreso(cartas, id);
  $("#vista").innerHTML = `<div class="pagina">
    <a class="volver" href="#/sets">‹ Sets</a>
    <h1>${esc(s.nombre)}</h1>
    <div class="cabeza-set"><span class="cifra"><b id="cuenta">${tengo}</b><span>/${de}</span></span>
    ${conmutador(id, master, "Reverses aparte")}</div>
    ${buscador("Buscar por nombre o número")}
    <div class="hoja">${pintarHoja(cartas, id, false)}</div>
    <p class="sinnada" id="sin-nada">Ninguna carta con ese nombre en este set.</p>
    <p class="pie">Toca una carta para marcarla. Mantén pulsado para ver su ficha.</p></div>`;
}

/* Cartas de varios sets. El catálogo ya viene ordenado por fecha de salida
 * del set y número; "más recientes" invierte el orden de los sets pero
 * mantiene el de las cartas dentro de cada uno. */
function ordenar(cartas) {
  const out = [...cartas];
  if (ordenReciente) out.sort((a, b) => (b.set.i - a.set.i) || (a.i - b.i));
  return out;
}

function vistaGrupo({ volver, volverTexto, titulo, cartas, clave, seguido, comando }) {
  const lista = ordenar(cartas);
  const { tengo, de, master } = tomoProgreso(lista, clave);
  $("#vista").innerHTML = `<div class="pagina">
    <a class="volver" href="${volver}">‹ ${volverTexto}</a>
    <h1>${titulo}</h1>
    <p class="sub">${cartas.length} cartas en ${nSets(cartas)} sets</p>
    <div class="cabeza-set"><span class="cifra"><b id="cuenta">${tengo}</b><span>/${de}</span></span>
    ${conmutador(clave, master, "Reverses aparte")}</div>
    <div class="orden" role="group" aria-label="Orden">
      <button type="button" data-accion="orden" data-v="antiguas"${ordenReciente ? "" : ' class="activo"'}>Más antiguas primero</button>
      <button type="button" data-accion="orden" data-v="reciente"${ordenReciente ? ' class="activo"' : ""}>Más recientes primero</button>
    </div>
    ${buscador("Buscar por nombre, set o año")}
    <div class="hoja">${pintarHoja(lista, clave, true)}</div>
    <p class="sinnada" id="sin-nada">Ninguna carta con ese nombre.</p>
    ${seguido ? "" : `<p class="pie">Solo salen las cartas de tu catálogo. Para tenerlas todas, ejecuta en el PC
      <code>${esc(comando)}</code> y vuelve a subir <code>indice.json</code>.</p>`}
    <p class="pie">Toca una carta para marcarla. Mantén pulsado para ver su ficha.</p></div>`;
}

function vistaPokemon(dex) {
  if (!Cat.listo) return vistaSinIndice();
  dex = Number(dex);
  const cartas = Cat.porDex.get(dex);
  if (!cartas) { location.hash = "#/pokemon"; return; }
  const nombre = nombrePokemon(dex);
  vistaGrupo({ volver: "#/pokemon", volverTexto: "Pokémon", cartas, clave: "dex:" + dex,
    titulo: `${esc(nombre)}<span class="dex">N.º ${dex}</span>`,
    seguido: Cat.pokemon.some((p) => p.dex === dex),
    comando: `python generar_indice.py --pokemon ${normaliza(nombre).split(" ")[0]}` });
}

function vistaIlustrador(nombre) {
  if (!Cat.listo) return vistaSinIndice();
  const cartas = Cat.porIlustrador.get(nombre);
  if (!cartas) { location.hash = "#/ilustradores"; return; }
  vistaGrupo({ volver: "#/ilustradores", volverTexto: "Ilustradores", cartas, clave: "ilu:" + nombre,
    titulo: esc(nombre), seguido: Cat.ilustradores.includes(nombre),
    comando: `python generar_indice.py --ilustrador "${nombre}"` });
}

/* Casilla del archivador. variante null = la carta sin distinguir variantes. */
function hueco(c, variante, conEtiqueta, pie = c.numero) {
  const q = variante ? Guardado.cantidad(c.id, variante) : Guardado.total(c.id);
  const etiqueta = conEtiqueta && variante ? ETIQUETA_VARIANTE[variante] : "";
  const busca = [c.nombre, c.numero, etiqueta, c.set.nombre, c.set.codigo, (c.set.fecha || "").slice(0, 4)].join(" ");
  return `<div class="hueco${q ? " mia" : ""}" role="button" tabindex="0" data-hueco="${esc(c.id)}"` +
    ` data-var="${variante || ""}" data-pie="${esc(pie)}" data-busca="${esc(normaliza(busca))}"` +
    ` title="${esc(c.nombre)}">${imgCarta(c)}<span class="titulo">${esc(c.nombre)}</span>` +
    (etiqueta ? `<em>${etiqueta}</em>` : "") + `<b>${esc(pie)}</b>` +
    (q > 1 ? `<span class="num">×${q}</span>` : "") + `</div>`;
}

/* Toque en una casilla: 0 -> 1 y 1 -> 0. Con más de una copia no se toca
 * nada (sería fácil perderlas de un toque sin querer): se abre la ficha. */
function tocarHueco(el) {
  const c = Cat.porId.get(el.dataset.hueco);
  if (!c) return;
  const v = el.dataset.var;
  if (v) {
    const q = Guardado.cantidad(c.id, v);
    if (q > 1) return abrirFichaPorCopias(c, q);
    Guardado.poner(c.id, v, q ? 0 : 1);
  } else {
    const t = Guardado.total(c.id);
    if (t > 1) return abrirFichaPorCopias(c, t);
    if (t === 1) {
      const [vv] = Object.keys(Guardado.de(c.id));
      Guardado.poner(c.id, vv, 0);
    } else {
      Guardado.poner(c.id, c.variantes.includes("normal") ? "normal" : c.variantes[0], 1);
    }
  }
  const nuevo = document.createElement("div");
  nuevo.innerHTML = hueco(c, v || null, !!v, el.dataset.pie);
  const n = nuevo.firstChild;
  n.style.display = el.style.display;
  el.replaceWith(n);
  if (n.classList.contains("mia")) n.classList.add("encaja");
  if (Hoja && $("#cuenta"))
    $("#cuenta").textContent = progreso(Hoja.cartas, Guardado.esMaster(Hoja.clave)).tengo;
}

async function quitarDeLista(clave, nombre) {
  const si = await dialogo(`¿Quitar «${nombre}» de la lista?`,
    "Deja de aparecer aquí, pero tus cartas marcadas se conservan. Si te equivocas, " +
    "lo recuperas al final de la lista, en «quitados de la lista».",
    [{ texto: "Sí, quitarlo", valor: true, clase: "peligro" }, { texto: "Cancelar", valor: false }]);
  if (!si) return;
  Guardado.ocultar(clave, true);
  aviso(`«${nombre}» quitado de la lista`);
  mostrar();
}

function abrirFichaPorCopias(c, q) {
  aviso(`Tienes ${q}: ajústalas en la ficha`);
  location.hash = "#/carta/" + encodeURIComponent(c.id);
}

/* ---------------------------------------------------------------------
 * Ficha de una carta
 * ------------------------------------------------------------------- */

function vistaCarta(id) {
  if (!Cat.listo) return vistaSinIndice();
  const c = Cat.porId.get(id);
  if (!c) { location.hash = "#/sets"; return; }
  const dato = (et, val) => val ? `<div class="dato"><span>${et}</span><div>${val}</div></div>` : "";
  const otras = c.huella ? (Cat.porGrupo.get(c.grupo) || []).filter((x) => x.id !== c.id) : [];
  $("#vista").innerHTML = `<div class="pagina">
    <button type="button" class="volver" data-accion="volver" data-href="#/set/${encodeURIComponent(c.set.id)}">‹ Volver</button>
    <div class="ficha">${imgCarta(c, "high", 'loading="eager"')}<div>
      <h1>${esc(c.nombre)}</h1><p class="de">${esc(c.set.nombre)}${c.set.fecha ? ", " + c.set.fecha.slice(0, 4) : ""}</p>
      <div style="margin-top:.7rem">${chipEstado(c)}</div></div></div>
    ${pastillas(c)}
    <h2>Datos</h2><div class="datos">
      ${dato("Número", esc(numeroCompleto(c)))}
      ${dato("Rareza", esc(c.rareza))}
      ${dato("Tipo", c.tipos.map((t) => `<span class="tipo">${esc(t)}</span>`).join(""))}
      ${dato("Puntos de salud", c.hp || "")}
      ${dato("Pokédex", c.dexs.map((d) => `<a class="enlace" href="#/pokemon/${d}">N.º ${d} · ${esc(nombrePokemon(d))}</a>`).join("<br>"))}
      ${dato("Ilustración", c.ilustrador ? `<a class="enlace" href="#/ilustrador/${encodeURIComponent(c.ilustrador)}">${esc(c.ilustrador)}</a>` : "")}
      ${dato("Set", `<a class="enlace" href="#/set/${encodeURIComponent(c.set.id)}">${esc(c.set.nombre)}</a>`)}
      ${dato("Salida", esc(fechaLarga(c.set.fecha)))}
      ${dato("Reconocible", c.huella ? "Sí, con la cámara" : "No: TCGdex no tiene su imagen")}
    </div>
    ${otras.length ? `<h2>Misma ilustración</h2>${otras.map(opcionEnlace).join("")}` : ""}</div>`;
}

function opcionEnlace(c) {
  return `<a class="opcion" href="#/carta/${encodeURIComponent(c.id)}">${imgCarta(c)}` +
    `<span><b>${esc(c.nombre)}</b><small>${esc(c.set.nombre)} · ${esc(numeroCompleto(c))}</small></span>${chipEstado(c)}</a>`;
}

/* ---------------------------------------------------------------------
 * Ajustes y copia de seguridad
 * ------------------------------------------------------------------- */

function vistaAjustes() {
  const copia = Guardado.copia;
  const sinCopia = Guardado.cambios > 0;
  $("#vista").innerHTML = `<div class="pagina"><h1>Ajustes</h1>
    <div class="bloque${sinCopia && Object.keys(Guardado.todo).length ? " alerta" : ""}">
      <h3>Copia de seguridad</h3>
      <p>Tu colección se guarda en este navegador. Si borras sus datos o cambias de móvil, se pierde:
      saca una copia de vez en cuando y guárdala en tu nube o mándatela.
      ${copia ? `<br>Última copia: <b>${hace(copia)}</b>${sinCopia ? ", y has hecho cambios desde entonces." : "."}` : "<br><b>Aún no has hecho ninguna.</b>"}</p>
      <div class="botones"><button type="button" class="boton pri" data-accion="exportar">Guardar copia</button>
      <label class="boton" style="position:relative">Recuperar copia<input type="file" accept=".json,application/json" id="importar" style="position:absolute;inset:0;opacity:0"></label></div>
    </div>
    <div class="bloque"><h3>Catálogo</h3>
      ${Cat.listo ? `<dl class="lista-datos">
        <dt>Cartas</dt><dd>${Cat.cartas.length}</dd>
        <dt>Reconocibles con la cámara</dt><dd>${Cat.reconocibles}</dd>
        <dt>Sets completos</dt><dd>${Cat.sets.filter((s) => s.completo).length}</dd>
        <dt>Pokémon seguidos</dt><dd>${Cat.pokemon.length}</dd>
        <dt>Ilustradores seguidos</dt><dd>${Cat.ilustradores.length}</dd>
        <dt>Generado</dt><dd>${esc(Cat.generado ? new Date(Cat.generado).toLocaleDateString("es-ES") : "?")}</dd></dl>`
      : `<p>Aún no hay catálogo.</p>`}
    </div>
    <div class="bloque"><h3>Instalar en el móvil</h3>
      <p>Para abrirla como una app más, sin barra del navegador: en Android, menú ⋮ → <b>Añadir a pantalla de inicio</b>.
      En iPhone, botón Compartir → <b>Añadir a pantalla de inicio</b>.</p></div>
    <div class="bloque"><h3>Empezar de cero</h3><p>Borra todas tus marcas en este móvil. El catálogo y los mazos no se tocan.</p>
      <div class="botones"><button type="button" class="boton peligro" data-accion="borrar">Borrar mi colección</button></div></div>
    <p class="pie">MiPokedex · datos de cartas de TCGdex</p></div>`;
  $("#importar").addEventListener("change", importar);
}

function exportar() {
  const datos = Guardado.exportar();
  const blob = new Blob([JSON.stringify(datos, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mipokedex-${datos.fecha.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  aviso("Copia guardada en Descargas");
  if (location.hash === "#/ajustes") vistaAjustes();
}

async function importar(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  let datos;
  try {
    datos = JSON.parse(await f.text());
  } catch (err) {
    return aviso("Ese archivo no es una copia de MiPokedex.");
  }
  if (datos.tipo !== "pokedex-coleccion") return aviso("Ese archivo no es una copia de MiPokedex.");
  const n = Object.keys(datos.coleccion || {}).length;
  const nm = (datos.mazos || []).length;
  const hayAlgo = Object.keys(Guardado.todo).length > 0 || Guardado.mazos.length > 0;
  const modo = hayAlgo ? await dialogo("Recuperar copia",
    `La copia tiene ${n} cartas distintas${nm ? ` y ${nm} mazos` : ""}. ¿Qué hago con lo que ya tienes aquí?`,
    [{ texto: "Sustituirlo por la copia", valor: "reemplazar", clase: "pri" },
     { texto: "Sumar la copia a lo que hay", valor: "sumar" },
     { texto: "Cancelar", valor: null }]) : "reemplazar";
  if (!modo) return;
  const copias = Guardado.importar(datos, modo);
  const fuera = Cat.listo ? Object.keys(datos.coleccion || {}).filter((id) => !Cat.porId.has(id)).length : 0;
  aviso(`Recuperadas ${copias} copias` + (fuera ? `. ${fuera} cartas no están en tu catálogo: se guardan igualmente.` : ""), 4500);
  vistaAjustes();
}

async function borrarTodo() {
  const si = await dialogo("¿Borrar tu colección?",
    "Se quitan todas tus marcas en este móvil. No se puede deshacer, salvo que tengas una copia.",
    [{ texto: "Sí, borrar todo", valor: true, clase: "peligro" }, { texto: "Cancelar", valor: false }]);
  if (!si) return;
  Guardado.borrar();
  aviso("Colección borrada");
  vistaAjustes();
}

/* ---------------------------------------------------------------------
 * Sin catálogo
 * ------------------------------------------------------------------- */

function vistaSinIndice() {
  const sin = Cat.error === "sin-indice";
  $("#vista").innerHTML = `<div class="pagina"><h1>${sin ? "Falta el catálogo" : "Algo ha fallado"}</h1>
    <p class="vacio">${sin
      ? `Esta app necesita el fichero <code>indice.json</code> con las cartas que quieres reconocer. Créalo en el PC con
         <code>python generar_indice.py --sets sv01</code> y vuelve a publicar la carpeta <code>app</code>.`
      : esc(Cat.error || "Cargando…")}</p>
    <p class="pie">Mientras tanto, desde Ajustes puedes guardar o recuperar tu copia de seguridad.</p></div>`;
}

/* ---------------------------------------------------------------------
 * Navegación y eventos
 * ------------------------------------------------------------------- */

let alFiltrar = null;   // la vista actual puede añadir resultados al buscar
let pasos = 0;          // páginas visitadas dentro de la app, para "volver"

function mostrar() {
  const [, ruta = "inicio", ...resto] = (location.hash || "#/inicio").split("/");
  const id = resto.length ? decodeURIComponent(resto.join("/")) : null;
  if (ruta !== "escanear") Escaner.apagar();
  alFiltrar = null;
  Hoja = null;
  // El inicio va sobre rojo; la barra del sistema del móvil acompaña al fondo.
  const enInicio = !["escanear", "sets", "set", "pokemon", "ilustradores", "ilustrador", "carta",
                     "mazos", "mazo", "ajustes"].includes(ruta);
  document.body.classList.toggle("en-inicio", enInicio);
  const tema = document.querySelector('meta[name="theme-color"]');
  if (tema) tema.content = enInicio ? "#E23B32" : "#FFF4DC";
  const pestana = { inicio: "inicio", escanear: "escanear", ajustes: "ajustes", mazos: "mazos", mazo: "mazos" }[ruta] || "sets";
  for (const a of $$(".pestanas a")) a.classList.toggle("aqui", a.dataset.pestana === pestana);
  if (ruta === "sets") vistaSets();
  else if (ruta === "set") vistaSet(id);
  else if (ruta === "pokemon") id ? vistaPokemon(id) : vistaListaPokemon();
  else if (ruta === "ilustradores") vistaListaIlustradores();
  else if (ruta === "ilustrador") vistaIlustrador(id);
  else if (ruta === "carta") vistaCarta(id);
  else if (ruta === "mazos") id === "nuevo" ? vistaNuevoMazo() : vistaMazos();
  else if (ruta === "mazo") vistaMazo(id);
  else if (ruta === "ajustes") vistaAjustes();
  else if (ruta === "escanear") vistaEscaner();
  else vistaInicio();
  if (ruta !== "escanear") window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-accion]");
  if (b) {
    const acc = b.dataset.accion;
    if (acc === "sumar") {
      const q = Guardado.sumar(b.dataset.id, b.dataset.var, +b.dataset.delta);
      refrescarPastillas(b.dataset.id);
      if (q && +b.dataset.delta > 0 && navigator.vibrate) navigator.vibrate(10);
    } else if (acc === "seguir") Escaner.seguir();
    else if (acc === "disparar") Escaner.disparar();
    else if (acc === "linterna") Escaner.alternarLinterna();
    else if (acc === "elegir") mostrarResultado(Cat.porId.get(b.dataset.id), Escaner.ultimo);
    else if (acc === "no-es") {
      const r = Escaner.ultimo;
      if (r) mostrarDudas(Object.assign({}, r, { veredicto: "dudoso" }));
      else Escaner.seguir();
    }
    else if (acc === "exportar") exportar();
    else if (acc === "borrar") borrarTodo();
    else if (acc === "ocultar") quitarDeLista(b.dataset.clave, b.dataset.nombre);
    else if (acc === "desocultar") {
      Guardado.ocultar(b.dataset.clave, false);
      aviso("Vuelve a estar en la lista");
      mostrar();
    }
    else if (acc === "volver") {
      if (pasos > 0) history.back(); else location.hash = b.dataset.href;
    }
    else if (acc === "orden") {
      ordenReciente = b.dataset.v === "reciente";
      try { localStorage.setItem("mipokedex.orden", ordenReciente ? "reciente" : "antiguas"); } catch (err) {}
      mostrar();
    }
    return;
  }
  const h = e.target.closest("[data-hueco]");
  if (h) {
    if (pulsacion.disparada) { pulsacion.disparada = false; return; }
    tocarHueco(h);
  }
});

document.addEventListener("keydown", (e) => {
  const h = e.target.closest && e.target.closest("[data-hueco]");
  if (!h) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tocarHueco(h); }
  if (e.key === "i") location.hash = "#/carta/" + encodeURIComponent(h.dataset.hueco);
});

document.addEventListener("change", (e) => {
  const m = e.target.closest("[data-master]");
  if (!m) return;
  Guardado.ponerMaster(m.dataset.master, m.checked);
  mostrar();
});

document.addEventListener("input", (e) => {
  if (!e.target.matches("[data-filtro]")) return;
  const q = normaliza(e.target.value.trim());
  let n = 0;
  for (const el of $$("[data-busca]")) {
    if (el.closest("#otros")) continue;
    const si = !q || el.dataset.busca.includes(q);
    el.style.display = si ? "" : "none";
    if (si) n++;
  }
  if (alFiltrar) n += alFiltrar(q);
  const v = $("#sin-nada");
  if (v) v.style.display = n ? "none" : "block";
});

/* Mantener pulsada una casilla abre su ficha. Se cancela si el dedo se
 * mueve, para no dispararla al hacer scroll. */
const pulsacion = { t: null, x: 0, y: 0, el: null, disparada: false };
function soltar() {
  clearTimeout(pulsacion.t);
  pulsacion.t = null;
  if (pulsacion.el) pulsacion.el.classList.remove("pulsando");
}
document.addEventListener("pointerdown", (e) => {
  const h = e.target.closest("[data-hueco]");
  if (!h) return;
  soltar();
  Object.assign(pulsacion, { el: h, x: e.clientX, y: e.clientY, disparada: false });
  h.classList.add("pulsando");
  pulsacion.t = setTimeout(() => {
    pulsacion.disparada = true;
    h.classList.remove("pulsando");
    if (navigator.vibrate) navigator.vibrate(12);
    location.hash = "#/carta/" + encodeURIComponent(h.dataset.hueco);
  }, 450);
});
document.addEventListener("pointermove", (e) => {
  if (pulsacion.t && (Math.abs(e.clientX - pulsacion.x) > 10 || Math.abs(e.clientY - pulsacion.y) > 10)) soltar();
});
["pointerup", "pointercancel"].forEach((ev) => document.addEventListener(ev, soltar));
document.addEventListener("contextmenu", (e) => { if (e.target.closest("[data-hueco]")) e.preventDefault(); });

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Escaner.activo) Escaner.bucle();
});
window.addEventListener("resize", () => Escaner.dimensionar());
window.addEventListener("hashchange", () => { pasos++; mostrar(); });

(async function arrancar() {
  // La presentación se ve al menos un momento, aunque el catálogo cargue enseguida.
  const minimo = new Promise((r) => setTimeout(r, 900));
  await Promise.all([cargarIndice(), minimo]);
  mostrar();
  const p = $("#presentacion");
  if (p) {
    p.classList.add("fuera");
    setTimeout(() => p.remove(), 450);
  }
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  // Probando en el PC (localhost) no se guarda nada: así cada cambio en los
  // ficheros se ve al recargar. Además se borra lo que hubiera guardado.
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
    return;
  }
  navigator.serviceWorker.register("sw.js").catch(() => {});
})();
