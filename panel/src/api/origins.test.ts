import { describe, expect, it } from "vitest";
import {
  DEMO_BASE,
  classifyBackend,
  isLoopbackOrigin,
  mayReceiveCredential,
  normalizeBase,
  originOf,
  parseTrustedOrigins,
} from "./origins";

describe("normalizeBase", () => {
  it("recorta espacios y la barra final del copiar/pegar", () => {
    expect(normalizeBase("  https://a.example/  ")).toBe("https://a.example");
    expect(normalizeBase("https://a.example///")).toBe("https://a.example");
    expect(normalizeBase(null)).toBe("");
  });
});

describe("originOf", () => {
  it("saca el origen de una URL absoluta", () => {
    expect(originOf("https://a.example/algo")).toBe("https://a.example");
    expect(originOf("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("una base relativa no tiene origen propio", () => {
    expect(originOf("")).toBeNull();
    expect(originOf("/api")).toBeNull();
    expect(originOf(DEMO_BASE)).toBeNull();
  });

  it("descarta lo que no es http(s): un javascript: no es un backend", () => {
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("data:text/html,x")).toBeNull();
    expect(originOf("file:///etc/passwd")).toBeNull();
  });
});

describe("isLoopbackOrigin", () => {
  it("reconoce el 127.0.0.0/8 entero, localhost y ::1", () => {
    expect(isLoopbackOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackOrigin("http://127.9.9.9")).toBe(true);
    expect(isLoopbackOrigin("http://localhost:5174")).toBe(true);
    // `*.localhost` salió de acá en la ronda 3 (W13b, más abajo).
    expect(isLoopbackOrigin("http://panel.localhost")).toBe(false);
    expect(isLoopbackOrigin("http://[::1]:3000")).toBe(true);
  });

  it("no se deja engañar por un host que sólo parece loopback", () => {
    expect(isLoopbackOrigin("https://127.0.0.1.host-ajeno.example")).toBe(false);
    expect(isLoopbackOrigin("https://localhost.host-ajeno.example")).toBe(false);
    expect(isLoopbackOrigin("https://notlocalhost")).toBe(false);
  });
});

describe("parseTrustedOrigins", () => {
  it("parte por coma, normaliza, y deja sólo el origen", () => {
    expect(parseTrustedOrigins("https://a.example/, http://localhost:5174/x")).toEqual([
      "https://a.example",
      "http://localhost:5174",
    ]);
  });

  it("no hay lista blanca implícita: el comodín y la basura se descartan", () => {
    expect(parseTrustedOrigins("*")).toEqual([]);
    expect(parseTrustedOrigins("*,https://a.example")).toEqual(["https://a.example"]);
    expect(parseTrustedOrigins(undefined)).toEqual([]);
    expect(parseTrustedOrigins("")).toEqual([]);
  });

  it("no repite un origen que vino dos veces", () => {
    expect(parseTrustedOrigins("https://a.example,https://a.example/otra")).toEqual(["https://a.example"]);
  });
});

describe("classifyBackend", () => {
  const policy = { configured: ["https://panel.example"], trusted: ["https://confirmado.example"] };

  it("el mismo origen y el modo demo tienen su propia categoría", () => {
    expect(classifyBackend("", policy)).toBe("same-origin");
    expect(classifyBackend(DEMO_BASE, policy)).toBe("demo");
  });

  it("el loopback entra sin configurar nada: es la máquina de quien mira", () => {
    expect(classifyBackend("http://127.0.0.1:3000", policy)).toBe("loopback");
  });

  it("distingue el origen del build del que confirmó el usuario", () => {
    expect(classifyBackend("https://panel.example", policy)).toBe("configured");
    expect(classifyBackend("https://confirmado.example", policy)).toBe("trusted");
  });

  it("cualquier otro es ajeno, y una base ilegible también", () => {
    expect(classifyBackend("https://host-ajeno.example", policy)).toBe("foreign");
    expect(classifyBackend("javascript:alert(1)", policy)).toBe("foreign");
    expect(classifyBackend("no-es-una-url", policy)).toBe("foreign");
  });

  it("sin política, sólo pasan el mismo origen y el loopback", () => {
    expect(classifyBackend("https://panel.example")).toBe("foreign");
    expect(classifyBackend("http://localhost:3000")).toBe("loopback");
  });
});

describe("mayReceiveCredential", () => {
  it("la llave sale sólo hacia la lista blanca", () => {
    expect(mayReceiveCredential("same-origin")).toBe(true);
    expect(mayReceiveCredential("loopback")).toBe(true);
    expect(mayReceiveCredential("configured")).toBe(true);
    expect(mayReceiveCredential("trusted")).toBe(true);
  });

  it("un backend ajeno se llama sin credencial, y el modo demo no llama a nadie", () => {
    expect(mayReceiveCredential("foreign")).toBe(false);
    expect(mayReceiveCredential("demo")).toBe(false);
  });
});

/**
 * Wargaming ronda 3 (W13b). La ronda 2 aceptó `*.localhost` como loopback
 * apoyándose en RFC 6761 y en que "Chrome y Firefox lo resuelven a loopback".
 * Las dos mitades de esa justificación se caen al mirarlas:
 *
 * - RFC 6761 §6.3 dice **SHOULD**, no MUST, y el intento de subirlo a requisito
 *   (`draft-ietf-dnsop-let-localhost-be-localhost`) expiró sin llegar a RFC.
 * - WebKit lo declara **no garantizado**: *"the system DNS resolver on Apple
 *   platforms does not necessarily guarantee that localhost maps to loopback"*
 *   (bug 171934, todavía abierto).
 * - W3C Secure Contexts condiciona la confianza a que el navegador cumpla ese
 *   draft, y advierte que los resolvers "a menudo ignoran estas sugerencias".
 *
 * O sea: se nombraron los dos navegadores que sí lo garantizan y se omitió el
 * que dice que no. Con un sufijo de búsqueda DNS, `ajeno.localhost` puede
 * resolver a una IP pública — y ese origen recibía la llave sin que el usuario
 * autorizara nada, porque `loopback` entra solo.
 *
 * Nadie hospeda su billetera en `panel.localhost`, así que la rama se va. El
 * host exacto `localhost` y `127.0.0.0/8` siguen entrando solos; cualquier otra
 * cosa se autoriza a mano, como cualquier backend.
 */
describe("isLoopbackOrigin — sólo la máquina de quien mira (W13b)", () => {
  it("un subdominio de .localhost ya no entra solo", () => {
    expect(classifyBackend("http://ajeno.localhost")).toBe("foreign");
    expect(classifyBackend("http://atacante.com.localhost")).toBe("foreign");
    expect(classifyBackend("http://.localhost")).toBe("foreign");
  });

  it("la máquina de quien mira sigue entrando sola", () => {
    expect(classifyBackend("http://localhost")).toBe("loopback");
    expect(classifyBackend("http://localhost:8787")).toBe("loopback");
    expect(classifyBackend("http://127.0.0.1")).toBe("loopback");
    expect(classifyBackend("http://127.1")).toBe("loopback");
    expect(classifyBackend("http://[::1]")).toBe("loopback");
  });
});
