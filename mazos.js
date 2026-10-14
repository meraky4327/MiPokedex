/* Mazos: pegas la lista exportada y llevas la cuenta de lo que tienes.
 *
 * Cada mazo es independiente: empieza a cero y no mira ni tu colección ni
 * los demás mazos. Las cartas se identifican por el nombre; en Entrenador y
 * Energía da igual el set (un Boss's Orders vale el de cualquiera), así que
 * las líneas con el mismo nombre se juntan en una.
 *
 * Usa piezas de app.js: $, esc, normaliza, aviso, dialogo, Cat, Guardado.
 */
"use strict";

const ASSETS = "https://assets.tcgdex.net/";

/* Por si el catálogo aún no trae la tabla de códigos (generar_indice.py la
 * añade): los sets de los últimos años, código de Pokémon TCG Live -> TCGdex. */
const CODIGOS_BASE = {
  SVI: ["sv01", "sv"], PAL: ["sv02", "sv"], OBF: ["sv03", "sv"], MEW: ["sv03.5", "sv"],
  PAR: ["sv04", "sv"], PAF: ["sv04.5", "sv"], TEF: ["sv05", "sv"], TWM: ["sv06", "sv"],
  SFA: ["sv06.5", "sv"], SCR: ["sv07", "sv"], SSP: ["sv08", "sv"], PRE: ["sv08.5", "sv"],
  JTG: ["sv09", "sv"], DRI: ["sv10", "sv"], SVE: ["sve", "sv"], SVP: ["svp", "sv"],
  SSH: ["swsh1", "swsh"], RCL: ["swsh2", "swsh"], DAA: ["swsh3", "swsh"], VIV: ["swsh4", "swsh"],
  SHF: ["swsh4.5", "swsh"], BST: ["swsh5", "swsh"], CRE: ["swsh6", "swsh"], EVS: ["swsh7", "swsh"],
  FST: ["swsh8", "swsh"], BRS: ["swsh9", "swsh"], ASR: ["swsh10", "swsh"], PGO: ["swsh10.5", "swsh"],
  LOR: ["swsh11", "swsh"], SIT: ["swsh12", "swsh"], CRZ: ["swsh12.5", "swsh"], CEL: ["cel25", "swsh"],
};

const SECCIONES = ["Pokémon", "Entrenador", "Energía", "Otras"];

/* --- Leer la lista ------------------------------------------------------ */

const CABECERA = /^(pok[eé]mon|trainers?|entrenador(?:es)?|energ(?:y|ies|[ií]as?))\b\s*[:(\-]?\s*\d*\s*\)?\s*$/i;
const CON_SET = /^(\d+)\s+(.+?)\s+([A-Za-z][A-Za-z0-9-]{1,6})\s+([A-Za-z]{0,4}\d+[A-Za-z]?)$/;
const SIN_SET = /^(\d+)x?\s+(.+)$/i;

function seccionDe(cabecera) {
  const t = normaliza(cabecera);
  if (t.startsWith("pok")) return "Pokémon";
  if (t.startsWith("energ")) return "Energía";
  return "Entrenador";
}

function pareceEnergia(nombre) { return /\benerg(y|ia|ía)\b/i.test(nombre); }

