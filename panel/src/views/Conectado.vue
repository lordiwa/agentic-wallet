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
  <section class="pantalla" data-testid="vista-conectado">
    <h2 class="tit">Tu correo</h2>
    <p class="bajada">
      Bolsillo lee sólo los avisos de tu banco para armar tu historial. No manda correos ni los borra.
    </p>

    <ConectarGmail :gmail="gmail" />

    <p class="volver">
      <a :href="toHash('resumen')" data-testid="conectado-volver">Volver al resumen</a>
    </p>
  </section>
</template>

<style scoped>
.pantalla {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
}
.tit {
  margin: 0;
  font-size: var(--h1-size);
  font-weight: var(--h1-weight);
  letter-spacing: var(--h1-tracking);
  color: var(--tinta);
}
.bajada {
  margin: 0;
  font-size: var(--small-size);
  color: var(--apagado);
}
.volver {
  margin: 0;
  font-size: var(--small-size);
}
.volver a {
  color: var(--accion);
}
</style>
