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
  // `base.css` primero: el estilo *scoped* de un componente gana sobre el
  // vocabulario común, igual que en el navegador.
  const vista = estilosDeVue([...COMUN, ...archivos]);
  const r = comparar(preview, vista, { ...ajustes, propsIgnoradas: PROPS_IGNORADAS });
  const pct = r.total === 0 ? 100 : (r.iguales / r.total) * 100;
  filas.push([tarjeta, archivos, r, pct]);

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
  for (const [tarjeta, archivos, r, pct] of filas) {
    total += r.total;
    iguales += r.iguales;
    console.log(
      `${tarjeta.padEnd(28)} ${String(r.iguales).padStart(4)}/${String(r.total).padEnd(4)} ` +
        `${pct.toFixed(1).padStart(5)}%   ${archivos.map((a) => a.split("/").pop()).join(", ")}`
    );
  }
  console.log(
    `${"TOTAL".padEnd(28)} ${String(iguales).padStart(4)}/${String(total).padEnd(4)} ` +
      `${((iguales / total) * 100).toFixed(1).padStart(5)}%`
  );
}
