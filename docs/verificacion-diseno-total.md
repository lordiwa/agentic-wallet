# Verificación del diseño total — pantalla por pantalla

Qué se comparó: cada vista y cada componente del panel contra su preview del
design system, y el bundle **servido en producción** contra la paleta.

- Previews: `/opt/data/home/wallet-panel-ds-previews/` (proyecto Claude Design
  `d509acfb-b4ad-480d-aa67-1b09b16a13c2`).
- Código: `panel/src/`.
- Producción: <https://agentic-wallet-71314.web.app/>.

La comparación es de **clases del sistema**, no de píxeles: no hay navegador
headless en este servidor (ver `docs/frontend-desplegado.md`), así que la
verificación visual final queda como deuda manual. Lo que sí se puede medir
—y es lo que garantiza que las dos pantallas se vean igual— es que el marcado
use los mismos nombres de clase que el preview, y que esas clases resuelvan a
los mismos tokens.

La columna **coincidencias** es la intersección medida entre las clases del
`<template>` y las del preview (`node` sobre los dos archivos, no a ojo).

## Pantallas

| Vista | Preview | Coincidencias | Clases propias, y por qué |
|---|---|---|---|
| `views/Resumen.vue` | `p2-resumen.html` | 18/29 — `alert amt bar btn card cards cols fill fresh lnk muted next small sub tag top topr track` | `h1 h2 tabular lnk-acc` son convenciones del panel entero; `error entrada nota chip bar-nombre cols-der` son estados que un HTML estático no tiene (fallo de red, ledger vacío). |
| `views/Preguntas.vue` | `p5b-preguntas-que-es.html` | 19/27 — `alert avance btn card fill neu paginador pie qui small sub tab tabs tabular tag top track vacio warn` | `pestana efecto lote tilde avance-txt` son el estado de la pestaña activa y el aviso del lote, que en el preview están congelados en un solo estado. |
| `views/Movimientos.vue` | `p4-movimientos.html` | 10/18 — `act btn card qui sel small sub tag top x` | La tabla en sí no está acá: vive en `TransactionsTable.vue`, que se compara aparte contra `c4`. Lo propio (`filtros controles conteo nota-cat`) es el andamiaje de los filtros. |
| `views/AltaPerfil.vue` | `p1-alta-perfil.html` | 13/25 — `btn card cols field hint inp neu note pri qui sub tag top` | `cab freno mal vacio` son la validación y el freno de onboarding incompleto; el preview muestra el formulario ya válido. |
| `components/AppShell.vue` | el shell repetido en las once `p*.html` | **7/7 — `app brand dot main nav side side-foot`, cero clases propias** | Coincidencia total: la barra lateral es literalmente el mismo marcado. |
| `components/AccessKeyScreen.vue` | `p0b-acceso-por-llave.html` | 15/16 — `box brand btn card dot err field foot hint inp mark note pri sub tagline` | Sólo `lienzo` (el fondo a pantalla completa, que en el preview es el `body`). |
| `views/Inicio.vue` | `home.html` | — | **No comparte paleta a propósito.** `home.html` es la portada institucional del sistema (`--bg:#140F22`, `--acc:#9A63F5`, Space Grotesk), no el shell del panel: no contiene ninguno de los nueve hex. Vive fuera de `AppShell` en la ruta `inicio`. |
| `views/Conectado.vue` | — | — | La vuelta de Google. No se navega, se aterriza; no tiene preview propio. Usa `top/h1/sub/note/btn` del sistema. |

## Componentes

