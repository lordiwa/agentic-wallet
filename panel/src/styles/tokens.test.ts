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

/** Los valores exactos de la tabla de §2.1, con su rol. */
const TOKENS_21: [string, string][] = [
  ["Nav", "#101A26"],
  ["Tinta", "#17202A"],
  ["Apagado", "#5B6B7C"],
  ["Fondo", "#F6F7F9"],
  ["Panel", "#FFFFFF"],
  ["Línea", "#DDE3EA"],
  ["Acción", "#2B5FD9"],
  ["Al día", "#1C7A45"],
  ["Atención", "#E0B73A"],
  ["Falla", "#B3261E"],
];

/** Las etiquetas `.tag` de §2.1: fondo / borde / texto. */
const TAGS_21: [string, string[]][] = [
  ["ok", ["#E8F6EE", "#B8E0C8", "#1C7A45"]],
  ["warn", ["#FFF4D6", "#E0B73A", "#8A6200"]],
  ["bad", ["#FDECEB", "#F2C0BC", "#B3261E"]],
  ["neu", ["#F0F3F7", "#DDE3EA", "#5B6B7C"]],
  ["acc", ["#EAF0FF", "#C3D4FB", "#2B5FD9"]],
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

  it("los botones: primario, deshabilitado y el borde del secundario", () => {
    for (const hex of ["#2B5FD9", "#DDE3EA", "#F0F3F7", "#9AA8B6"]) expect(css).toContain(hex);
  });

  it("el shell: columnas, barra lateral, activo y padding del contenido", () => {
    expect(css).toContain("236px 1fr");
    expect(css).toContain("#A9B8C8");
    expect(css).toContain("#1D2D3F");
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

  it("los cuatro radios: 6 control, 8 botón, 10 tarjeta, 20 etiqueta", () => {
    expect(css).toMatch(/--radio-control:\s*6px/);
    expect(css).toMatch(/--radio-boton:\s*8px/);
    expect(css).toMatch(/--radio-tarjeta:\s*10px/);
    expect(css).toMatch(/--radio-etiqueta:\s*20px/);
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
