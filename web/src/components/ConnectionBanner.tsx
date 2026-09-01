import { useEffect, useState } from "react";
import { DEMO_BASE, getApiBase, setApiBase } from "../api/base";
import { pingBackend } from "../api/client";
import { useRefresh } from "../lib/refresh";

/**
 * Cartel de "de donde salen estos numeros".
 *
 * Es la pieza que hace publicable este dashboard. El sitio estatico no trae
 * datos adentro: o esta en modo demostracion (numeros inventados, y lo dice a
 * los gritos) o esta apuntando a un backend que configuro quien mira, en su
 * propio navegador. Un dashboard financiero que no distingue esos dos estados
 * de un vistazo es peligroso — de ahi que el aviso sea fijo y no un toast que
 * se va.
 *
 * Cambiar de backend recarga la pagina a proposito: cada seccion cachea lo
 * que ya pidio en su propio `useState`, y volver a montar todo es la unica
 * forma de garantizar que no quede en pantalla un numero del backend viejo.
 */
export function ConnectionBanner() {
  const { tick } = useRefresh();
  const base = getApiBase();
  const isDemo = base === DEMO_BASE;
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    pingBackend().then((ok) => {
      if (!cancelled) setReachable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo, tick]);

  function apply(value: string | null) {
    setApiBase(value);
    window.location.reload();
  }

  return (
    <section aria-label="Origen de los datos" className={isDemo ? "banner banner-demo" : "banner"}>
      {isDemo ? (
        <p role="status">
          <strong>MODO DEMOSTRACION.</strong> Todo lo que ves en esta pantalla es inventado: no es tu dinero ni
          tus movimientos. Sirve para ver la interfaz, no para decidir nada.
        </p>
      ) : (
        <p role="status">
          Datos de: <code>{base === "" ? "este mismo servidor" : base}</code>
          {reachable === null && " - probando conexion..."}
          {reachable === false && " - SIN CONEXION con el backend."}
          {reachable === true && " - conectado."}
        </p>
      )}

      <details>
        <summary>Cambiar el origen de los datos</summary>
        <p>
          Pega la URL publica de tu server (por ejemplo <code>https://mi-maquina.mi-tailnet.ts.net</code>), o
          usa <code>{DEMO_BASE}</code> para volver a la demostracion. Se guarda solo en este navegador.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft.trim() === "" ? null : draft.trim());
          }}
        >
          <label htmlFor="api-base">
            URL del backend
            <input
              id="api-base"
              type="text"
              value={draft}
              placeholder={base || "https://..."}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button type="submit">Conectar</button>
          <button type="button" onClick={() => apply(DEMO_BASE)}>
            Ver demostracion
          </button>
        </form>
      </details>
    </section>
  );
}