| Componente | Preview | Coincidencias | Clases propias, y por qué |
|---|---|---|---|
| `OverviewCard.vue` | `c3-tarjeta-overview.html` | 9/14 — `a b card corner num sk sm small tag` | `cargando navega` son estados; `label` es la etiqueta accesible. |
| `SyncButton.vue` | `c1-boton-sync.html` | 6/8 — `btn fill meta spin track unit` | `meta-col tabular`. La variante (`pri`/`sec`) se elige en runtime desde `vistaGmail`. |
| `TransactionsTable.vue` | `c4-tabla-transacciones.html` | 11/31 — `amt btn card cp muted pag r rowacts sk sort tag` | El grupo `det-*` es la fila expandida, que el preview no dibuja; `aviso vacio corta media estado` son estados. |
| `ReviewCard.vue` | `c2-tarjeta-revision.html` | 16/25 — `acts btn cmp inp mail ok pane pri rc rc-b rc-h small tag truth warn why` | Incluye `pane truth why` — el panel de la lectura del parser contra la de Claude, que es la pieza que hace la tarjeta. |
| `ClassifyCard.vue` | `c7-tarjeta-clasificacion.html` | 17/21 — `acc acts btn cc cc-b cc-h cc-h-der cifras inp neu num pie pri qui small tabular tag` | `salteada aviso` (la contraparte pospuesta) y `sr label`. |
| `RecurringCard.vue` | `c8-tarjeta-gasto-fijo.html` | 17/20 — `acts btn cifras der dia neu num pie-nota pri qui rc rc-b rc-h rc-h-der small tabular tag` | Sólo `inp label sr`. |
| `PendienteCard.vue` | **nuevo** — coherente con `c3` | 6/12 — `card corner neu note small tag` | No tiene preview: es la pieza que faltaba para la fila pendiente. Se construye con el envase de `c3` (`card` + `corner`) y las piezas del sistema (`tag`, `note`, `tabular`), sin inventar ninguna. |

`tabular`, `sr` y `label` aparecen como "propias" en casi todas las filas: son
convenciones del panel entero (números tabulares, etiqueta sólo para lectores
de pantalla), definidas una vez en `base.css`. No son desvíos del sistema.

## Lo que se agregó al sistema, no al componente

- `tokens.css` suma `--why-borde` (`#F0E0B8`) y `--pane-truth-bg` (`#F4FBF7`),
  los dos de `c2-tarjeta-revision.html`. Siguen siendo los únicos hex del
  panel: `tokens.css` es el único archivo que escribe uno, y
  `panel/src/styles/tokens.test.ts` falla si aparece otro afuera.
- `base.css` suma `.btn.sec` (la secundaria de `c1`) y el bloque `.note` con
  sus variantes `ok`/`bad` — la nota de borde izquierdo de 3px que se repite
  en `c1`, `c3`, `c4` y `p4`.

## Verificación en producción

Hecha con `curl` contra el sitio publicado, no contra el build local.

- `index.html` referencia `assets/index-BVIsujhF.css` y
  `assets/index-onzhcvUu.js` — hashes distintos a los que servía antes
  (`Bb5HnUJA.css`, `C2BcNoQ8.js`).
- Los **nueve** hex del sistema están en el CSS servido: `#101A26` (1),
  `#17202A` (1), `#5B6B7C` (2), `#F6F7F9` (1), `#DDE3EA` (3), `#2B5FD9` (4),
  `#1C7A45` (2), `#E0B73A` (2), `#B3261E` (2).
- Las seis rutas están en el JS servido: `resumen`, `preguntas`, `movimientos`,
  `alta`, `conectado`, `inicio`.
- Cero cadenas de instalación local: `setup.bat`, `no hay servidor`,
  `doble clic`, `tu computadora`, `wallet.sqlite`, `tailscale`, `127.0.0.1`
  dan **0** ocurrencias. `localhost` aparece **una** vez, dentro del
  clasificador de origen loopback de `api/origins.ts` — lógica, no texto en
  pantalla. `panel/src/copy-nube.test.ts` es el candado que lo mantiene así:
  barre el `<template>` de cada `.vue` y deja el `<script>` afuera justamente
  por ese caso.
- `/overview` sin token responde `401 sin_token`; `/health` responde `200`.
