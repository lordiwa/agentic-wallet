<script setup lang="ts">
/**
 * `#/conectado` — donde aterriza el navegador cuando vuelve de Google.
 *
 * Es una pantalla y no un cartel porque la vuelta puede traer siete resultados
 * distintos (`ResultadoCallback`) y cinco de ellos son "no quedó conectado, por
 * esto". Mostrar eso encima del Resumen dejaría el mensaje compitiendo con los
 * números; acá tiene la pantalla para él y un camino claro de vuelta.
 *
 * El estado se vuelve a consultar al montar en vez de creerle al `?gmail=ok`:
 * lo que decide si el buzón está conectado es Firestore, no un parámetro de una
 * URL que cualquiera puede escribir a mano.
 */
import ConectarGmail from "../components/ConectarGmail.vue";
import { useGmail } from "../composables/useGmail";
import { toHash } from "../router/ruta";

// `returnTo` apunta acá: si desde esta pantalla se reintenta, la vuelta también
// cae acá y no en el Resumen.
const gmail = useGmail({ returnTo: `/${toHash("conectado")}` });
</script>

<template>
  <div class="pantalla" data-testid="vista-conectado">
    <!-- La cabecera del sistema, la misma de `p2` y `p4`: `.top` con `h1` y
         `.sub`. Era un `h2` suelto con una bajada propia, o sea la única
         pantalla del panel que no empezaba como las otras. -->
    <div class="top">
      <div>
        <h1 class="h1">Tu correo</h1>
        <p class="sub">La vuelta de Google. Acá se dice si quedó conectado — y si no, por qué.</p>
      </div>
    </div>

    <ConectarGmail :gmail="gmail" />

    <!-- Qué permiso es, en el bloque `.note` del sistema. No es decoración: es
         lo único de esta pantalla que responde "¿qué le acabo de dar a esto?",
         y va después de la tarjeta porque primero se lee el resultado. -->
    <p class="note alcance">
      <b>Es un permiso de sólo lectura.</b>
      Agentic Wallet lee los avisos de tu banco para armar tu historial: no manda correos, no los
      borra y no toca el resto de tu bandeja. Lo revocás cuando quieras desde tu cuenta de Google.
    </p>

    <p class="volver">
      <a class="btn" :href="toHash('resumen')" data-testid="conectado-volver">Volver al resumen</a>
    </p>
  </div>
</template>

<style scoped>
.pantalla {
  max-width: 620px;
}
.top {
  margin-bottom: 14px;
}
.alcance {
  margin-top: 12px;
}
.volver {
  margin: 14px 0 0;
}
</style>
