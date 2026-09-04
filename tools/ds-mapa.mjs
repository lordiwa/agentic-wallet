/**
 * El mapa pantalla -> tarjeta del design system, y el arnés que lo recorre.
 *
 * Cada entrada dice qué archivos del panel dibujan esa tarjeta. `base.css` y
 * `AppShell.vue` van en todas porque el vocabulario común (`.card`, `.btn`,
 * `.tag`, `.num`) y el andamio viven ahí, no en cada vista.
 *
 * Dos ajustes hacen que el número mida diseño y no ruido:
 *
 * - `alias` traduce un selector del preview al del panel cuando el mismo bloque
 *   cambió de gancho. El caso típico es `body`: en el preview la página ES el
 *   lienzo, y en el panel el lienzo es un `div` porque arriba va el chip de
 *   backend, que la tarjeta no dibuja.
 * - `ignorar` saca lo que es andamio del prototipo y no de la aplicación: los
 *   chips `.flow`/`.chip` que enlazan una tarjeta con la siguiente, y las
 *   `.leyenda` que rotulan los estados extra que la tarjeta muestra de más.
 */
export const COMUN = ["panel/src/styles/base.css", "panel/src/components/AppShell.vue"];

/**
 * `min-height` del lienzo: el preview fija una altura de maqueta (820/860px)
 * para que la tarjeta se vea completa en la galería. La aplicación usa el alto
 * de la ventana. No es una diferencia de diseño.
 */
export const PROPS_IGNORADAS = new Set(["min-height"]);

/**
 * `a.btn` / `a.btn:hover`: la tarjeta las escribe aparte porque su prototipo
 * navega con anclas. En el panel `.btn` ya trae `display:inline-flex`,
 * `text-decoration:none` y `cursor:pointer`, así que es la misma regla.
 */
const ANCLAS = { "a.btn": ".btn", "a.btn:hover": ".btn:hover" };

/** Chips del prototipo: enlazan una tarjeta con la siguiente, no son la app. */
const PROTOTIPO = [".flow", ".chip", ".chip.now", ".leyenda"];

/**
 * La galería de estados del chip de backend que `p0b` dibuja debajo de la
 * tarjeta, bajo el rótulo "El chip de backend, que acompaña a esta pantalla".
 * Documenta a `BackendChip`, que es otro componente y tiene su propia entrada.
 */
const GALERIA_CHIP = [".estados", ".estado", ".estado .t", ".estado .t b"];

/**
 * El andamio de una hoja de componente (`c*.html`): el título de la hoja, su
 * bajada, la rejilla que muestra las variantes una al lado de la otra y la
 * galería de estados. Documenta al componente; no es el componente.
 */
const HOJA = [
  "body",
  "h1",
  // En una hoja de componente `h2` no es el título de una tarjeta: es el rótulo
  // de sección de la hoja ("Estados", "Variantes"), y por eso viene en
  // mayúsculas de 11px como en `00-fundamentos.html`. El `h2` de la aplicación
  // es el de las `p*.html` (14px), que sí se compara.
  "h2",
  ".lede",
  ".grid",
  ".two",
  ".row",
  ".wrap",
  ".unit",
  ".st",
  ".st .lbl",
  ".st .lbl b",
  ".st .lbl code",
  ".states",
  ".mini",
  ".mini b",
  ".mini p",
  ".mini.empty",
  ".mini.err",
  ".sk",
  ".sk.a",
  ".sk.b",
  ".nav a",
  ".nav a:hover",
  ".reglas",
  ".reglas h2",
  ".reglas li",
];

/**
 * Reglas que una tarjeta posterior dejó atrás.
 *
 * La etiqueta `.tag` se achicó en algún momento del sistema: `11.5px / 2px 9px
 * / gap 5px` sólo sobrevive en las cuatro tarjetas más viejas (`00-fundamentos`,
 * `p1`, `p2`, `p3`, todas del 2 de septiembre). Las quince revisadas después
 * —incluida `p1b`, que es la nueva versión de `p1`— dicen `11px / 1px 8px /
 * gap 4px`, y ese es el valor que lleva `base.css`.
 *
 * O sea que acá la tarjeta vieja es la que no está al día, no el panel. Se
 * excluyen esas tres propiedades para no contar como deriva lo que es la
 * versión anterior del sistema; el resto de `.tag` se sigue comparando.
 */
const TAG_VIEJA = {
  ".tag": ["gap", "font-size", "padding"],
  /*
   * El mismo caso, con el borde del botón apagado: las cinco tarjetas del 2 de
   * septiembre le dan un gris propio (`#E4E9EF`) y las tres del 3 —`p5b`, `c7`,
   * `c8`— lo igualan al fondo (`#F0F3F7`), que es lo que lleva `base.css`.
   */
  ".btn.dis": ["border-color"],
};

