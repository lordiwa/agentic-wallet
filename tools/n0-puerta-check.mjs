/**
 * Verificación de la fase N0 contra el server REAL (TASK-054, criterio 11).
 *
 * Levanta `server/dist/index.js` con `WALLET_ACCESS_TOKEN` y
 * `WALLET_ALLOWED_ORIGINS` seteadas, y lo golpea con `curl` de dos formas:
 *
 *   1. **Directo** a `127.0.0.1:PORT` — el server tal cual escucha.
 *   2. **A través de un salto de proxy** que reproduce lo que hace
 *      `tailscale serve --bg <PORT>`: termina la conexión afuera y la
 *      reenvía a `127.0.0.1:PORT` agregando `X-Forwarded-Proto/For/Host`.
 *      Es el mismo camino que recorre una petición del tailnet, sin exigir
 *      un tailnet.
 *
 * NO reemplaza al punto del checklist D14 que le toca a Mato: `tailscale
 * serve` de verdad, en su máquina, contra su tailnet. Esta máquina no tiene
 * el binario instalado. Lo que esto prueba es que el server responde
 * correctamente a lo que ese proxy le va a mandar.
 *
 *   node tools/n0-puerta-check.mjs
 */
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = 38300;
const PUERTO_PROXY = 38301;
const TOKEN = "n0-check-token-de-prueba-no-es-secreto";
const ORIGEN = "https://panel.ejemplo.web.app";

const resultados = [];

function registrar(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? "  OK  " : " FALLA"} ${nombre}\n         ${detalle}`);
}

async function curl(args) {
  return new Promise((resolve) => {
    const proc = spawn("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}|%{header_json}", ...args]);
    let out = "";
    proc.stdout.on("data", (chunk) => (out += chunk));
    proc.on("close", () => {
      const [code, headersRaw] = out.split("|");
      let headers = {};
      try {
        headers = JSON.parse(headersRaw ?? "{}");
      } catch {
        /* header_json necesita curl >= 7.83; sin el, solo miramos el status */
      }
      resolve({ status: Number(code), headers });
    });
  });
}

async function curlBody(args) {
  return new Promise((resolve) => {
    const proc = spawn("curl", ["-s", ...args]);
    let out = "";
    proc.stdout.on("data", (chunk) => (out += chunk));
    proc.on("close", () => resolve(out));
  });
}

/** El salto que hace `tailscale serve`: termina afuera, reenvía a localhost. */
function levantarProxy() {
  const proxy = createServer((req, res) => {
    const headers = {
      ...req.headers,
      host: `127.0.0.1:${PUERTO}`,
      "x-forwarded-proto": "https",
      "x-forwarded-for": "100.64.0.9",
      "x-forwarded-host": "maquina.tail-ejemplo.ts.net",
    };
    const opciones = { hostname: "127.0.0.1", port: PUERTO, path: req.url, method: req.method, headers };
    const arriba = httpRequest(opciones, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    arriba.on("error", () => {
      res.writeHead(502).end();
    });
    req.pipe(arriba);
  });
  return new Promise((resolve) => proxy.listen(PUERTO_PROXY, "127.0.0.1", () => resolve(proxy)));
}

async function esperarServer(url, intentos = 60) {
  for (let i = 0; i < intentos; i += 1) {
    const { status } = await curl([url]);
    if (status === 200) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "n0-check-")), "check.sqlite");
const server = spawn("node", [path.join(RAIZ, "server/dist/index.js")], {
  cwd: RAIZ,
  env: {
    ...process.env,
    PORT: String(PUERTO),
    WALLET_BIND_HOST: "127.0.0.1",
    WALLET_ACCESS_TOKEN: TOKEN,
    WALLET_ALLOWED_ORIGINS: ORIGEN,
    WALLET_DB_PATH: dbPath,
    WALLET_TELEMETRY_SILENT: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

const proxy = await levantarProxy();
const directo = `http://127.0.0.1:${PUERTO}`;
const tailnet = `http://127.0.0.1:${PUERTO_PROXY}`;

