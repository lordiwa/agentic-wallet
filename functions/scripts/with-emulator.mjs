/**
 * Levanta los emuladores de Firestore y Auth, corre el comando que le pasen, y
 * los baja pase lo que pase.
 *
 * Existe porque `firebase emulators:exec` corre desde la raiz del repo y con la
 * configuracion entera (incluido hosting y el predeploy de functions), y eso
 * hace que un `npm test` de esta carpeta dependa de que el panel compile. Acá
 * se levanta sólo lo que los tests tocan.
 *
 * El emulador de Firestore es Java. Si `java` no está en el PATH, este script
 * lo dice con todas las letras en vez de dejar un timeout de dos minutos.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";

const FIRESTORE_PORT = process.env.WALLET_FIRESTORE_EMULATOR_PORT ?? "8080";
const AUTH_PORT = process.env.WALLET_AUTH_EMULATOR_PORT ?? "9099";
const PROJECT_ID = process.env.WALLET_EMULATOR_PROJECT ?? "agentic-wallet-test";

const comando = process.argv.slice(2);
if (comando.length === 0) {
  console.error("uso: node scripts/with-emulator.mjs <comando> [args...]");
  process.exit(2);
}

const entorno = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${FIRESTORE_PORT}`,
  FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${AUTH_PORT}`,
  GCLOUD_PROJECT: PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
};

const emulador = spawn(
  "firebase",
  [
    "emulators:start",
    "--only",
    "firestore,auth",
    "--project",
    PROJECT_ID,
    "--config",
    new URL("../../firebase.json", import.meta.url).pathname,
  ],
  { env: entorno, stdio: ["ignore", "pipe", "pipe"] }
);

let salida = "";
emulador.stdout.on("data", (chunk) => {
  salida += chunk.toString();
});
emulador.stderr.on("data", (chunk) => {
  salida += chunk.toString();
});

async function esperarListo(timeoutMs = 90_000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (/java.*not.*found|Could not spawn `java/i.test(salida)) {
      throw new Error(
        "el emulador de Firestore necesita Java en el PATH. Instala un JRE 11+ y volve a correr."
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${FIRESTORE_PORT}/`);
      if (res.ok || res.status === 200) return;
    } catch {
      // todavia no levanto
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`el emulador no levanto en ${timeoutMs} ms.\n${salida.slice(-3000)}`);
}

let codigo = 1;
try {
  await esperarListo();
  const hijo = spawn(comando[0], comando.slice(1), { env: entorno, stdio: "inherit", shell: false });
  const [salidaHijo] = await once(hijo, "exit");
  codigo = salidaHijo ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  codigo = 1;
} finally {
  emulador.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  if (!emulador.killed) emulador.kill("SIGKILL");
}

process.exit(codigo);