const LIENZO = {
  // `.btn.off` es como la tarjeta llama al botón apagado; el panel usa el
  // estado real del elemento, `:disabled`.
  alias: { body: ".lienzo", ".btn.off": ".btn:disabled", ...ANCLAS },
  ignorar: [...PROTOTIPO, ...GALERIA_CHIP],
  superadas: TAG_VIEJA,
  // En las dos pantallas de acceso el componente ES la pantalla entera: su
  // tarjeta de radio 12 y su botón de ancho completo mandan sobre el
  // vocabulario común, no al revés.
  propiasPrimero: true,
};
/*
 * En una `p*.html` el `body` ES el lienzo de la aplicación, y `base.css` lo
 * escribe igual — así que acá no se traduce nada: se compara `body` con `body`.
 * Sólo en las dos pantallas de acceso el lienzo es un `div` (`.lienzo`), porque
 * arriba va el chip de backend que la tarjeta no dibuja.
 */
const PAGINA = {
  // `.bar span:first-child` es el nombre de la categoría en la barra del
  // Resumen; el panel le pone clase en vez de contarlo por posición.
  alias: { ".wrap": ".contenido", ".bar span:first-child": ".bar-nombre", ...ANCLAS },
  ignorar: PROTOTIPO,
};
const PAGINA_VIEJA = { ...PAGINA, superadas: TAG_VIEJA };
const COMPONENTE = { alias: ANCLAS, ignorar: [...PROTOTIPO, ...HOJA], superadas: TAG_VIEJA, propiasPrimero: true };

export const MAPA = [
  ["p0b-acceso-por-llave", ["panel/src/components/AccessKeyScreen.vue"], LIENZO],
  ["p0-acceso", ["panel/src/components/EntrarConGoogle.vue"], LIENZO],
  [
    "p2-resumen",
    [
      "panel/src/views/Resumen.vue",
      "panel/src/components/OverviewCard.vue",
      "panel/src/components/SyncButton.vue",
    ],
    PAGINA_VIEJA,
  ],
  [
    "p3-sincronizacion",
    ["panel/src/views/Conectado.vue", "panel/src/components/ConectarGmail.vue"],
    PAGINA_VIEJA,
  ],
  [
    "p4-movimientos",
    ["panel/src/views/Movimientos.vue", "panel/src/components/TransactionsTable.vue"],
    PAGINA,
  ],
  [
    "p5b-preguntas-que-es",
    [
      "panel/src/views/Preguntas.vue",
      "panel/src/components/ReviewCard.vue",
      "panel/src/components/ClassifyCard.vue",
    ],
    PAGINA,
  ],
  /*
   * `p1` está superada por `p1b` y no se cuenta en el total.
   *
   * Son la misma pantalla en dos versiones: `p1 — Alta y perfil` (2 de
   * septiembre) y `p1b — Gastos fijos y perfil` (3 de septiembre). `p1b` no es
   * un agregado sino un reemplazo — le saca a `p1` el checklist de pasos
   * (`.step`/`.tick`) y el panel "El agente propone" (`.sug`), y en su lugar
   * lee los gastos fijos del historial. `AltaPerfil.vue` dibuja `p1b`, empezando
   * por su título.
   *
   * Por eso el 71% contra `p1` no es deriva: es la distancia con el diseño
   * anterior. Construir `.step` y `.sug` sería volver atrás, y además inventar
   * una función que `p1b` no pide.
   */
  ["p1-alta-perfil", ["panel/src/views/AltaPerfil.vue"], { ...PAGINA_VIEJA, superadaPor: "p1b-gastos-fijos-y-perfil" }],
  [
    "p1b-gastos-fijos-y-perfil",
    ["panel/src/views/AltaPerfil.vue", "panel/src/components/RecurringCard.vue"],
    PAGINA,
  ],
  ["c1-boton-sync", ["panel/src/components/SyncButton.vue"], COMPONENTE],
  ["c2-tarjeta-revision", ["panel/src/components/ReviewCard.vue"], COMPONENTE],
  ["c3-tarjeta-overview", ["panel/src/components/OverviewCard.vue"], COMPONENTE],
  ["c4-tabla-transacciones", ["panel/src/components/TransactionsTable.vue"], COMPONENTE],
  ["c7-tarjeta-clasificacion", ["panel/src/components/ClassifyCard.vue"], COMPONENTE],
  ["c8-tarjeta-gasto-fijo", ["panel/src/components/RecurringCard.vue"], COMPONENTE],
];

export const PREVIEWS = "/opt/data/home/wallet-panel-ds-previews";