try {
  if (!(await esperarServer(`${directo}/api/health`))) {
    console.error("El server no levantó.");
    process.exit(1);
  }

  console.log(`\n=== 1. Directo contra 127.0.0.1:${PUERTO} (el server real) ===\n`);

  const health = await curlBody([`${directo}/api/health`]);
  registrar("GET /api/health sin llave responde y declara auth_required", health.includes('"auth_required":true'), health);

  const sinLlave = await curl([`${directo}/api/overview`]);
  registrar("GET /api/overview sin cabecera -> 401", sinLlave.status === 401, `HTTP ${sinLlave.status}`);

  const malaLlave = await curl(["-H", "Authorization: Bearer llave-equivocada", `${directo}/api/overview`]);
  registrar("GET /api/overview con llave incorrecta -> 401", malaLlave.status === 401, `HTTP ${malaLlave.status}`);

  const buenaLlave = await curl(["-H", `Authorization: Bearer ${TOKEN}`, `${directo}/api/overview`]);
  registrar("GET /api/overview con la llave correcta -> 200", buenaLlave.status === 200, `HTTP ${buenaLlave.status}`);

  const healthConLlave = await curlBody(["-H", `Authorization: Bearer ${TOKEN}`, `${directo}/api/health`]);
  registrar(
    "GET /api/health con la llave dice authenticated:true",
    healthConLlave.includes('"authenticated":true'),
    healthConLlave
  );

  const preflight = await curl([
    "-X",
    "OPTIONS",
    "-H",
    `Origin: ${ORIGEN}`,
    "-H",
    "Access-Control-Request-Method: DELETE",
    "-H",
    "Access-Control-Request-Headers: authorization,content-type",
    `${directo}/api/overview`,
  ]);
  const permiteHeaders = String(preflight.headers["access-control-allow-headers"] ?? "");
  const permiteMetodos = String(preflight.headers["access-control-allow-methods"] ?? "");
  registrar(
    "Preflight OPTIONS del origen permitido -> 204 sin llave",
    preflight.status === 204,
    `HTTP ${preflight.status}`
  );
  registrar(
    "CORS permite Authorization y DELETE",
    permiteHeaders.includes("Authorization") && permiteMetodos.includes("DELETE"),
    `allow-headers=${permiteHeaders} allow-methods=${permiteMetodos}`
  );

  const origenAjeno = await curl(["-H", "Origin: https://host-ajeno.example", `${directo}/api/health`]);
  registrar(
    "Un origen fuera de la lista no recibe cabecera CORS",
    !("access-control-allow-origin" in origenAjeno.headers),
    JSON.stringify(origenAjeno.headers["access-control-allow-origin"] ?? null)
  );

  console.log(`\n=== 2. Por el salto de proxy (lo que hace 'tailscale serve') ===\n`);

  const healthTailnet = await curlBody([`${tailnet}/api/health`]);
  registrar(
    "GET /api/health a través del proxy responde sin llave",
    healthTailnet.includes('"auth_required":true'),
    healthTailnet
  );

  const sinLlaveTailnet = await curl([`${tailnet}/api/overview`]);
  registrar("GET /api/overview por el proxy sin llave -> 401", sinLlaveTailnet.status === 401, `HTTP ${sinLlaveTailnet.status}`);

  const conLlaveTailnet = await curl(["-H", `Authorization: Bearer ${TOKEN}`, `${tailnet}/api/overview`]);
  registrar(
    "GET /api/overview por el proxy con la llave -> 200",
    conLlaveTailnet.status === 200,
    `HTTP ${conLlaveTailnet.status}`
  );

  const spa = await curl([`${tailnet}/`]);
  registrar("La SPA sigue sirviéndose sin llave (no es /api/*)", spa.status === 200, `HTTP ${spa.status}`);
} finally {
  server.kill();
  proxy.close();
}

const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} verificaciones en verde.`);
process.exit(fallas.length === 0 ? 0 : 1);
