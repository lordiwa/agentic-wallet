import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El criterio objetivo de §2.5 del plan, convertido en test: "replica
 * exactamente" no puede ser una impresion.
 *
 * 1. `tokens.css` contiene TEXTUALMENTE los valores de §2.1.
 * 2. Un `grep` de `#[0-9a-fA-F]{6}` en `panel/src/` fuera de `tokens.css`
 *    devuelve cero.
 *
 * El punto 2 es el que evita la deriva. Un hex suelto en un componente no
 * rompe nada hoy, pero es como el sistema y el panel dejan de ser la misma
 * cosa sin que nadie se entere.
 */
const PANEL_SRC = path.resolve(import.meta.dirname, "..");
const TOKENS_CSS = path.join(PANEL_SRC, "styles/tokens.css");

/**
 * Los valores exactos de la tabla de §2.1, con su rol.
 *
 * Son los del tema OSCURO. La tabla anterior (`#101A26` nav, `#2B5FD9`
 * acción, fondo `#F6F7F9`) era la del sistema claro y quedó atrás cuando el
 * design system se rehízo entero: los diez roles cambiaron de valor a la vez.
 * Sostener acá los hex viejos para no tocar el test habría dejado el test en
 * verde midiendo un sistema que ya no existe — que es justo lo contrario de
 * para lo que está.
 */
const TOKENS_21: [string, string][] = [
  ["Nav", "#170F28"],
  ["Tinta", "#ECEBFA"],
  ["Apagado", "#9A9EC2"],
  ["Fondo", "#140F22"],
  ["Panel", "#1C1533"],
  ["Línea", "#372A5C"],
  ["Acción", "#9A63F5"],
  ["Al día", "#3FD6B3"],
  ["Atención", "#F2A65A"],
  ["Falla", "#FF8FA3"],
];

/**
 * Las etiquetas `.tag` de §2.1: fondo / borde / texto.
 *
 * Sobre fondo oscuro el fondo y el borde de tres de las cinco son el color a
 * baja opacidad, no un hex — por eso acá hay `rgba(...)` y no sólo `#`.
 */
const TAGS_21: [string, string[]][] = [
  ["ok", ["rgba(63, 214, 179, 0.12)", "rgba(63, 214, 179, 0.45)", "#8EE8DF"]],
  ["warn", ["#2B2015", "#F2A65A", "#FFC38A"]],
  ["bad", ["rgba(255, 110, 134, 0.14)", "rgba(255, 110, 134, 0.45)", "#FF8FA3"]],
  ["neu", ["#241B40", "#372A5C", "#9A9EC2"]],
  ["acc", ["rgba(154, 99, 245, 0.16)", "rgba(185, 143, 248, 0.5)", "#B98FF8"]],
];

function archivosDe(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivosDe(full));
    else out.push(full);
  }
  return out;
}

const css = readFileSync(TOKENS_CSS, "utf8");

describe("tokens.css lleva los valores de §2.1 textualmente", () => {
  it.each(TOKENS_21)("%s = %s", (_rol, hex) => {
    expect(css).toContain(hex);
  });

  it.each(TAGS_21)("la etiqueta .%s con sus tres hex", (_clase, hexes) => {
    for (const hex of hexes) expect(css).toContain(hex);
  });

  it("los botones: primario con su borde, deshabilitado y el borde del secundario", () => {
    for (const hex of ["#9A63F5", "#B98FF8", "#372A5C", "#241B40", "#6B7096", "#2C2148"])
      expect(css).toContain(hex);
  });

  it("el shell: columnas, barra lateral, activo y padding del contenido", () => {
    expect(css).toContain("236px 1fr");
    expect(css).toContain("#AAB0D6");
    expect(css).toContain("#2C2148");
    expect(css).toContain("20px 26px 40px");
  });

  it("la tipografía y la escala fija", () => {
    expect(css).toContain('system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    expect(css).toContain("26px");
    expect(css).toContain("640");
    expect(css).toContain("-0.015em");
    expect(css).toContain("0.05em");
    expect(css).toContain("12.5px");
  });

  it("las dos fuentes del tema: la que titula y la que dibuja un dato", () => {
    expect(css).toContain('"Space Grotesk"');
    expect(css).toContain('"IBM Plex Mono"');
  });

  it("los cuatro radios: 2 control, 3 botón, 4 tarjeta, 3 etiqueta", () => {
    expect(css).toMatch(/--radio-control:\s*2px/);
    expect(css).toMatch(/--radio-boton:\s*3px/);
    expect(css).toMatch(/--radio-tarjeta:\s*4px/);
    expect(css).toMatch(/--radio-etiqueta:\s*3px/);
  });

  /* El bisel es una decisión de forma del sistema, del mismo rango que un
     radio: si se pierde, el botón deja de ser el del sistema. */
  it("el bisel del botón vive en el sistema, no en un componente", () => {
    expect(css).toMatch(/--boton-bisel:\s*polygon\(/);
    expect(readFileSync(path.join(PANEL_SRC, "styles/base.css"), "utf8")).toContain(
      "clip-path: var(--boton-bisel)"
    );
  });

  it("toda cifra de plata es tabular: la regla vive en el sistema, no en un componente", () => {
    const base = readFileSync(path.join(PANEL_SRC, "styles/base.css"), "utf8");
    expect(base).toContain("tabular-nums");
  });
});

describe("ningún color fuera de tokens.css", () => {
  const fuentes = archivosDe(PANEL_SRC).filter(
    (file) => file !== TOKENS_CSS && /\.(vue|ts|css)$/.test(file) && !file.endsWith(".test.ts")
  );

  it("hay algo que revisar (si no, este test sería vacuo)", () => {
    expect(fuentes.length).toBeGreaterThan(4);
  });

  it.each(fuentes.map((file) => [path.relative(PANEL_SRC, file), file]))("%s no escribe un hex", (_rel, file) => {
    const contenido = readFileSync(file, "utf8");
    expect(contenido).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    // Ni la forma corta ni `rgb()/rgba()` a mano: la sombra del sistema
    // tambien vive en tokens.css.
    expect(contenido).not.toMatch(/#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/);
    expect(contenido).not.toMatch(/\brgba?\(/);
  });
});
