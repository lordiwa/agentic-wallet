// Genera el sitio estatico de documentacion del panel de manejo.
//
// La fuente de verdad son los .md de docs/: este script los LEE y nunca los
// escribe. Si el HTML y el markdown no coinciden, el que manda es el markdown.
//
//   node docs-site/build.mjs   ->   docs-site/dist/

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import hljs from "highlight.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "..", "docs");
const OUT = join(HERE, "dist");

const SITE = {
  title: "Panel de manejo — documentación",
  tagline: "Agentic Wallet",
  intro:
    "La documentación completa del panel de manejo: el plan de producto, la " +
    "auditoría de qué se puede alimentar con el backend real, el recorrido " +
    "clickeable del prototipo, el roadmap de implementación y el wargaming " +
    "que lo puso a prueba. Es el mismo markdown del repo, sin recortes.",
};

// El orden importa: es el orden en que se escribieron y en que conviene leerlos.
const PAGES = [
  {
    slug: "panel-manejo-flujo",
    nav: "1. Flujo de pantallas",
    group: "El plan",
    summary:
      "El plan de producto y arquitectura: qué existe hoy en el motor, qué " +
      "falta, y las once pantallas del panel con lo que cada una tiene que " +
      "dejar hacer. No implementa nada.",
  },
  {
    slug: "panel-viabilidad",
    nav: "2. Auditoría de viabilidad",
    group: "El plan",
    summary:
      "Pantalla por pantalla del diseño contra lo que el backend expone de " +
      "verdad. Sale con los huecos numerados H1..H26 y un veredicto por pieza.",
  },
  {
    slug: "flujo-app-prototipo",
    nav: "3. Recorrido del prototipo",
    group: "El plan",
    summary:
      "El guion de interacción: qué pantalla lleva a cuál, con qué gesto, y " +
      "en qué estado queda cada componente. La ficha completa de las 19 " +
      "tarjetas del prototipo clickeable.",
  },
  {
    slug: "panel-roadmap-implementacion",
    nav: "4. Roadmap de implementación",
    group: "La ejecución",
    summary:
      "La estimación de compromiso: seis fases, en qué orden, cuánto cuesta " +
      "cada una, qué se puede recortar y qué tickets salen de ahí.",
  },
  {
    slug: "panel-prep-implementacion",
    nav: "5. Preparación probada",
    group: "La ejecución",
    summary:
      "Un wargaming adversario del roadmap: lo ataca con el código y los " +
      "datos reales en la mano, y sale con el plan preparatorio que sí se " +
      "sostiene.",
  },
  {
    slug: "naming",
    nav: "Naming del producto",
    group: "Anexo",
    summary:
      "Candidatos de marca para el agente. Material de decisión, no una " +
      "decisión tomada.",
  },
];

const BY_SLUG = new Map(PAGES.map((p) => [p.slug, p]));

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Los titulos vienen con tildes y con `codigo`; el id tiene que sobrevivir a
// ambos y seguir siendo estable entre builds.
function slugify(text) {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "seccion"
  );
}

