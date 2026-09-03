import { describe, expect, it } from "vitest";
import { tagSync, vistaSync, type EntradaSync } from "./sync-estado";

const AHORA = new Date("2026-09-03T12:00:00Z");

function entrada(overrides: Partial<EntradaSync> = {}): EntradaSync {
  return { lastSyncTs: null, backlog: null, running: false, enVuelo: false, falla: null, ...overrides };
}

describe("los cinco estados que usa el MVP", () => {
  it("nunca: no se inventa una fecha", () => {
    const vista = vistaSync(entrada(), AHORA);
    expect(vista.estado).toBe("nunca");
    expect(vista.titulo).toBe("Nunca sincronizaste");
    expect(vista.boton).toBe("Sincronizar por primera vez");
    expect(vista.detalle).toBe("");
  });

  it("al día: dice hace cuánto, no la fecha exacta", () => {
    const vista = vistaSync(entrada({ lastSyncTs: "2026-09-03T11:00:00Z" }), AHORA);
    expect(vista.estado).toBe("al-dia");
    expect(vista.titulo).toContain("hace 1 hora");
    expect(vista.botonClase).toBe("ok");
  });

  it("atrasado: pasado el umbral, el botón cambia de color", () => {
    const vista = vistaSync(entrada({ lastSyncTs: "2026-08-30T12:00:00Z" }), AHORA);
    expect(vista.estado).toBe("atrasado");
    expect(vista.botonClase).toBe("warnb");
  });

  it("corriendo: el botón no hace nada mientras hay un lote en vuelo", () => {
    const vista = vistaSync(entrada({ enVuelo: true }), AHORA);
    expect(vista.estado).toBe("corriendo");
    expect(vista.habilitado).toBe(false);
    expect(vista.botonClase).toBe("dis");
  });

  it("falló: reintentar, con el mensaje del server tal cual", () => {
    const vista = vistaSync(entrada({ falla: { codigo: "otro", mensaje: "gmail search failed" } }), AHORA);
    expect(vista.estado).toBe("fallo");
    expect(vista.boton).toBe("Reintentar");
    expect(vista.detalle).toBe("gmail search failed");
  });
});

describe("'a medias' se dibuja como corriendo, con el pendiente al lado", () => {
  const aMedias = entrada({
    lastSyncTs: "2026-09-03T11:00:00Z",
    backlog: { processed: 1240, total: 3800, remaining: 2560 },
  });

  it("es el estado corriendo, con su barra", () => {
    const vista = vistaSync(aMedias, AHORA);
    expect(vista.estado).toBe("corriendo");
    expect(vista.progreso).not.toBeNull();
    expect(vista.progreso?.porcentaje).toBe(33);
  });

  it("el botón dice Seguir y SÍ hace algo: no hay auto-encadenado", () => {
    const vista = vistaSync(aMedias, AHORA);
    expect(vista.boton).toBe("Seguir");
    expect(vista.habilitado).toBe(true);
  });

  it("dice cuántos quedan y cuántos van", () => {
    const vista = vistaSync(aMedias, AHORA);
    // Cuatro dígitos van sin separador: es la regla del castellano, y la
    // aplica `Intl`, no una decisión de este archivo.
    expect(vista.titulo).toBe("Quedaron 2560 por procesar");
    expect(vista.progreso?.texto).toBe("1240 de 3800");
  });

  it("un backlog a medias gana sobre 'al día': la fecha es reciente y aun así falta", () => {
    expect(vistaSync(aMedias, AHORA).estado).not.toBe("al-dia");
  });
});

describe("R9: running llega del server, no de esta pestaña", () => {
  it("un F5 en medio de un lote rehidrata en 'corriendo', no en un estado limpio falso", () => {
    // enVuelo:false es exactamente lo que pasa después de recargar: esta
    // pestaña no disparó nada.
    const vista = vistaSync(entrada({ running: true, enVuelo: false, lastSyncTs: "2026-09-03T11:00:00Z" }), AHORA);
    expect(vista.estado).toBe("corriendo");
    expect(vista.habilitado).toBe(false);
  });

  it("running gana sobre el backlog: uno es 'está pasando ahora', el otro 'quedó a medias'", () => {
    const vista = vistaSync(
      entrada({ running: true, backlog: { processed: 1240, total: 3800, remaining: 2560 } }),
      AHORA
    );
    expect(vista.boton).toBe("Sincronizando…");
    expect(vista.habilitado).toBe(false);
    // Y aun así muestra el avance: la barra es del backlog.
    expect(vista.progreso?.porcentaje).toBe(33);
  });
});

describe("409 y 503 comparten el cartel de falla, con distinto texto", () => {
  it("el 409 avisa que no se reintenta solo", () => {
    const vista = vistaSync(entrada({ falla: { codigo: 409, mensaje: "sync_already_running" } }), AHORA);
    expect(vista.estado).toBe("fallo");
    expect(vista.titulo).toBe("Ya hay un sync en curso");
    expect(vista.detalle).toContain("No se reintenta solo");
  });

  it("el 503 manda a la credencial que falta", () => {
    const vista = vistaSync(entrada({ falla: { codigo: 503, mensaje: "gmail_not_configured" } }), AHORA);
    expect(vista.estado).toBe("fallo");
    expect(vista.titulo).toBe("Falta conectar Gmail");
  });

  it("no dicen lo mismo", () => {
    const a = vistaSync(entrada({ falla: { codigo: 409, mensaje: "" } }), AHORA);
    const b = vistaSync(entrada({ falla: { codigo: 503, mensaje: "" } }), AHORA);
    expect(a.titulo).not.toBe(b.titulo);
  });
});

describe("tagSync", () => {
  it("usa sólo las etiquetas .tag del sistema", () => {
    expect(tagSync("al-dia")).toEqual({ clase: "ok", texto: "Al día" });
    expect(tagSync("atrasado").clase).toBe("warn");
    expect(tagSync("nunca").clase).toBe("neu");
    expect(tagSync("corriendo").clase).toBe("acc");
    expect(tagSync("fallo").clase).toBe("bad");
  });
});
