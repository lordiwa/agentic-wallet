import { describe, expect, it } from "vitest";
import type { RecurringProposalRow, RecurringResponse } from "../api/types";
import { tarjetaGastosFijos } from "./gastos-fijos";

function propuesta(n: number): RecurringProposalRow {
  return {
    pattern: `comercio ficticio ${n}`,
    counterparty: `COMERCIO FICTICIO ${n}`,
    monto_estimado: 20,
    dia_tipico: 5,
    sample_size: 4,
    count: 4,
    total: 80,
    last_ts: "2026-08-05T12:00:00Z",
  };
}

function recurring(overrides: Partial<RecurringResponse> = {}): RecurringResponse {
  return {
    propuestas: [propuesta(1), propuesta(2)],
    candidatas: 2,
    en_la_cola: 0,
    meses_de_historial: 6,
    meses_minimos: 3,
    suficiente_historial: true,
    ...overrides,
  };
}

const PERFIL_COMPLETO = { hayDiaDePago: true, colchonFijado: true };

describe("tarjetaGastosFijos", () => {
  it("sin respuesta del motor no se dibuja: lo que no tiene backend no se dibuja", () => {
    expect(tarjetaGastosFijos({ recurring: null, ...PERFIL_COMPLETO }).visible).toBe(false);
  });

  // Un server viejo puede contestar 200 con otra cosa. Antes que decir "llevás
  // undefined meses", no se dibuja.
  it("una respuesta que no tiene la forma del contrato tampoco se dibuja", () => {
    const rota = { propuestas: [] } as unknown as RecurringResponse;

    expect(tarjetaGastosFijos({ recurring: rota, ...PERFIL_COMPLETO }).visible).toBe(false);
  });

  it("con propuestas pendientes invita a leerlas, y dice cuántas", () => {
    const tarjeta = tarjetaGastosFijos({ recurring: recurring(), ...PERFIL_COMPLETO });

    expect(tarjeta.visible).toBe(true);
    expect(tarjeta.titulo).toBe("Todavía no leí tus gastos fijos");
    expect(tarjeta.nota).toContain("2 gastos fijos");
    expect(tarjeta.tag?.clase).toBe("acc");
  });

  it("dice cuántas candidatas quedaron en la cola (H34)", () => {
    const tarjeta = tarjetaGastosFijos({
      recurring: recurring({ candidatas: 37, en_la_cola: 27 }),
      ...PERFIL_COMPLETO,
    });

    expect(tarjeta.nota).toContain("27 más quedan en la cola");
  });

  it("no menciona la cola cuando entraron todas", () => {
    expect(tarjetaGastosFijos({ recurring: recurring(), ...PERFIL_COMPLETO }).nota).not.toContain("cola");
  });

  // R33: la pantalla dice cuánto lleva acumulado, y la tarjeta también — para
  // no obligar a entrar a averiguar por qué no hay nada.
  it("con historial corto anuncia el freno y cuánto lleva acumulado", () => {
    const tarjeta = tarjetaGastosFijos({
      recurring: recurring({ propuestas: [], suficiente_historial: false, meses_de_historial: 1.4 }),
      ...PERFIL_COMPLETO,
    });

    expect(tarjeta.visible).toBe(true);
    expect(tarjeta.nota).toContain("1,4 meses");
    expect(tarjeta.nota).toContain("3 meses");
    expect(tarjeta.tag?.clase).toBe("warn");
  });

  it("un mes redondo no se escribe con decimales", () => {
    const tarjeta = tarjetaGastosFijos({
      recurring: recurring({ propuestas: [], suficiente_historial: false, meses_de_historial: 1 }),
      ...PERFIL_COMPLETO,
    });

    expect(tarjeta.nota).toContain("1 mes de historial");
  });

  it("con el trabajo hecho la tarjeta se va: no hay nada que ofrecer", () => {
    const tarjeta = tarjetaGastosFijos({
      recurring: recurring({ propuestas: [], candidatas: 0 }),
      ...PERFIL_COMPLETO,
    });

    expect(tarjeta.visible).toBe(false);
  });

  it("sin propuestas pero con el perfil a medias sigue ofreciendo los dos campos", () => {
    const tarjeta = tarjetaGastosFijos({
      recurring: recurring({ propuestas: [], candidatas: 0 }),
      hayDiaDePago: false,
      colchonFijado: true,
    });

    expect(tarjeta.visible).toBe(true);
    expect(tarjeta.nota).toContain("día de pago");
    expect(tarjeta.nota).toContain("safe-to-spend");
  });

  it("nombra los dos campos cuando faltan los dos", () => {
    const tarjeta = tarjetaGastosFijos({
      recurring: recurring({ propuestas: [], candidatas: 0 }),
      hayDiaDePago: false,
      colchonFijado: false,
    });

    expect(tarjeta.nota).toContain("día de pago");
    expect(tarjeta.nota).toContain("colchón objetivo");
  });

  it("con el colchón sin fijar (R25) lo dice, aunque el día de pago esté", () => {
    const tarjeta = tarjetaGastosFijos({
      recurring: recurring({ propuestas: [], candidatas: 0 }),
      hayDiaDePago: true,
      colchonFijado: false,
    });

    expect(tarjeta.visible).toBe(true);
    expect(tarjeta.nota).toContain("colchón objetivo");
  });
});
