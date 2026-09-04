import { describe, expect, it } from "vitest";
import {
  formatearFecha,
  leerResultado,
  vistaGmail,
  type EntradaGmail,
  type EstadoGmail,
} from "./gmail-estado";

const CONECTADO: EstadoGmail = {
  conectado: true,
  email: "persona@ejemplo.test",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  grantedAt: "2026-02-10T15:00:00.000Z",
  necesitaReconectar: false,
};

const DESCONECTADO: EstadoGmail = {
  conectado: false,
  email: null,
  scopes: [],
  grantedAt: null,
  necesitaReconectar: false,
};

function entrada(parcial: Partial<EntradaGmail> = {}): EntradaGmail {
  return {
    estado: null,
    cargando: false,
    error: null,
    resultado: null,
    haySesion: true,
    configurado: true,
    ...parcial,
  };
}

describe("leerResultado", () => {
  it("lee un resultado conocido de la query", () => {
    expect(leerResultado("?gmail=ok")).toBe("ok");
    expect(leerResultado("?otra=1&gmail=scope_insuficiente")).toBe("scope_insuficiente");
  });

  it("devuelve null cuando no viene el parametro", () => {
    expect(leerResultado("")).toBeNull();
    expect(leerResultado("?api=demo")).toBeNull();
  });

  it("descarta un valor que no esta en la lista", () => {
    // El valor llega por la URL y elige un texto en pantalla: sin la lista,
    // cualquiera escribe el mensaje que el panel muestra.
    expect(leerResultado("?gmail=<script>")).toBeNull();
    expect(leerResultado("?gmail=conectadisimo")).toBeNull();
  });
});

describe("formatearFecha", () => {
  it("devuelve vacio para null y para una fecha rota", () => {
    expect(formatearFecha(null)).toBe("");
    expect(formatearFecha("no es una fecha")).toBe("");
  });

  it("formatea una fecha ISO", () => {
    expect(formatearFecha("2026-02-10T15:00:00.000Z")).toContain("2026");
  });
});

describe("vistaGmail", () => {
  it("sin configurar: no ofrece boton aunque haya sesion", () => {
    const vista = vistaGmail(entrada({ configurado: false }));
    expect(vista.estado).toBe("sin-configurar");
    expect(vista.boton).toBeNull();
    expect(vista.habilitado).toBe(false);
  });

  it("la falta de configuracion gana sobre la falta de sesion", () => {
    expect(vistaGmail(entrada({ configurado: false, haySesion: false })).estado).toBe("sin-configurar");
  });

  it("sin sesion: no se puede conectar un buzon a nadie", () => {
    const vista = vistaGmail(entrada({ haySesion: false }));
    expect(vista.estado).toBe("sin-sesion");
    expect(vista.boton).toBeNull();
  });

  it("cargando y sin estado todavia: no es lo mismo que desconectado", () => {
    const vista = vistaGmail(entrada({ cargando: true }));
    expect(vista.estado).toBe("cargando");
    expect(vista.boton).toBeNull();
  });

  it("desconectado: ofrece conectar", () => {
    const vista = vistaGmail(entrada({ estado: DESCONECTADO }));
    expect(vista.estado).toBe("desconectado");
    expect(vista.boton).toBe("Conectar Gmail");
    expect(vista.botonClase).toBe("pri");
    expect(vista.habilitado).toBe(true);
  });

  it("conectado: muestra el correo y ofrece reconectar como accion secundaria", () => {
    const vista = vistaGmail(entrada({ estado: CONECTADO }));
    expect(vista.estado).toBe("conectado");
    expect(vista.detalle).toContain("persona@ejemplo.test");
    expect(vista.boton).toBe("Reconectar");
    expect(vista.botonClase).toBe("sec");
  });

  it("conectado sin fecha: el detalle no queda con un separador colgando", () => {
    const vista = vistaGmail(entrada({ estado: { ...CONECTADO, grantedAt: null } }));
    expect(vista.detalle).toBe("persona@ejemplo.test");
  });

  it("conectado sin correo ni fecha: detalle vacio, no 'null'", () => {
    const vista = vistaGmail(entrada({ estado: { ...CONECTADO, email: null, grantedAt: null } }));
    expect(vista.detalle).toBe("");
  });

  it("necesitaReconectar: es un estado propio, no 'conectado'", () => {
    const vista = vistaGmail(entrada({ estado: { ...CONECTADO, necesitaReconectar: true } }));
    expect(vista.estado).toBe("reconectar");
    expect(vista.boton).toBe("Reconectar");
    // Reparar algo que dejo de andar es la accion principal de esa pantalla.
    expect(vista.botonClase).toBe("pri");
  });

  it("sin estado y con error: ofrece reintentar", () => {
    const vista = vistaGmail(entrada({ error: "gmailAuthStatus respondio 500" }));
    expect(vista.estado).toBe("error");
    expect(vista.boton).toBe("Reintentar");
    expect(vista.detalle).toBe("gmailAuthStatus respondio 500");
  });

  it("un error de red NO pisa un conectado que ya se habia leido", () => {
    const vista = vistaGmail(entrada({ estado: CONECTADO, error: "se cayo la red" }));
    expect(vista.estado).toBe("conectado");
  });

  it("mientras carga, el boton queda deshabilitado pero el estado se mantiene", () => {
    const vista = vistaGmail(entrada({ estado: DESCONECTADO, cargando: true }));
    expect(vista.estado).toBe("desconectado");
    expect(vista.habilitado).toBe(false);
  });

  it("el aviso de la vuelta acompania a cualquier estado", () => {
    const vista = vistaGmail(entrada({ estado: CONECTADO, resultado: "ok" }));
    expect(vista.aviso).toEqual({ texto: "Listo, Gmail quedó conectado.", tono: "ok" });
  });

  it("cancelar no es una falla: es una respuesta", () => {
    const vista = vistaGmail(entrada({ estado: DESCONECTADO, resultado: "cancelado" }));
    expect(vista.aviso?.tono).toBe("warn");
    expect(vista.estado).toBe("desconectado");
  });

  it("scope_insuficiente avisa en tono de falla", () => {
    expect(vistaGmail(entrada({ estado: DESCONECTADO, resultado: "scope_insuficiente" })).aviso?.tono).toBe("bad");
  });

  it("cada resultado del callback tiene su propio texto", () => {
    const textos = new Set(
      (["ok", "cancelado", "state_invalido", "sin_refresh_token", "scope_insuficiente", "google_rechazo", "error"] as const).map(
        (resultado) => vistaGmail(entrada({ resultado, estado: DESCONECTADO })).aviso?.texto
      )
    );
    expect(textos.size).toBe(7);
  });
});
