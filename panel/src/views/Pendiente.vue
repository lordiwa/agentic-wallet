<script setup lang="ts">
/**
 * Una pantalla del MVP que todavía no se construyó.
 *
 * Existe por una diferencia que importa: *Preguntas* y *Movimientos* **son**
 * del MVP (N3 y N5), así que su enlace se dibuja y su ruta responde. Lo que no
 * está es la pantalla, y decirlo es más honesto que un enlace que no lleva a
 * ningún lado o una pantalla en blanco.
 *
 * Esto no contradice "lo que no tiene backend no se dibuja": lo que no se
 * dibuja es un enlace a algo que el MVP **no va a construir** (Estrategia,
 * Ahorro, Chat, Reglas, Configuración). Acá lo que falta es la pantalla, no la
 * decisión.
 *
 * Cuando N3 y N5 lleguen, este componente desaparece con ellas.
 */
defineProps<{ titulo: string; fase: string; que: string }>();
</script>

<template>
  <div>
    <h1 class="h1">{{ titulo }}</h1>
    <p class="sub">{{ que }}</p>
    <div class="card pendiente" data-testid="pantalla-pendiente">
      <span class="tag neu">Todavía no</span>
      <p class="small">
        Esta pantalla llega en la fase {{ fase }}. El motor que la responde ya existe; lo que falta es dibujarla.
      </p>
      <a class="btn qui" href="#/resumen">Volver al Resumen</a>
    </div>
  </div>
</template>

<style scoped>
.pendiente {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.pendiente p {
  margin: 0;
  flex: 1;
  min-width: 220px;
}
</style>
