/**
 * La sesión vista desde un componente.
 *
 * `auth/sesion.ts` es un módulo pelado a propósito —es política de
 * credenciales, no de framework, igual que `api/base.ts`—. Este composable es
 * la única traducción a refs de Vue, y se suscribe una vez por componente que
 * lo pida.
 */
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { authConfigurado } from "../auth/config";
import {
  cerrarSesion,
  entrarConGoogle,
  estadoSesion,
  observarSesion,
  type Usuario,
} from "../auth/sesion";

export interface SesionVista {
  usuario: Ref<Usuario | null>;
  /** Si ya se sabe si hay sesión. Ver `EstadoSesion.listo`. */
  listo: Ref<boolean>;
  error: Ref<string | null>;
  /** Un login en curso: el botón se deshabilita mientras dura. */
  entrando: Ref<boolean>;
  /** Este build tiene identidad. Sin esto no hay puerta de sesión. */
  configurado: ComputedRef<boolean>;
  entrar: () => Promise<void>;
  salir: () => Promise<void>;
}

export function useSesion(): SesionVista {
  const inicial = estadoSesion();
  const usuario = ref<Usuario | null>(inicial.usuario);
  // Sin identidad en el build no hay nada que esperar: `listo` desde el arranque.
  const listo = ref(inicial.listo || !authConfigurado());
  const error = ref<string | null>(inicial.error);
  const entrando = ref(false);

  const parar = observarSesion((e) => {
    usuario.value = e.usuario;
    listo.value = e.listo || !authConfigurado();
    error.value = e.error;
  });
  onScopeDispose(parar);

  async function entrar(): Promise<void> {
    if (entrando.value) return;
    entrando.value = true;
    try {
      await entrarConGoogle();
    } catch {
      // El motivo ya viajó a `error` por el estado compartido: acá sólo se
      // evita que un login cancelado se vea como una excepción sin manejar.
    } finally {
      entrando.value = false;
    }
  }

  async function salir(): Promise<void> {
    await cerrarSesion();
  }

  return {
    usuario,
    listo,
    error,
    entrando,
    configurado: computed(() => authConfigurado()),
    entrar,
    salir,
  };
}
