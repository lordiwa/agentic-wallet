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
 * Sin logo de Google a propósito: sus colores son hex de marca, y en este panel
 * no hay un solo hex fuera de `tokens.css` (§2.5, y su test lo verifica).
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
          class="btn pri"
          type="button"
          :disabled="entrando"
          data-testid="entrar-google"
          @click="entrar()"
        >
          {{ entrando ? "Abriendo Google…" : "Entrar con Google" }}
        </button>

        <p v-if="error !== null" class="err" data-testid="entrar-error">{{ error }}</p>

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

        <p class="foot">
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
  color: var(--panel);
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
  border-radius: 12px;
  padding: 26px 22px 22px;
  text-align: center;
}
.mark {
  width: 44px;
  height: 44px;
  border-radius: 11px;
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
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  border: 1px solid var(--boton-secundario-borde);
  background: var(--boton-secundario-bg);
  color: var(--tinta);
  border-radius: 9px;
  padding: 12px 16px;
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--sombra-control);
}
.btn.pri {
  background: var(--boton-primario-bg);
  border-color: var(--boton-primario-bg);
  color: var(--boton-primario-texto);
}
.btn:disabled {
  background: var(--boton-off-bg);
  border-color: var(--boton-off-bg);
  color: var(--boton-off-texto);
  cursor: default;
  box-shadow: none;
}
.err {
  border-left: 3px solid var(--falla);
  background: var(--tag-bad-bg);
  color: var(--tag-bad-texto);
  padding: 10px 12px;
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
  font-size: var(--small-size);
  text-align: left;
  margin: 14px 0 0;
}
.note {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
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
  color: var(--apagado);
  font-size: 11.5px;
  text-align: center;
  margin-top: 14px;
  line-height: 1.55;
}
</style>
