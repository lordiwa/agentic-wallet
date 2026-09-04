/**
 * El producto es un servicio en la nube, y el texto que el usuario lee tiene
 * que decir eso.
 *
 * Esta regla existe porque ya se rompió una vez y nadie lo notó hasta que
 * estuvo publicado: la portada seguía vendiendo un programa que se instala en
 * Windows con `setup.bat` y que sirve el tablero en `localhost:3000`, y ese
 * texto viajó al bundle desplegado. No es un detalle de estilo — es la promesa
 * equivocada sobre qué es el producto, hecha en la primera pantalla que
 * alguien ve.
 *
 * Se mira **sólo el `<template>`**, que es lo que se lee en pantalla. El
 * `<script>` y los comentarios quedan afuera a propósito: `api/origins.ts`
 * necesita la cadena `localhost` para clasificar un origen de loopback, y eso
 * es lógica, no una promesa al usuario.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = new URL("..", import.meta.url).pathname;

/** Cada patrón con el motivo por el que no puede aparecer en pantalla. */
const PROHIBIDAS: { patron: RegExp; porque: string }[] = [
  { patron: /setup\.bat|configurar\.bat|iniciar\.bat/i, porque: "no hay instalador: no se descarga nada" },
  { patron: /localhost|127\.0\.0\.1/i, porque: "el panel no vive en la máquina de quien lo mira" },
  { patron: /no hay servidor/i, porque: "sí hay servicio: el producto es la nube" },
  { patron: /wallet\.sqlite/i, porque: "el ledger no es un archivo que el usuario maneje" },
  { patron: /tu computadora|tu máquina|tu equipo/i, porque: "los datos no viven en el equipo del usuario" },
  { patron: /doble clic/i, porque: "no hay nada que instalar con dobles clics" },
  { patron: /tailscale/i, porque: "el borde público no es asunto de quien usa el panel" },
];

function vueFiles(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...vueFiles(ruta));
    else if (entrada.name.endsWith(".vue")) salida.push(ruta);
  }
  return salida;
}

/** El `<template>` del archivo, o cadena vacía si no tiene. */
function plantilla(fuente: string): string {
  const desde = fuente.indexOf("<template>");
  const hasta = fuente.lastIndexOf("</template>");
  return desde === -1 || hasta === -1 ? "" : fuente.slice(desde, hasta);
}

describe("el texto en pantalla habla de un producto en la nube", () => {
  const archivos = vueFiles(join(RAIZ, "src"));

  it("hay componentes que revisar (si esto falla, el barrido no encontró nada)", () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  for (const { patron, porque } of PROHIBIDAS) {
    it(`ningún template dice ${patron.source} — ${porque}`, () => {
      const culpables = archivos.filter((ruta) => patron.test(plantilla(readFileSync(ruta, "utf8"))));
      expect(culpables.map((r) => r.slice(RAIZ.length))).toEqual([]);
    });
  }
});