/* Devuelve { lineas, malas }. */
function leerLista(texto) {
  const lineas = [], malas = [];
  let seccion = null;
  for (const cruda of String(texto || "").split(/\r?\n/)) {
    const l = cruda.trim().replace(/^[*•-]\s*/, "");
    if (!l) continue;
    if (CABECERA.test(l)) { seccion = seccionDe(l); continue; }
    if (/^total\b/i.test(l) || /^(cards?|cartas)\s*[:(]/i.test(l)) continue;
    let m = l.match(CON_SET), linea;
    if (m) linea = { n: +m[1], nombre: m[2].trim(), codigo: m[3].toUpperCase(), numero: m[4] };
    else if ((m = l.match(SIN_SET))) linea = { n: +m[1], nombre: m[2].trim(), codigo: "", numero: "" };
    if (!linea || !(linea.n > 0) || linea.n > 60) { malas.push(l); continue; }
    linea.sec = seccion || (pareceEnergia(linea.nombre) ? "Energía" : "Otras");
    lineas.push(linea);
  }
  return { lineas: juntar(lineas), malas };
}

/* Entrenadores y energías con el mismo nombre son la misma carta para jugar:
 * se juntan. Los Pokémon solo si son también del mismo set y número, porque
 * dos "Dreepy" pueden tener ataques distintos. */
function juntar(lineas) {
  const out = [], por = new Map();
  for (const l of lineas) {
    const k = l.sec === "Pokémon" ? `${normaliza(l.nombre)}|${l.codigo}|${l.numero}`
                                  : `${l.sec}|${normaliza(l.nombre)}`;
    const ya = por.get(k);
    if (ya) ya.n += l.n;
    else { const x = { ...l, tengo: 0 }; por.set(k, x); out.push(x); }
  }
  return out;
}

function resumenLista(lineas) {
  const por = {};
  for (const l of lineas) por[l.sec] = (por[l.sec] || 0) + l.n;
  return SECCIONES.filter((s) => por[s]).map((s) => `${por[s]} ${s}`).join(" · ");
}

/* --- Imágenes ----------------------------------------------------------- */

function codigoASet(codigo) {
  if (!codigo) return null;
  return (Cat.codigos && Cat.codigos[codigo]) || CODIGOS_BASE[codigo] || null;
}

/* Posibles URL de la imagen, de más a menos fiable. */
function imagenesLinea(l, calidad = "low") {
  const urls = [];
  if (!l.codigo) return urls;
  // 1. La carta está en tu catálogo
  if (Cat.listo) {
    const set = Cat.sets.find((s) => (s.codigo || "").toUpperCase() === l.codigo) ||
                (codigoASet(l.codigo) && Cat.sets.find((s) => s.id === codigoASet(l.codigo)[0]));
    const c = set && (Cat.porSet.get(set.id) || []).find((x) => x.numero === l.numero ||
                      (parseInt(x.numero, 10) === parseInt(l.numero, 10) && /^\d+$/.test(l.numero)));
    if (c && urlImagen(c, calidad)) urls.push(urlImagen(c, calidad));
  }
  // 2. Directamente de TCGdex, con el número tal cual y con ceros delante
  const s = codigoASet(l.codigo);
  if (s) {
    const nums = [l.numero];
    if (/^\d+$/.test(l.numero)) nums.push(l.numero.padStart(3, "0"), String(+l.numero));
    for (const n of [...new Set(nums)]) urls.push(`${ASSETS}en/${s[1]}/${s[0]}/${n}/${calidad}.webp`);
  }
  return [...new Set(urls)];
}

function imgLinea(l, calidad = "low") {
  const [primera, ...resto] = imagenesLinea(l, calidad);
  if (!primera) return "";
  return `<img src="${esc(primera)}" data-alt="${esc(resto.join(" "))}" loading="lazy" alt="" ` +
    `onerror="sigImagen(this)">`;
}

/* Si una URL falla, prueba la siguiente; si no queda ninguna, quita la imagen. */
function sigImagen(img) {
  const resto = (img.dataset.alt || "").split(" ").filter(Boolean);
  if (!resto.length) { img.remove(); return; }
  img.dataset.alt = resto.slice(1).join(" ");
  img.src = resto[0];
}

/* --- Cuentas ------------------------------------------------------------ */

function progresoMazo(m) {
  let tengo = 0, de = 0;
  for (const l of m.lineas) { de += l.n; tengo += Math.min(l.tengo || 0, l.n); }
  return { tengo, de, pct: de ? (100 * tengo / de).toFixed(1) : 0 };
}

function nuevoId() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* --- Pantallas ---------------------------------------------------------- */

function vistaMazos() {
  const mazos = Guardado.mazos;
  const tomo = (m) => {
    const p = progresoMazo(m);
    const portada = m.lineas.find((l) => l.sec === "Pokémon" && l.codigo) || m.lineas.find((l) => l.codigo);
    const fecha = m.creado ? new Date(m.creado).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "";
    return `<div class="tomo" data-busca="${esc(normaliza(m.nombre))}">` +
      `<a href="#/mazo/${encodeURIComponent(m.id)}"><div class="fila">${portada ? imgLinea(portada) : ""}` +
      `<h3>${esc(m.nombre)}<small>${p.de} cartas${fecha ? " · creado el " + esc(fecha) : ""}</small></h3>` +
      `<span class="cifra">${p.tengo}<span>/${p.de}</span></span></div>` +
      `<div class="linea"><i style="width:${p.pct}%"></i></div></a></div>`;
  };
  $("#vista").innerHTML = `<div class="pagina"><h1>Mazos</h1>
    <a class="boton pri ancho" href="#/mazos/nuevo">+ Nuevo mazo</a>
    ${mazos.length > 3 ? buscador("Buscar un mazo") : ""}
    ${mazos.map(tomo).reverse().join("") ||
      `<p class="vacio">Aún no tienes ningún mazo. Pulsa <b>Nuevo mazo</b> y pega la lista exportada
       de Pokémon TCG Live o Limitless.</p>`}
    <p class="sinnada" id="sin-nada">Ningún mazo con ese nombre.</p>
    <p class="pie">Cada mazo lleva su propia cuenta y empieza a cero: no depende de tu colección ni de los demás mazos.</p></div>`;
}

const EJEMPLO = `Pokémon: 2
4 Dreepy TWM 128
3 Drakloak TWM 129
Trainer: 2
4 Boss's Orders PAL 172
4 Arven SVI 166
Energy: 1
8 Basic {P} Energy SVE 5`;

function vistaNuevoMazo() {
  $("#vista").innerHTML = `<div class="pagina">
    <a class="volver" href="#/mazos">‹ Mazos</a>
    <h1>Nuevo mazo</h1>
    <label class="campo"><span>Nombre</span>
      <input type="text" id="mazo-nombre" maxlength="60" placeholder="Por ejemplo: Dragapult ex" autocomplete="off"></label>
    <label class="campo"><span>Lista</span>
      <textarea id="mazo-lista" rows="12" spellcheck="false" autocapitalize="off"
        placeholder="${esc(EJEMPLO)}"></textarea></label>
    <p class="sub" id="mazo-lectura">Pega aquí la lista exportada, tal cual.</p>
    <div id="mazo-malas"></div>
    <div class="botones"><button type="button" class="boton pri" id="mazo-crear" data-mazo="crear" disabled>Crear mazo</button></div>
  </div>`;
  const lista = $("#mazo-lista"), nombre = $("#mazo-nombre");
  const revisar = () => {
    const { lineas, malas } = leerLista(lista.value);
    const total = lineas.reduce((s, l) => s + l.n, 0);
    $("#mazo-lectura").textContent = lineas.length
      ? `Reconozco ${total} cartas: ${resumenLista(lineas)}.` + (total !== 60 ? " Ojo: un mazo normal tiene 60." : "")
      : "Pega aquí la lista exportada, tal cual.";
    $("#mazo-malas").innerHTML = malas.length
      ? `<div class="aviso-malas"><b>No entiendo ${malas.length === 1 ? "esta línea" : `estas ${malas.length} líneas`}:</b>` +
        `<ul>${malas.slice(0, 8).map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` +
        `<small>Cada carta debe ir en una línea, empezando por cuántas: <code>4 Arven SVI 166</code></small></div>` : "";
    $("#mazo-crear").disabled = !lineas.length;
  };
  lista.addEventListener("input", revisar);
  // Si el nombre está vacío, se propone el primer Pokémon de la lista.
  nombre.addEventListener("input", () => { nombre.dataset.tocado = "1"; });
  lista.addEventListener("change", () => {
    if (nombre.dataset.tocado) return;
    const p = leerLista(lista.value).lineas.find((l) => l.sec === "Pokémon");
    if (p && !nombre.value) nombre.placeholder = `Por ejemplo: ${p.nombre}`;
  });
  nombre.focus();
}

function crearMazo() {
  const { lineas, malas } = leerLista($("#mazo-lista").value);
  if (!lineas.length) return;
  const nombre = $("#mazo-nombre").value.trim() ||
    (lineas.find((l) => l.sec === "Pokémon") || lineas[0]).nombre;
  const m = { id: nuevoId(), nombre, creado: new Date().toISOString(), lineas, malas };
  Guardado.guardarMazo(m);
  location.replace("#/mazo/" + encodeURIComponent(m.id));
}

let soloFaltan = false;

function filaLinea(l, i) {
  const t = l.tengo || 0, completa = t >= l.n;
  return `<div class="carta-mazo${completa ? " completa" : ""}" data-i="${i}"${soloFaltan && completa ? ' hidden' : ""}>` +
    `<button type="button" class="mini" data-mazo="ver" data-i="${i}" aria-label="Ver ${esc(l.nombre)}">${imgLinea(l)}</button>` +
    `<div class="txt"><b>${esc(l.nombre)}</b><small>${esc([l.codigo, l.numero].filter(Boolean).join(" ") || "sin set")}</small></div>` +
    `<div class="contador">` +
    `<button type="button" data-mazo="menos" data-i="${i}" aria-label="Quitar una"${t ? "" : " disabled"}>&minus;</button>` +
    `<span><b>${t}</b>/${l.n}</span>` +
    `<button type="button" data-mazo="mas" data-i="${i}" aria-label="Añadir una"${completa ? " disabled" : ""}>+</button>` +
    `</div></div>`;
}

function vistaMazo(id) {
  const m = Guardado.mazo(id);
  if (!m) { location.hash = "#/mazos"; return; }
  const p = progresoMazo(m);
  const bloques = SECCIONES.map((sec) => {
    const idx = m.lineas.map((l, i) => [l, i]).filter(([l]) => l.sec === sec);
    if (!idx.length) return "";
    const n = idx.reduce((s, [l]) => s + l.n, 0);
    const tengo = idx.reduce((s, [l]) => s + Math.min(l.tengo || 0, l.n), 0);
    return `<h2 class="seccion-mazo">${sec}<span>${tengo}/${n}</span></h2>` +
      idx.map(([l, i]) => filaLinea(l, i)).join("");
  }).join("");
  $("#vista").innerHTML = `<div class="pagina" data-mazo-id="${esc(m.id)}">
    <a class="volver" href="#/mazos">‹ Mazos</a>
    <h1>${esc(m.nombre)}</h1>
    <div class="cabeza-set"><span class="cifra"><b id="cuenta">${p.tengo}</b><span>/${p.de}</span></span>
      ${p.tengo >= p.de ? '<span class="chip">Completo</span>' : `<span class="sub" style="margin:0">Te faltan ${p.de - p.tengo}</span>`}</div>
    <div class="linea" style="margin:-.3rem 0 1rem"><i id="barra" style="width:${p.pct}%"></i></div>
    <div class="orden" role="group" aria-label="Mostrar">
      <button type="button" data-mazo="filtro" data-v="todas"${soloFaltan ? "" : ' class="activo"'}>Todas</button>
      <button type="button" data-mazo="filtro" data-v="faltan"${soloFaltan ? ' class="activo"' : ""}>Solo las que me faltan</button>
    </div>
    ${bloques}
    ${(m.malas || []).length ? `<div class="aviso-malas"><b>Líneas que no entendí al crearlo:</b><ul>${m.malas.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    <div class="botones" style="margin-top:1.4rem"><button type="button" class="boton pri" data-mazo="copiar">Copiar lo que me falta</button></div>
    <div class="botones"><button type="button" class="boton" data-mazo="renombrar">Renombrar</button>
      <button type="button" class="boton" data-mazo="cero">Poner a cero</button></div>
    <div class="botones"><button type="button" class="boton peligro" data-mazo="borrar">Borrar mazo</button></div>
    <p class="pie">Pulsa + cada vez que consigas una copia para este mazo. En Entrenadores y Energías vale la de cualquier set.</p></div>`;
}

/* Cambia una línea sin repintar toda la pantalla (no salta el scroll). */
function refrescarLinea(m, i) {
  const fila = document.querySelector(`.carta-mazo[data-i="${i}"]`);
  if (fila) {
    const tmp = document.createElement("div");
    tmp.innerHTML = filaLinea(m.lineas[i], i);
    const nueva = tmp.firstChild;
    nueva.hidden = false;   // que no desaparezca en mitad de la pulsación
    fila.replaceWith(nueva);
  }
  const p = progresoMazo(m);
  $("#cuenta").textContent = p.tengo;
  $("#barra").style.width = p.pct + "%";
  for (const h of document.querySelectorAll(".seccion-mazo")) {
    const sec = h.firstChild.textContent;
    const ls = m.lineas.filter((l) => l.sec === sec);
    h.querySelector("span").textContent =
      `${ls.reduce((s, l) => s + Math.min(l.tengo || 0, l.n), 0)}/${ls.reduce((s, l) => s + l.n, 0)}`;
  }
}

function textoFaltan(m) {
  const partes = [];
  for (const sec of SECCIONES) {
    const ls = m.lineas.filter((l) => l.sec === sec && (l.tengo || 0) < l.n);
    if (!ls.length) continue;
    partes.push(`${sec}: ${ls.reduce((s, l) => s + l.n - (l.tengo || 0), 0)}`);
    for (const l of ls) partes.push([l.n - (l.tengo || 0), l.nombre, l.codigo, l.numero].filter(Boolean).join(" "));
    partes.push("");
  }
  return partes.join("\n").trim();
}

async function copiarFaltan(m) {
  const texto = textoFaltan(m);
  if (!texto) return aviso("¡No te falta nada!");
  try {
    await navigator.clipboard.writeText(texto);
    aviso("Copiado: pégalo donde quieras");
  } catch (e) {
    // Sin permiso para el portapapeles: se enseña para copiarlo a mano.
    const velo = document.createElement("div");
    velo.className = "velo";
    velo.innerHTML = `<div class="dialogo"><h3>Lo que te falta</h3>` +
      `<textarea rows="10" readonly style="width:100%">${esc(texto)}</textarea>` +
      `<div class="botones"><button type="button" class="boton pri">Cerrar</button></div></div>`;
    velo.addEventListener("click", (ev) => { if (ev.target === velo || ev.target.closest("button")) velo.remove(); });
    document.body.appendChild(velo);
    velo.querySelector("textarea").select();
  }
}

function verCarta(l) {
  const velo = document.createElement("div");
  velo.className = "velo centrado";
  velo.innerHTML = `<figure class="carta-grande">${imgLinea(l, "high") ||
    `<div class="sin-imagen">${esc(l.nombre)}</div>`}<figcaption>${esc(l.nombre)}` +
    `${l.codigo ? ` · ${esc(l.codigo)} ${esc(l.numero)}` : ""}</figcaption></figure>`;
  velo.addEventListener("click", () => velo.remove());
  document.body.appendChild(velo);
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-mazo]");
  if (!b) return;
  const acc = b.dataset.mazo;
  if (acc === "crear") return crearMazo();
  const cont = b.closest("[data-mazo-id]");
  const m = cont && Guardado.mazo(cont.dataset.mazoId);
  if (!m) return;
  const i = +b.dataset.i;
  if (acc === "mas" || acc === "menos") {
    const l = m.lineas[i];
    l.tengo = Math.max(0, Math.min(l.n, (l.tengo || 0) + (acc === "mas" ? 1 : -1)));
    Guardado.guardarMazo(m);
    refrescarLinea(m, i);
    if (acc === "mas" && navigator.vibrate) navigator.vibrate(l.tengo >= l.n ? 25 : 10);
  } else if (acc === "ver") verCarta(m.lineas[i]);
  else if (acc === "filtro") { soloFaltan = b.dataset.v === "faltan"; vistaMazo(m.id); }
  else if (acc === "copiar") copiarFaltan(m);
  else if (acc === "renombrar") {
    const n = prompt("Nuevo nombre del mazo", m.nombre);
    if (n && n.trim()) { m.nombre = n.trim().slice(0, 60); Guardado.guardarMazo(m); vistaMazo(m.id); }
  } else if (acc === "cero") {
    const si = await dialogo("¿Poner a cero?", "Todas las cartas de este mazo vuelven a 0. La lista no se toca.",
      [{ texto: "Sí, poner a cero", valor: true, clase: "peligro" }, { texto: "Cancelar", valor: false }]);
    if (si) { m.lineas.forEach((l) => (l.tengo = 0)); Guardado.guardarMazo(m); vistaMazo(m.id); }
  } else if (acc === "borrar") {
    const si = await dialogo(`¿Borrar «${m.nombre}»?`, "Se borra el mazo y su cuenta. No se puede deshacer, salvo que tengas una copia.",
      [{ texto: "Sí, borrar el mazo", valor: true, clase: "peligro" }, { texto: "Cancelar", valor: false }]);
    if (si) { Guardado.borrarMazo(m.id); location.replace("#/mazos"); aviso("Mazo borrado"); }
  }
});
