/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend por defecto del build. Vacío en el bundle publicado. */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Orígenes que pueden recibir la llave, coma-separados (ver
   * api/origins.ts). Vacío por defecto: nada precargado que sea de una
   * persona o de un despliegue concreto.
   */
  readonly VITE_WALLET_TRUSTED_API_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
