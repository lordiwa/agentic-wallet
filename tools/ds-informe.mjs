/**
 * El informe completo: cada tarjeta del design system contra su vista.
 *
 * `node tools/ds-informe.mjs` da la tabla; `node tools/ds-informe.mjs p2-resumen`
 * da el detalle de esa sola (qué falta y qué difiere).
 */
import { comparar, estilosDePreview, estilosDeVue } from "./ds-diff.mjs";
import { COMUN, MAPA, PREVIEWS, PROPS_IGNORADAS } from "./ds-mapa.mjs";

const soloEsta = process.argv[2];
const filas = [];

for (const [tarjeta, archivos, ajustes] of MAPA) {
  if (soloEsta !== undefined && tarjeta !== soloEsta) continue;
  const preview = estilosDePreview(`${PREVIEWS}/${tarjeta}.html`);
  /*
   * Dos hojas separadas, no una fusionada: el `<style scoped>` de un componente
   * no se derrama sobre la página. Una `p*.html` se compara mirando primero el
   * vocabulario común; una hoja `c*.html`, primero el componente.
   */
  const comun = estilosDeVue(COMUN);
  const propias = estilosDeVue(archivos);
  const vista = ajustes?.propiasPrimero === true ? [propias, comun] : [comun, propias];
  const r = comparar(preview, vista, { ...ajustes, propsIgnoradas: PROPS_IGNORADAS });
  const pct = r.total === 0 ? 100 : (r.iguales / r.total) * 100;
  filas.push([tarjeta, archivos, r, pct, ajustes?.superadaPor]);

  if (soloEsta !== undefined) {
    console.log(`${tarjeta}  ->  ${archivos.join(" + ")}`);
    console.log(`coincidencia ${r.iguales}/${r.total} (${pct.toFixed(1)}%)\n`);
    console.log(`--- sin equivalente (${r.faltantes.length}) ---`);
    for (const f of r.faltantes) console.log(`  ${f}`);
    console.log(`\n--- con otro valor (${r.distintos.length}) ---`);
    for (const d of r.distintos) console.log(`  ${d}`);
  }
}

if (soloEsta === undefined) {
  let total = 0;
  let iguales = 0;
  for (const [tarjeta, archivos, r, pct, superadaPor] of filas) {
    // Una tarjeta superada se muestra, pero no cuenta: medir contra el diseño
    // anterior daría un número que empeora justamente al estar al día.
    if (superadaPor === undefined) {
      total += r.total;
      iguales += r.iguales;
    }
    const cola =
      superadaPor === undefined
        ? archivos.map((a) => a.split("/").pop()).join(", ")
        : `(superada por ${superadaPor})`;
    console.log(
      `${tarjeta.padEnd(28)} ${String(r.iguales).padStart(4)}/${String(r.total).padEnd(4)} ` +
        `${pct.toFixed(1).padStart(5)}%   ${cola}`
    );
  }
  console.log(
    `${"TOTAL".padEnd(28)} ${String(iguales).padStart(4)}/${String(total).padEnd(4)} ` +
      `${((iguales / total) * 100).toFixed(1).padStart(5)}%`
  );
}