// Devuelve { html, toc, title, words } para un markdown.
function render(markdown) {
  const toc = [];
  const seen = new Map();
  let title = null;

  const marked = new Marked({ gfm: true, breaks: false });

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        // parseInline ya devolvio entidades (&quot;, &amp;): sin decodificar,
        // el id termina con "quot" pegado en el medio.
        const plain = inner
          .replace(/<[^>]+>/g, "")
          .replace(/&(quot|#34);/g, '"')
          .replace(/&(apos|#39);/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .trim();
        let id = slugify(plain);
        const hits = seen.get(id) ?? 0;
        seen.set(id, hits + 1);
        if (hits) id = `${id}-${hits + 1}`;

        if (depth === 1 && title === null) title = plain;
        if (depth === 2 || depth === 3) toc.push({ id, text: plain, depth });

        return (
          `<h${depth} id="${id}">` +
          `<a class="anchor" href="#${id}" aria-label="Enlace a esta sección">#</a>` +
          `${inner}</h${depth}>\n`
        );
      },

      code({ text, lang }) {
        // Los diagramas ASCII no tienen lenguaje: resaltarlos por adivinanza
        // los deja peor que en texto plano. Solo se resalta lo declarado.
        const language = (lang || "").split(/\s+/)[0];
        if (language && hljs.getLanguage(language)) {
          const out = hljs.highlight(text, { language, ignoreIllegals: true }).value;
          return `<pre class="code"><code class="hljs language-${escapeHtml(language)}">${out}</code></pre>\n`;
        }
        return `<pre class="code"><code>${escapeHtml(text)}</code></pre>\n`;
      },

      // Las referencias cruzadas de los docs van como `docs/otro-doc.md`.
      // Se dejan tal cual, pero se vuelven clickeables cuando el destino
      // tambien esta publicado acá.
      codespan({ text }) {
        const target = /^docs\/([a-z0-9-]+)\.md$/.exec(text);
        if (target && BY_SLUG.has(target[1])) {
          return `<a class="xref" href="./${target[1]}.html"><code>${escapeHtml(text)}</code></a>`;
        }
        return `<code>${escapeHtml(text)}</code>`;
      },

      // Los docs tienen tablas anchas: en el celular necesitan scroll propio
      // en vez de reventar el ancho de la pagina.
      table(token) {
        const html = Object.getPrototypeOf(this).table.call(this, token);
        return `<div class="table-wrap">${html}</div>\n`;
      },
    },
  });

  const html = marked.parse(markdown);
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return { html, toc, title, words };
}

