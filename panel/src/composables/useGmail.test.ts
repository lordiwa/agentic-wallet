/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { setProveedorIdToken } from "../api/gmail";
import { useGmail, type Gmail, type OpcionesGmail } from "./useGmail";

const BASE = "https://us-central1-proyecto-de-prueba.cloudfunctions.net";

/** Ver la nota de `api/gmail.test.ts`: Vite sustituye las `VITE_*` al
 * transformar, así que la unica via es `vi.stubEnv`. */
function conBase(valor: string | undefined): void {
  if (valor === undefined) vi.unstubAllEnvs();
  else vi.stubEnv("VITE_FUNCTIONS_BASE_URL", valor);
}

function respuesta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CONECTADO = { conectado: true, email: "a@b.test", scopes: [], grantedAt: null, necesitaReconectar: false };
const DESCONECTADO = { conectado: false, email: null, scopes: [], grantedAt: null, necesitaReconectar: false };

/**
 * `useGmail` usa `onMounted`, asi que necesita un componente vivo. Este montaje
 * devuelve el ciclo y el wrapper para desmontarlo.
 */
function montar(opciones: OpcionesGmail): { gmail: Gmail; desmontar: () => void } {
  let capturado: Gmail | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        capturado = useGmail(opciones);
        return () => h("div");
      },
    })
  );
  return { gmail: capturado as unknown as Gmail, desmontar: () => wrapper.unmount() };
}

beforeEach(() => {
  window.localStorage.clear();
  conBase(BASE);
  setProveedorIdToken(async () => "id-token-de-prueba");
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  conBase(undefined);
  setProveedorIdToken(async () => null);
});

describe("useGmail — consulta al montar", () => {
  it("consulta el estado y lo refleja en la vista", async () => {
    const fetchImpl = vi.fn(async () => respuesta(DESCONECTADO));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "" });

    await nextTick();
    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("desconectado"));

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(gmail.vista.value.boton).toBe("Conectar Gmail");
    desmontar();
  });

  it("sin sesion no consulta y muestra el estado propio", async () => {
    setProveedorIdToken(async () => null);
    const fetchImpl = vi.fn();
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "" });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("sin-sesion"));
    expect(fetchImpl).not.toHaveBeenCalled();
    desmontar();
  });

  it("auto:false no consulta al montar", async () => {
    const fetchImpl = vi.fn(async () => respuesta(DESCONECTADO));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "", auto: false });

    await nextTick();
    expect(fetchImpl).not.toHaveBeenCalled();
    // Nadie consulto todavia, asi que `haySesion` sigue en su valor inicial.
    expect(gmail.vista.value.estado).toBe("sin-sesion");
    desmontar();
  });

  it("un fallo del status deja la vista en error con reintentar", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ error: "x" }, 500));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "" });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("error"));
    expect(gmail.vista.value.boton).toBe("Reintentar");
    desmontar();
  });

  it("un fallo posterior no borra un conectado ya conocido", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respuesta(CONECTADO))
      .mockResolvedValueOnce(respuesta({ error: "x" }, 500));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "" });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("conectado"));
    await gmail.refrescar();

    expect(gmail.vista.value.estado).toBe("conectado");
    desmontar();
  });
});

describe("useGmail — la vuelta de Google", () => {
  it("lee ?gmail=ok y lo muestra como aviso", async () => {
    const fetchImpl = vi.fn(async () => respuesta(CONECTADO));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "?gmail=ok" });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("conectado"));
    expect(gmail.vista.value.aviso?.tono).toBe("ok");
    desmontar();
  });

  it("vuelve a consultar el estado en vez de creerle al ?gmail=ok", async () => {
    // El parametro lo puede escribir cualquiera a mano; quien decide es Firestore.
    const fetchImpl = vi.fn(async () => respuesta(DESCONECTADO));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "?gmail=ok" });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("desconectado"));
    expect(gmail.vista.value.aviso?.tono).toBe("ok");
    desmontar();
  });

  it("limpia ?gmail= de la barra pero conserva el hash de la ruta", async () => {
    window.history.replaceState({}, "", "/?gmail=ok#/conectado");
    const fetchImpl = vi.fn(async () => respuesta(CONECTADO));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "?gmail=ok" });

    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/conectado");
    // El aviso ya estaba en memoria: limpiar la URL no lo apaga.
    expect(gmail.vista.value.aviso?.tono).toBe("ok");
    desmontar();
  });

  it("un ?gmail= desconocido no genera aviso", async () => {
    const fetchImpl = vi.fn(async () => respuesta(DESCONECTADO));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "?gmail=inventado" });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("desconectado"));
    expect(gmail.vista.value.aviso).toBeNull();
    desmontar();
  });
});

