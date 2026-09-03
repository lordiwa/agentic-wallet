import { createApp } from "vue";
import App from "./App.vue";
import { setProveedorIdToken } from "./api/gmail";
import { authConfigurado } from "./auth/config";
import { idTokenActual, marcarSinAuth, setMotorAuth } from "./auth/sesion";
import "./styles/tokens.css";
import "./styles/base.css";

/**
 * El Bearer que `api/gmail.ts` le manda a las funciones sale de acá.
 *
 * Se registra siempre, aunque el build no traiga Firebase: sin motor devuelve
 * `null`, que es exactamente "no hay sesión" y lo que el botón de Gmail espera.
 */
setProveedorIdToken(idTokenActual);

/**
 * El SDK de Firebase se carga sólo si este build tiene identidad, y en un chunk
 * aparte: el panel local entra con la llave del server y no tiene por qué
 * descargar Auth para eso.
 */
if (authConfigurado()) {
  void import("./auth/firebase")
    .then(({ motorFirebase }) => setMotorAuth(motorFirebase()))
    // Un chunk que no baja deja la sesión sin resolver para siempre. Mejor la
    // pantalla de login con el motivo escrito que una espera infinita.
    .catch(() => marcarSinAuth("No se pudo cargar el acceso con Google. Recargá la página."));
} else {
  marcarSinAuth();
}

createApp(App).mount("#app");