function sidebar(activeSlug, activeToc) {
  const groups = [];
  for (const page of PAGES) {
    let group = groups.find((g) => g.name === page.group);
    if (!group) groups.push((group = { name: page.group, pages: [] }));
    group.pages.push(page);
  }

  const home =
    `<a class="nav-link nav-home${activeSlug === null ? " is-active" : ""}" href="./index.html">Inicio</a>`;

  const body = groups
    .map((group) => {
      const items = group.pages
        .map((page) => {
          const active = page.slug === activeSlug;
          const link =
            `<a class="nav-link${active ? " is-active" : ""}" href="./${page.slug}.html">` +
            `${escapeHtml(page.nav)}</a>`;
          if (!active || !activeToc?.length) return `<li>${link}</li>`;
          const sub = activeToc
            .filter((h) => h.depth === 2)
            .map((h) => `<li><a class="nav-sub" href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
            .join("");
          return `<li>${link}<ul class="nav-toc">${sub}</ul></li>`;
        })
        .join("");
      return `<p class="nav-group">${escapeHtml(group.name)}</p><ul class="nav-list">${items}</ul>`;
    })
    .join("");

  return `${home}${body}`;
}

function shell({ slug, pageTitle, headExtra = "", main, activeToc }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(SITE.intro.slice(0, 180))}">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="./assets/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%232f6df6'/><path d='M9 21V11h4.5a3.2 3.2 0 010 6.4H9' stroke='white' stroke-width='2.4' fill='none' stroke-linecap='round'/></svg>">
${headExtra}
</head>
<body>
<a class="skip" href="#contenido">Saltar al contenido</a>

<header class="topbar">
  <button class="burger" id="burger" aria-label="Abrir navegación" aria-expanded="false" aria-controls="sidebar">
    <span></span><span></span><span></span>
  </button>
  <a class="brand" href="./index.html">
    <span class="brand-mark">AW</span>
    <span class="brand-text"><b>${escapeHtml(SITE.tagline)}</b><small>Panel de manejo — docs</small></span>
  </a>
</header>

<div class="layout">
  <aside class="sidebar" id="sidebar">
    <nav>${sidebar(slug, activeToc)}</nav>
    <p class="nav-foot">Generado desde <code>docs/*.md</code>.<br>El markdown del repo es la fuente de verdad.</p>
  </aside>
  <div class="scrim" id="scrim" hidden></div>
  <main id="contenido">${main}</main>
</div>

<script src="./assets/app.js" defer></script>
</body>
</html>
`;
}

function readingTime(words) {
  return Math.max(1, Math.round(words / 220));
}

function buildIndex(built) {
  const cards = built
    .map(
      (b) => `<a class="card" href="./${b.slug}.html">
  <span class="card-kicker">${escapeHtml(b.group)}</span>
  <h2>${escapeHtml(b.title)}</h2>
  <p>${escapeHtml(b.summary)}</p>
  <span class="card-meta">${b.toc.filter((h) => h.depth === 2).length} secciones · ~${readingTime(b.words)} min</span>
</a>`,
    )
    .join("\n");

  const main = `<article class="doc home">
  <p class="eyebrow">${escapeHtml(SITE.tagline)}</p>
  <h1>${escapeHtml(SITE.title)}</h1>
  <p class="lede">${escapeHtml(SITE.intro)}</p>
  <div class="cards">${cards}</div>
  <section class="note">
    <h2 id="como-leerlo">Cómo leerlo</h2>
    <p>Los cinco documentos del panel se escribieron en cadena y cada uno se
    apoya en el anterior: el <b>plan</b> dice qué debería hacer el panel, la
    <b>auditoría</b> mide cuánto de eso aguanta el backend de hoy, el
    <b>recorrido</b> lo vuelve un prototipo que se puede tocar, el
    <b>roadmap</b> pone plazos y tickets, y la <b>preparación</b> ataca al
    roadmap para ver qué se cae. Leídos en orden, cuentan la discusión
    completa.</p>
    <p>Ningún documento contiene datos financieros ni personales: son planes y
    arquitectura. Las cifras del ledger que aparecen son conteos agregados
    (cuántas filas, cuántas sin categoría), nunca montos ni contrapartes
    reales.</p>
  </section>
</article>`;

  return shell({ slug: null, pageTitle: SITE.title, main, activeToc: null });
}

function buildDoc(b, index) {
  const prev = index > 0 ? built[index - 1] : null;
  const next = index < built.length - 1 ? built[index + 1] : null;

  const toc = b.toc.length
    ? `<details class="toc" open>
  <summary>En esta página</summary>
  <ol>${b.toc
    .map((h) => `<li class="lvl-${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
    .join("")}</ol>
</details>`
    : "";

  const pager = `<nav class="pager">
  ${prev ? `<a class="pager-prev" href="./${prev.slug}.html"><span>Anterior</span><b>${escapeHtml(prev.nav)}</b></a>` : "<span></span>"}
  ${next ? `<a class="pager-next" href="./${next.slug}.html"><span>Siguiente</span><b>${escapeHtml(next.nav)}</b></a>` : "<span></span>"}
</nav>`;

  const main = `<article class="doc">
  <p class="eyebrow"><a href="./index.html">Documentación</a> <span>/</span> ${escapeHtml(b.group)}</p>
  <p class="source">Fuente: <code>docs/${b.slug}.md</code> · ~${readingTime(b.words)} min de lectura</p>
  ${toc}
  ${b.html}
  ${pager}
</article>`;

  return shell({
    slug: b.slug,
    pageTitle: `${b.title} — ${SITE.tagline}`,
    main,
    activeToc: b.toc,
  });
}

function build404() {
  const main = `<article class="doc">
  <h1>Esa página no existe</h1>
  <p class="lede">El enlace apunta a un documento que no está publicado acá.
  Volvé al <a href="./index.html">índice</a> y elegí desde la lista.</p>
</article>`;
  return shell({ slug: null, pageTitle: `No encontrado — ${SITE.tagline}`, main, activeToc: null });
}

// --- build -------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const built = PAGES.map((page) => {
  const markdown = readFileSync(join(DOCS, `${page.slug}.md`), "utf8");
  const r = render(markdown);
  return { ...page, ...r, title: r.title ?? page.nav };
});

built.forEach((b, i) => {
  writeFileSync(join(OUT, `${b.slug}.html`), buildDoc(b, i));
});
writeFileSync(join(OUT, "index.html"), buildIndex(built));
writeFileSync(join(OUT, "404.html"), build404());
cpSync(join(HERE, "assets"), join(OUT, "assets"), { recursive: true });

const total = built.reduce((n, b) => n + b.words, 0);
console.log(`docs-site: ${built.length + 2} paginas, ${total.toLocaleString("es")} palabras -> docs-site/dist`);
for (const b of built) {
  console.log(`  ${b.slug}.html  ${b.toc.length} encabezados  ${b.words} palabras`);
}
