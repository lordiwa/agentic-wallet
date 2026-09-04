<script setup lang="ts">
/**
 * "Esto todavía no lo leo de tu cuenta" — dicho como un estado del sistema, no
 * como una falla.
 *
 * Existe por un caso real del panel publicado: con sesión de Google, las rutas
 * que las Cloud Functions todavía no exponen contestan `501 no_portado`, y las
 * pantallas lo dibujaban con el mismo cartel rojo que un backend caído. Las dos
 * cosas se ven igual de rotas y no lo son: una se arregla esperando (o
 * reintentando) y la otra no se arregla de ninguna manera desde acá.
 *
 * La forma sale del sistema y de ningún lado más: la tarjeta de
 * `c3-tarjeta-overview.html` con su etiqueta en la esquina, y el bloque `.note`
 * de `p4-movimientos.html` para la explicación. Nada de rojo: no hay error.
 */
defineProps<{
  /** Qué es lo que no se puede mostrar todavía: "Tus movimientos", "La cola". */
  titulo: string;
  /** Qué se puede hacer mientras tanto, en una línea. */
  nota?: string;
}>();
</script>

<template>
  <section class="card pendiente" data-testid="pendiente">
    <span class="corner"><span class="tag neu">todavía no</span></span>
    <h3 class="label">Sin conexión a esta parte de tu ledger</h3>
    <p class="h2 titulo">{{ titulo }}</p>
    <p class="note">
      <b>No es un error, y no se arregla reintentando.</b>
      Tu cuenta está bien y el servicio responde: lo que falta es que esta pantalla lea esta parte de
      tu historial. Hasta entonces no se dibuja un cero ni un dato de ejemplo —
      <span class="tabular">0</span> y "no lo sé" no significan lo mismo.
    </p>
    <p v-if="nota" class="small nota">{{ nota }}</p>
    <slot />
  </section>
</template>

<style scoped>
.pendiente {
  padding-right: 120px;
  margin-bottom: 12px;
}
.corner {
  position: absolute;
  top: 12px;
  right: 14px;
}
.titulo {
  margin: 0 0 10px;
}
.nota {
  margin: 10px 0 0;
  display: block;
}
</style>