describe("useGmail — conectar", () => {
  it("pide la authUrl y navega hacia ella", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respuesta(DESCONECTADO))
      .mockResolvedValueOnce(respuesta({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "s", scopes: [] }));
    const navegar = vi.fn();
    const { gmail, desmontar } = montar({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      search: "",
      navegar,
      returnTo: "/#/conectado",
    });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("desconectado"));
    await gmail.conectar();

    expect(navegar).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ returnTo: "/#/conectado" });
    desmontar();
  });

  it("si el start falla no navega y lo dice", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respuesta(DESCONECTADO))
      .mockResolvedValueOnce(respuesta({ error: "x" }, 500));
    const navegar = vi.fn();
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "", navegar });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("desconectado"));
    await gmail.conectar();

    expect(navegar).not.toHaveBeenCalled();
    // Sigue desconectado y el boton vuelve a estar disponible: un fallo no deja
    // la tarjeta trabada.
    expect(gmail.vista.value.estado).toBe("desconectado");
    expect(gmail.vista.value.habilitado).toBe(true);
    desmontar();
  });

  it("conectar deja el boton usable de nuevo (volver con 'atras' no lo traba)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respuesta(DESCONECTADO))
      .mockResolvedValueOnce(respuesta({ authUrl: "https://accounts.google.com/x", state: "s", scopes: [] }));
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "", navegar: vi.fn() });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("desconectado"));
    await gmail.conectar();

    expect(gmail.vista.value.habilitado).toBe(true);
    desmontar();
  });

  it("conectar borra el aviso viejo: lo que sigue es el viaje nuevo", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respuesta(DESCONECTADO))
      .mockResolvedValueOnce(respuesta({ authUrl: "https://accounts.google.com/x", state: "s", scopes: [] }));
    const { gmail, desmontar } = montar({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      search: "?gmail=cancelado",
      navegar: vi.fn(),
    });

    // Hay que esperar a que la consulta inicial termine: `conectar` durante una
    // carga en vuelo es un no-op, y el test estaria probando eso sin querer.
    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("desconectado"));
    expect(gmail.vista.value.aviso?.tono).toBe("warn");
    await gmail.conectar();

    expect(gmail.vista.value.aviso).toBeNull();
    desmontar();
  });

  it("accionar reintenta cuando esta en error, en vez de arrancar un consentimiento", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respuesta({ error: "x" }, 500))
      .mockResolvedValueOnce(respuesta(CONECTADO));
    const navegar = vi.fn();
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "", navegar });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("error"));
    await gmail.accionar();

    expect(navegar).not.toHaveBeenCalled();
    expect(gmail.vista.value.estado).toBe("conectado");
    desmontar();
  });

  it("accionar conecta cuando hay que reconectar", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respuesta({ ...CONECTADO, necesitaReconectar: true }))
      .mockResolvedValueOnce(respuesta({ authUrl: "https://accounts.google.com/x", state: "s", scopes: [] }));
    const navegar = vi.fn();
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "", navegar });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("reconectar"));
    await gmail.accionar();

    expect(navegar).toHaveBeenCalledWith("https://accounts.google.com/x");
    desmontar();
  });
});

describe("useGmail — modo demo", () => {
  it("el panel en demo muestra conectado sin salir a la red", async () => {
    window.localStorage.setItem("wallet.api_base", "demo");
    setProveedorIdToken(async () => null);
    const fetchImpl = vi.fn();
    const { gmail, desmontar } = montar({ fetchImpl: fetchImpl as unknown as typeof fetch, search: "" });

    await vi.waitFor(() => expect(gmail.vista.value.estado).toBe("conectado"));
    expect(fetchImpl).not.toHaveBeenCalled();
    desmontar();
  });
});
