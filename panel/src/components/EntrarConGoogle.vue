<script setup lang="ts">
/**
 * `P0-b — Entrar`, la variante con identidad.
 *
 * Es el mismo lienzo de `AccessKeyScreen` (el de `p0b-acceso-por-llave.html`)
 * con la otra credencial: el panel local entra con la llave del server, y el
 * panel publicado entra con una cuenta de Google. Nunca las dos pantallas a la
 * vez — `App.vue` muestra la que corresponda al build.
 *
 * La pantalla dice **qué se pide ahora y qué no**: entrar es identidad, leer el
 * correo es un permiso aparte que se pide después y con su propia pantalla de
 * Google. Que eso se lea antes del click es la mitad del trabajo de esta
 * pantalla; la otra mitad es no pedir nada más.
 *
 * El botón, el logotipo y el bloque de permisos son los de `p0-acceso.html`
 * (`.gbtn`, `.scopes`, `.tick`). Los cuatro hex de la marca de Google viven en
 * `tokens.css` como `--google-*`: la regla es que ningún componente escriba un
 * hex, no que el panel se quede sin el logotipo.
 */
import { isDemoMode } from "../api/base";
import { useSesion, type SesionVista } from "../composables/useSesion";

const props = defineProps<{
  /** Una sesión ya armada (la usan los tests). Si no viene, arma la suya. */
  sesion?: SesionVista;
}>();

const emit = defineEmits<{ (e: "demo"): void }>();

const sesion = props.sesion ?? useSesion();
const { entrando, error, entrar } = sesion;
</script>

<template>
  <div class="lienzo">
    <div class="box">
      <div class="brand"><span class="dot"></span> Agentic Wallet</div>
      <p class="tagline">Tu copiloto financiero — un ledger por persona, nada compartido.</p>

      <div class="card">
        <div class="mark"><span></span></div>
        <h1>Entrar</h1>
        <p class="sub">
          Con tu cuenta de Google.<br />No hay usuario ni contraseña que recordar.
        </p>

        <button
          class="gbtn"
          type="button"
          :disabled="entrando"
          data-testid="entrar-google"
          @click="entrar()"
        >
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="var(--google-azul)"
              d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z"
            />
            <path
              fill="var(--google-verde)"
              d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.4v5.7C8 41.1 15.4 46 24 46z"
            />
            <path
              fill="var(--google-amarillo)"
              d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.4C2.9 17.2 2 20.5 2 24s.9 6.8 2.4 9.8l7.3-5.7z"
            />
            <path
              fill="var(--google-rojo)"
              d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8 6.9 4.4 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.3-9.1z"
            />
          </svg>
          {{ entrando ? "Abriendo Google…" : "Continuar con Google" }}
        </button>

        <p v-if="error !== null" class="err" data-testid="entrar-error">{{ error }}</p>

        <div class="scopes">
          <b>Qué autoriza esta cuenta</b>
          <div>
            <span class="tick">✓</span
            ><span>Entrar al panel — la sesión es la de Google, no una frase compartida.</span>
          </div>
          <div>
            <span class="tick">✓</span
            ><span>Leer sólo los correos de notificación bancaria, en modo lectura.</span>
          </div>
          <div>
            <span class="tick">✓</span
            ><span>Se puede revocar desde tu cuenta de Google, sin tocar el panel.</span>
          </div>
        </div>

        <div class="note">
          <b>Entrar no da acceso a tu correo.</b> Esto es sólo identidad: nombre y dirección. Leer
          tus notificaciones bancarias es un permiso aparte, que Google te va a pedir en su propia
          pantalla cuando toques <b>Conectar Gmail</b> — y podés entrar y no conectarlo nunca.
        </div>

        <button
          v-if="isDemoMode()"
          class="link"
          type="button"
          data-testid="entrar-demo"
          @click="emit('demo')"
        >
          Ver el modo demostración, sin entrar
        </button>

        <p class="foot en-tarjeta">
          Tus movimientos quedan atados a tu cuenta y no los ve nadie más. Podés desconectar el
          correo cuando quieras.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lienzo {
  margin: 0;
  background: var(--nav);
  color: var(--tinta);
  font: var(--body-size) / 1.5 var(--fuente);
  -webkit-font-smoothing: antialiased;
  min-height: 100%;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.box {
  width: 430px;
  max-width: 100%;
}
.brand {
  /* Blanco pleno sobre el lienzo oscuro, como en la tarjeta. `--panel` es hoy
     el fondo de una tarjeta y dejaba la marca del color del lienzo. */
  color: var(--blanco);
  font-weight: 650;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 6px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--marca-punto);
}
.tagline {
  color: var(--nav-tagline);
  font-size: 13px;
  margin: 0 0 20px;
}
.card {
  background: var(--panel);
  border-radius: var(--radio-tarjeta);
  padding: 26px 22px 22px;
  text-align: center;
}
.mark {
  width: 44px;
  height: 44px;
  /* El cuadro de la marca lleva el radio de tarjeta, no uno propio: en la
     tarjeta nueva es el mismo 4 px que la caja que lo contiene. */
  border-radius: var(--radio-tarjeta);
  background: var(--nav);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}
