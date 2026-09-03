/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { effectScope } from "vue";
import { RUTA_INICIAL, parseHash, toHash, useRuta } from "./ruta";

afterEach(() => {
  window.location.hash = "";
});

describe("parseHash", () => {
  it("sin hash, el hogar", () => {
    expect(parseHash("")).toEqual(RUTA_INICIAL);
    expect(parseHash("#")).toEqual(RUTA_INICIAL);
    expect(parseHash("#/")).toEqual(RUTA_INICIAL);
  });

  it("una pantalla que no existe no es un error: es el hogar", () => {
    // Las pantallas que el MVP no construye (estrategia, ahorro, chat, reglas)
    // no tienen enlace, pero alguien puede escribir la URL a mano.
    expect(parseHash("#/estrategia")).toEqual(RUTA_INICIAL);
    expect(parseHash("#/../etc")).toEqual(RUTA_INICIAL);
  });

  it("lee las tres pantallas del MVP", () => {
    expect(parseHash("#/resumen").pantalla).toBe("resumen");
    expect(parseHash("#/preguntas").pantalla).toBe("preguntas");
    expect(parseHash("#/movimientos").pantalla).toBe("movimientos");
  });

  it("el contexto del destino viaja en la query", () => {
    expect(parseHash("#/movimientos?categoria=comida").params).toEqual({ categoria: "comida" });
    expect(parseHash("#/preguntas?pestana=monto&ids=1,2,3").params).toEqual({
      pestana: "monto",
      ids: "1,2,3",
    });
  });
});

describe("toHash", () => {
  it("sin params no deja un '?' colgando", () => {
    expect(toHash("resumen")).toBe("#/resumen");
  });

  it("ida y vuelta: lo que se escribe es lo que se lee", () => {
    const params = { categoria: "transferencia_persona", ids: "7,9" };
    expect(parseHash(toHash("movimientos", params)).params).toEqual(params);
  });
});

describe("useRuta", () => {
  it("arranca leyendo el hash que ya está en la barra", () => {
    window.location.hash = "#/movimientos?categoria=salud";
    const scope = effectScope();
    const nav = scope.run(() => useRuta())!;
    expect(nav.ruta.value.pantalla).toBe("movimientos");
    expect(nav.ruta.value.params.categoria).toBe("salud");
    scope.stop();
  });

  it("ir() cambia el hash, y el hash cambia la ruta", async () => {
    const scope = effectScope();
    const nav = scope.run(() => useRuta())!;

    nav.ir("preguntas", { pestana: "monto" });
    expect(window.location.hash).toBe("#/preguntas?pestana=monto");

    // jsdom despacha `hashchange` en el próximo turno.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(nav.ruta.value.pantalla).toBe("preguntas");
    scope.stop();
  });

  it("ir dos veces al mismo destino no queda mudo", () => {
    window.location.hash = "#/resumen";
    const scope = effectScope();
    const nav = scope.run(() => useRuta())!;

    nav.ir("resumen");
    expect(nav.ruta.value.pantalla).toBe("resumen");
    scope.stop();
  });
});
