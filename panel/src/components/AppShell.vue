<script setup lang="ts">
/**
 * El *shell*: la barra lateral y la columna de contenido. Réplica del bloque
 * que se repite idéntico en las once `p*.html` del design system —
 * `grid-template-columns: 236px 1fr`, barra con el color `--nav`, enlaces de
 * 13.5px en `--nav-enlace-texto`, activo con fondo `--nav-activo-bg` y texto
 * blanco 600, separadores de 1px, contenido con `padding: 20px 26px 40px`.
 * Los valores exactos están en `styles/tokens.css`, que es el único archivo
 * del panel donde se escribe un color.
 *
 * **La navegación se recorta a tres.** El sistema dibuja nueve enlaces
 * (Sincronización, Reglas, Estrategia, Ahorro, Chat, Configuración entre
 * ellos); acá hay Resumen, Preguntas y Movimientos, y no es una omisión
 * temporal: lo que no tiene backend, o no entra al MVP, no se dibuja. Un enlace
 * a una pantalla que no existe es una promesa que la interfaz no puede cumplir.
 *
 * Sincronización tampoco está, y por otra razón: existe, pero no como pantalla.
 * El ciclo entero vive adentro del chip del Resumen.
 *
 * En pantalla chica la barra deja de ser una columna y pasa a ser una fila
 * arriba (D6): las tres superficies quedan usables en un teléfono aunque sólo
 * el Resumen tenga diseño chico propio.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { isDemoMode, onBackendChange } from "../api/base";
import { toHash, type Pantalla } from "../router/ruta";

const props = defineProps<{ pantalla: Pantalla }>();

/** Las tres del MVP, en el orden en que se usan. */
const ENLACES: { pantalla: Pantalla; texto: string }[] = [
  { pantalla: "resumen", texto: "Resumen" },
  { pantalla: "preguntas", texto: "Preguntas" },
  { pantalla: "movimientos", texto: "Movimientos" },
];

const enlaces = computed(() =>
  ENLACES.map((enlace) => ({ ...enlace, href: toHash(enlace.pantalla), activo: enlace.pantalla === props.pantalla }))
);

/**
 * De donde salen los datos, dicho en voz alta y **en vivo**.
 *
 * Era un `const`, o sea una foto del momento en que se monto la barra lateral.
 * El backend se puede cambiar sin recargar (el chip acepta la propuesta de
 * `?api=`), asi que un enlace `?api=demo` dejaba el panel sirviendo datos
 * inventados sin un solo cartel — y el caso inverso dejaba el cartel de
 * demostracion sobre el ledger real (wargaming ronda 3, W25).
 */
const demo = ref(isDemoMode());
let dejarDeEscuchar: (() => void) | null = null;
onMounted(() => {
  dejarDeEscuchar = onBackendChange(() => {
    demo.value = isDemoMode();
  });
});
onUnmounted(() => dejarDeEscuchar?.());
</script>

<template>
  <div class="app">
    <nav class="side">
      <div class="brand"><span class="dot"></span> Agentic Wallet</div>
      <div class="nav" data-testid="nav">
        <a
          v-for="enlace in enlaces"
          :key="enlace.pantalla"
          :class="{ on: enlace.activo }"
          :href="enlace.href"
          :aria-current="enlace.activo ? 'page' : undefined"
          >{{ enlace.texto }}</a
        >
      </div>
      <div v-if="demo" class="side-foot" data-testid="nav-demo">Modo demostración<br />Datos inventados</div>
    </nav>

    <main class="main">
      <slot name="chip" />
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: var(--shell-columnas);
  min-height: 100vh;
}
.side {
  background: var(--nav);
  color: var(--nav-texto-claro);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
}
.brand {
  /* Blanco pleno, como en la tarjeta: la marca queda un escalón por encima de
     `--tinta` sobre la barra oscura. (Antes pedía `--panel`, que con el tema
     oscuro pasó a ser el fondo de una tarjeta y dejaba la marca del color del
     lienzo, o sea invisible.) */
  color: var(--blanco);
  font-weight: 650;
  font-size: 15px;
  padding: 0 10px 18px;
  display: flex;
  align-items: center;
  gap: 9px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--marca-punto);
  flex: none;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nav a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  /* El radio de control, no el de tarjeta: el enlace activo es un bloque de la
     barra, y con la esquina cerrada del tema nuevo se lee como una fila
     seleccionada de consola y no como una píldora. */
  border-radius: var(--radio-control);
  color: var(--nav-enlace-texto);
  text-decoration: none;
  font-size: var(--nav-enlace-size);
  cursor: pointer;
}
.nav a:hover,
.nav a.on {
  background: var(--nav-activo-bg);
  color: var(--blanco);
}
.nav a.on {
  font-weight: 600;
}
.side-foot {
  margin-top: auto;
  font-size: 11.5px;
  color: var(--nav-pie);
  padding: 12px 10px 0;
  border-top: 1px solid var(--nav-separador);
}
.main {
  padding: var(--shell-padding);
  min-width: 0;
}

/*
 * D6. En un teléfono una columna de 236px se come dos tercios del ancho, así
 * que la barra pasa arriba y los enlaces se ponen en fila. No es un diseño
 * chico propio —eso lo tiene el Resumen— es lo mínimo para que las tres
 * superficies se puedan usar.
 */
@media (max-width: 720px) {
  .app {
    grid-template-columns: 1fr;
  }
  .side {
    padding: 12px 14px;
  }
  .brand {
    padding: 0 4px 10px;
  }
  .nav {
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
  }
  .nav a {
    padding: 7px 12px;
    white-space: nowrap;
  }
  .side-foot {
    margin-top: 10px;
  }
  .main {
    padding: 14px 14px 32px;
  }
}
</style>