.mark span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--marca-punto);
}
h1 {
  font-size: 19px;
  margin: 0 0 4px;
  letter-spacing: var(--h1-tracking);
  font-weight: var(--h1-weight);
}
.sub {
  color: var(--apagado);
  font-size: 13px;
  margin: 0 0 22px;
  line-height: 1.55;
}
.gbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  border: 1px solid var(--boton-secundario-borde);
  background: var(--boton-secundario-bg);
  color: var(--tinta);
  border-radius: var(--radio-boton);
  padding: 12px 16px;
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--sombra-control);
}
.gbtn svg {
  width: 19px;
  height: 19px;
  flex: none;
}
.gbtn:disabled {
  background: var(--boton-off-bg);
  border-color: var(--boton-off-bg);
  color: var(--boton-off-texto);
  cursor: default;
  box-shadow: none;
}
.scopes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  background: var(--fondo);
  border: 1px solid var(--linea);
  /* El bloque de permisos es un recuadro de lectura, no una tarjeta: en la
     tarjeta nueva comparte el radio del botón que tiene encima. */
  border-radius: var(--radio-boton);
  padding: 12px 14px;
  margin-top: 18px;
  font-size: var(--small-size);
  color: var(--texto-nota);
}
.scopes b {
  font-size: var(--label-size);
  text-transform: uppercase;
  letter-spacing: var(--label-tracking);
  color: var(--apagado);
  font-weight: var(--label-weight);
}
.scopes div {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.tick {
  color: var(--al-dia);
  font-weight: 700;
  line-height: 1.35;
}
.err {
  border-left: 3px solid var(--falla);
  background: var(--tag-bad-bg);
  color: var(--tag-bad-texto);
  padding: 10px 12px;
  /* El error es la misma franja que `.note` con otro color, así que sigue su
     forma: en el tema oscuro la nota no redondea del lado libre (base.css). */
  border-radius: 0;
  font-size: var(--small-size);
  text-align: left;
  margin: 14px 0 0;
}
.note {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  font-size: var(--small-size);
  margin-top: 16px;
  color: var(--texto-nota);
  text-align: left;
}
.link {
  display: block;
  margin: 14px auto 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--small-size);
  color: var(--accion);
  text-decoration: underline;
  cursor: pointer;
}
.foot {
  color: var(--nav-pie);
  font-size: 11.5px;
  text-align: center;
  margin-top: 14px;
  line-height: 1.55;
}
/* Sobre el lienzo oscuro el pie es `--nav-pie`; dentro de la tarjeta blanca
 * sube a `--apagado`, que es lo que `p0-acceso.html` escribe en linea. */
.foot.en-tarjeta {
  color: var(--apagado);
}
</style>
