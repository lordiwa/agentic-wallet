<script setup lang="ts">
/**
 * `P0-b — Acceso por llave`. Hereda el lienzo y la tipografia de
 * `p0-acceso.html` del design system **sin el boton de Google**: la decision
 * M3 saca Firebase del MVP, asi que la unica identidad es
 * `WALLET_ACCESS_TOKEN`.
 *
 * La llave se guarda en este navegador y solo sale hacia un backend de la
 * lista blanca (ver api/origins.ts). La pantalla no la muestra de vuelta ni
 * la manda a ningun lado para "validarla": la prueba es
 * `GET /api/health`, que responde sin llave y dice si la presentada sirve.
 */
import { computed, ref } from "vue";
import { getAccessToken, getApiBase, setAccessToken } from "../api/base";
import { etiquetaBackend, explicarEstado, probeHealth } from "../api/client";
import type { DiagnosticoConexion } from "../api/client";

const emit = defineEmits<{ (e: "acceso", diagnostico: DiagnosticoConexion): void }>();

const llave = ref("");
const probando = ref(false);
const error = ref<string | null>(null);

const servidor = computed(() => etiquetaBackend(getApiBase()));
const puedeEnviar = computed(() => llave.value.trim() !== "" && !probando.value);

async function entrar(): Promise<void> {
  if (!puedeEnviar.value) return;
  probando.value = true;
  error.value = null;
  const anterior = getAccessToken();
  setAccessToken(llave.value);
  try {
    const diagnostico = await probeHealth();
    if (diagnostico.estado === "conectado") {
      llave.value = "";
      emit("acceso", diagnostico);
      return;
    }
    // Una llave que no abre no se queda guardada: dejarla puesta hace que la
    // proxima pantalla mienta con un "sin llave" que no es el problema.
    setAccessToken(anterior);
    error.value = explicarEstado(diagnostico);
  } finally {
    probando.value = false;
  }
}
</script>

<template>
  <div class="lienzo">
    <div class="box">
      <div class="brand"><span class="dot"></span> Agentic Wallet</div>
      <p class="tagline">Consola de manejo — un solo usuario, sin registro público.</p>

      <form class="card" @submit.prevent="entrar">
        <div class="mark"><span></span></div>
        <h1>Entrar</h1>
        <p class="sub">
          El acceso es la llave del server.<br />No hay usuario ni contraseña que recordar.
        </p>

        <div class="field">
          <label for="llave">Llave del server</label>
          <input
            id="llave"
            v-model="llave"
            class="inp"
            type="password"
            autocomplete="current-password"
            spellcheck="false"
            placeholder="WALLET_ACCESS_TOKEN"
            data-testid="acceso-llave"
          />
          <p class="hint">
            Se guarda en este navegador y sólo viaja hacia
            <code data-testid="acceso-servidor">{{ servidor }}</code
            >, que está en la lista de servidores autorizados.
          </p>
        </div>

        <button class="btn pri" type="submit" :disabled="!puedeEnviar" data-testid="acceso-entrar">
          {{ probando ? "Probando…" : "Entrar" }}
        </button>

        <p v-if="error !== null" class="err" data-testid="acceso-error">{{ error }}</p>

        <div class="note">
          <b>Una sola acción, a propósito.</b> El límite real lo pone el server, no esta pantalla: la
          llave es <code>WALLET_ACCESS_TOKEN</code> del <code>.env</code>, y el server sólo escucha en
          <code>127.0.0.1</code> — al tailnet llega por <code>tailscale serve</code>, sin abrir ningún
          puerto público.
        </div>

        <p class="foot">Nada de lo que ocurre acá sale de este navegador salvo la llave, y sólo hacia ese server.</p>
      </form>
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
  /* El lienzo llena lo que le deje la barra del chip, que va arriba y no se
     esconde ni siquiera en esta pantalla (ver App.vue). */
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
.field {
  text-align: left;
  margin-bottom: 14px;
}
label {
  display: block;
  font-size: var(--label-size);
  text-transform: uppercase;
  letter-spacing: var(--label-tracking);
  color: var(--apagado);
  font-weight: var(--label-weight);
  margin: 0 0 5px;
}
.inp {
  width: 100%;
  border: 1px solid var(--linea);
  border-radius: var(--radio-boton);
  padding: 10px 11px;
  font: inherit;
  font-size: 14px;
  background: var(--panel);
  color: var(--tinta);
}
.hint {
  font-size: 12px;
  color: var(--apagado);
  margin: 5px 0 0;
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
.foot {
  color: var(--apagado);
  font-size: 11.5px;
  text-align: center;
  margin-top: 14px;
  line-height: 1.55;
}
code {
  font-family: var(--fuente-mono);
  font-size: 12px;
  background: var(--superficie-suave);
  border-radius: 4px;
  padding: 1px 5px;
}
</style>
