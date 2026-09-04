/**
 * Comparador objetivo: una tarjeta del design system contra su vista del panel.
 *
 * No dibuja nada (no hay navegador headless acá). Compara la hoja de estilo:
 * extrae {selector -> {propiedad: valor}} de los dos lados, resuelve las
 * `var(--x)` del panel contra `tokens.css`, normaliza color/espacios, y reporta
 * por selector qué falta, qué sobra y qué difiere.
 *
 * Uso: node tools/ds-diff.mjs <preview.html> <componente.vue> [...más .vue]
 */
import { readFileSync } from "node:fs";

const TOKENS = leerTokens("panel/src/styles/tokens.css");

function leerTokens(ruta) {
  const css = readFileSync(ruta, "utf8");
  const mapa = new Map();
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) mapa.set(m[1], m[2].trim());
  return mapa;
}

function resolverVars(valor, profundidad = 0) {
  if (profundidad > 6) return valor;
  const reemplazado = valor.replace(/var\(\s*--([\w-]+)\s*(?:,[^)]*)?\)/g, (todo, nombre) =>
    TOKENS.has(nombre) ? TOKENS.get(nombre) : todo
  );
  return reemplazado === valor ? valor : resolverVars(reemplazado, profundidad + 1);
}

/** Normaliza para que `#FFF`, `#ffffff` y `white` no cuenten como diferencia. */
function normalizar(valor) {
  let v = resolverVars(valor).trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ",");
  v = v.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/g, "#$1$1$2$2$3$3");
  v = v.replace(/\bwhite\b/g, "#ffffff").replace(/\bblack\b/g, "#000000");
  v = v.replace(/\btransparent\b/g, "rgba(0,0,0,0)");
  // `-.015em` y `-0.015em` son el mismo número; el atajo del preview y la forma
  // larga que escribe el panel no son una diferencia de diseño.
  v = v.replace(/(^|[\s(,])(-?)\.(\d)/g, "$1$20.$3");
  // `15px/1.5` en el atajo `font` y `15px / 1.5` con la `var()` resuelta,
  // tampoco.
  v = v.replace(/\s*\/\s*/g, "/");
  return v;
}

/** Un parser de CSS suficiente para estas hojas: sin anidamiento, sin @media anidado. */
function parsearCss(css) {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const reglas = new Map();
  // Saca los bloques @ (media/supports) y procesa su interior con el prefijo.
  const sinAt = limpio.replace(/@(media|supports)([^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g, (todo, tipo, cond, cuerpo) => {
    agregar(cuerpo, `@${tipo}${cond.trim()} `);
    return "";
  });
  agregar(sinAt, "");

  function agregar(fuente, prefijo) {
    for (const m of fuente.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectores = m[1].trim();
      if (selectores.startsWith("@")) continue;
      const props = new Map();
      for (const decl of m[2].split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        if (prop === "" || prop.startsWith("--")) continue;
        props.set(prop, normalizar(decl.slice(i + 1)));
      }
      for (const sel of selectores.split(",")) {
        const clave = prefijo + normalizarSelector(sel);
        if (clave === prefijo) continue;
        const previo = reglas.get(clave) ?? new Map();
        for (const [k, v] of props) previo.set(k, v);
        reglas.set(clave, previo);
      }
    }
  }
  return reglas;
}

/** `:deep(.x)`, `[data-v-…]`, `>` sueltos: ruido de Vue que no es diseño. */
function normalizarSelector(sel) {
  return sel
    .replace(/:deep\(([^)]*)\)/g, "$1")
    .replace(/\[data-v-[^\]]*\]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*>\s*/g, ">")
    .toLowerCase();
}

export function estilosDePreview(ruta) {
  const html = readFileSync(ruta, "utf8");
  let css = "";
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css += m[1] + "\n";
  return parsearCss(css);
}

export function estilosDeVue(rutas) {
  let css = "";
  for (const ruta of rutas) {
    const fuente = readFileSync(ruta, "utf8");
    if (ruta.endsWith(".css")) {
      css += fuente + "\n";
      continue;
    }
    for (const m of fuente.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css += m[1] + "\n";
  }
  return parsearCss(css);
}

/**
 * El preview escribe `h1`/`h2`/`h3` como elemento; `base.css` los da como clase
 * (`.h1`) para no maquillar cualquier `<h1>` del panel. Es la misma regla con
 * otro gancho, así que se buscan las dos formas antes de contar una ausencia.
 */
function candidatos(sel) {
  const formas = [sel];
  const conClase = sel.replace(/(^|[\s>])(h1|h2|h3)\b/g, "$1.$2");
  if (conClase !== sel) formas.push(conClase);
  return formas;
}

/**
 * Busca una propiedad en varias hojas, en orden de preferencia.
 *
 * Hace falta porque el `<style scoped>` de un componente NO se derrama sobre la
 * página: el `.btn` de 8px que define `SyncButton` sólo vale adentro de
 * `SyncButton`, y en el resto del Resumen el `.btn` es el de `base.css`. Al
 * comparar una `p*.html` se mira primero el vocabulario común y después el
 * componente; al comparar una hoja `c*.html`, al revés.
 */
function buscar(hojas, sel, prop) {
  for (const hoja of hojas) {
    for (const forma of candidatos(sel)) {
      const reglas = hoja.get(forma);
      if (reglas?.has(prop)) return reglas.get(prop);
    }
  }
  return undefined;
}

/** Cuenta pares (selector, propiedad) del preview que la vista reproduce igual. */
export function comparar(preview, vista, ajustes = {}) {
  const alias = ajustes.alias ?? {};
  const ignorar = new Set(ajustes.ignorar ?? []);
  const propsIgnoradas = ajustes.propsIgnoradas ?? new Set();
  const superadas = ajustes.superadas ?? {};
  let total = 0;
  let iguales = 0;
  const faltantes = [];
  const distintos = [];
  const hojas = Array.isArray(vista) ? vista : [vista];
  for (const [sel, props] of preview) {
    if (ignorar.has(sel)) continue;
    const buscado = alias[sel] ?? sel;
    for (const [prop, valor] of props) {
      if (propsIgnoradas.has(prop)) continue;
      if (superadas[sel]?.includes(prop)) continue;
      total += 1;
      const delPanel = buscar(hojas, buscado, prop);
      if (delPanel === undefined) {
        faltantes.push(`${sel} { ${prop}: ${valor} }`);
        continue;
      }
      if (delPanel === valor) iguales += 1;
      else distintos.push(`${sel} { ${prop}: ${valor} }  ->  ${delPanel}`);
    }
  }
  return { total, iguales, faltantes, distintos };
}

if (process.argv[1]?.endsWith("ds-diff.mjs")) {
  const [previewRuta, ...vueRutas] = process.argv.slice(2);
  const preview = estilosDePreview(previewRuta);
  const vista = estilosDeVue(vueRutas);
  const r = comparar(preview, vista);
  const pct = r.total === 0 ? 100 : Math.round((r.iguales / r.total) * 1000) / 10;

  console.log(`${previewRuta}  vs  ${vueRutas.join(" + ")}`);
  console.log(`  coincidencia: ${r.iguales}/${r.total} (${pct}%)`);
  if (process.env.DETALLE === "1") {
    if (r.faltantes.length > 0) {
      console.log(`  --- sin equivalente en la vista (${r.faltantes.length}) ---`);
      for (const f of r.faltantes) console.log(`    ${f}`);
    }
    if (r.distintos.length > 0) {
      console.log(`  --- con otro valor (${r.distintos.length}) ---`);
      for (const d of r.distintos) console.log(`    ${d}`);
    }
  }
}
