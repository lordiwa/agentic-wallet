/**
 * El motor de identidad de verdad: Firebase Auth con Google.
 *
 * Es el **único** archivo del panel que importa el SDK, y `main.ts` lo carga
 * con `import()` sólo cuando el build trae config (`authConfigurado()`). Así
 * el panel local —que entra con la llave del server— no arrastra el SDK, y los
 * tests no lo tocan nunca: hablan con `MotorAuth`, no con Firebase.
 *
 * **Acá no se piden los permisos de Gmail.** Este login es identidad: quién
 * sos. Leer tu correo es una autorización aparte, con su propia pantalla de
 * consentimiento, sus propios scopes y su propio refresh token guardado
 * cifrado del lado del servidor — es lo que hacen `gmailAuthStart` y
 * `gmailAuthCallback`. Mezclarlas acá le pediría a alguien acceso a su correo
 * para poder ver un saldo, y dejaría un token de Gmail en el navegador.
 */
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { configFirebase } from "./config";
import type { MotorAuth, Usuario } from "./sesion";

const NOMBRE_APP = "panel";

function auth(): Auth {
  const config = configFirebase();
  if (config === null) throw new Error("este build no trae config de Firebase");
  // `getApps()` y no un `let app`: en desarrollo el hot reload vuelve a
  // ejecutar el módulo, y un segundo `initializeApp` con el mismo nombre tira.
  const app = getApps().some((a) => a.name === NOMBRE_APP)
    ? getApp(NOMBRE_APP)
    : initializeApp(config, NOMBRE_APP);
  return getAuth(app);
}

function aUsuario(user: User | null): Usuario | null {
  if (user === null) return null;
  return { uid: user.uid, email: user.email, nombre: user.displayName };
}

/** Los códigos que valen un mensaje propio. El resto cae en uno genérico: un
 * `auth/internal-error` crudo en pantalla no le sirve a nadie. */
function explicar(codigo: string): string {
  switch (codigo) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Cerraste la ventana de Google antes de terminar.";
    case "auth/network-request-failed":
      return "No se pudo hablar con Google. Revisá la conexión.";
    case "auth/unauthorized-domain":
      return "Este dominio no está autorizado en Firebase Auth.";
    case "auth/operation-not-allowed":
      return "El acceso con Google no está habilitado en el proyecto.";
    default:
      return "No se pudo entrar con Google.";
  }
}

function codigoDe(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string"
    ? (e as { code: string }).code
    : "";
}

export function motorFirebase(): MotorAuth {
  return {
    observar(alCambiar) {
      return onAuthStateChanged(auth(), (user) => alCambiar(aUsuario(user)));
    },

    async entrarConGoogle() {
      const proveedor = new GoogleAuthProvider();
      // Sin esto, quien tiene varias cuentas de Google entra con la última sin
      // que se le pregunte cuál — y este panel lee el correo de una cuenta.
      proveedor.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(auth(), proveedor);
      } catch (e) {
        const codigo = codigoDe(e);
        // El popup bloqueado no es un fallo del login: es una preferencia del
        // navegador. Se reintenta redirigiendo la pestaña, que ningún bloqueador
        // interrumpe. Los demás códigos sí son el final del intento.
        if (codigo === "auth/popup-blocked" || codigo === "auth/operation-not-supported-in-this-environment") {
          await signInWithRedirect(auth(), proveedor);
          return;
        }
        throw new Error(explicar(codigo));
      }
    },

    async salir() {
      await signOut(auth());
    },

    async idToken() {
      const user = auth().currentUser;
      if (user === null) return null;
      // Sin `forceRefresh`: el SDK ya renueva solo cuando al token le quedan
      // menos de cinco minutos, y forzarlo en cada llamada es un viaje de red
      // de más por cada consulta de estado.
      return user.getIdToken();
    },
  };
}
