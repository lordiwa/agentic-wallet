# docs-site — la documentación del panel, en el navegador

Sitio estático que publica los documentos del **panel de manejo** para poder
leerlos desde el celular, sin abrir los `.md` del servidor.

**URL:** <https://agentic-wallet-71314.web.app>

## Qué publica

| Página | Fuente |
|---|---|
| Índice | generado |
| 1. Flujo de pantallas | `docs/panel-manejo-flujo.md` |
| 2. Auditoría de viabilidad | `docs/panel-viabilidad.md` |
| 3. Recorrido del prototipo | `docs/flujo-app-prototipo.md` |
| 4. Roadmap de implementación | `docs/panel-roadmap-implementacion.md` |
| 5. Preparación probada | `docs/panel-prep-implementacion.md` |
| Naming del producto | `docs/naming.md` |

Los `.md` de `docs/` son la **fuente de verdad**: `build.mjs` los lee y nunca
los escribe. El HTML se genera entero desde ellos, sin recortes ni resúmenes.
Para agregar un documento se toca la lista `PAGES` de `build.mjs`, no el HTML.

## Comandos

```
npm run build:docs    # desde la raíz: instala y genera docs-site/dist/
npm run deploy:docs   # build + firebase deploy --only hosting
```

`docs-site/dist/` es artefacto de build: no va al repo (`dist/` está en
`.gitignore`). Las dependencias (`marked`, `highlight.js`) viven acá adentro,
fuera de los workspaces de `server/` y `web/`, para no meterle nada al motor.

## Qué se publica y qué no

El sitio es **público**. Los documentos del panel son planes y arquitectura:
no llevan montos, contrapartes reales, correos, ni credenciales. Las cifras del
ledger que aparecen son conteos agregados (cuántas filas hay, cuántas sin
categoría). Antes de cada deploy conviene rehacer el barrido:

```
grep -rEi "[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|AIza|ya29\.|ghp_|[0-9]{9,}" docs-site/dist/*.html
```

Si algún documento nuevo trae datos personales, **no se agrega a `PAGES`**.

## Por qué no es Vue

La regla del proyecto es Vue 3 para todo lo que sea aplicación. Esto no es una
aplicación: son seis documentos de texto que no cambian entre visitas. Un
framework acá sólo agregaría un runtime que el lector tiene que descargar para
leer un párrafo. El sitio son ocho HTML, un CSS y 60 líneas de JS para el menú
del celular.
