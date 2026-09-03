import { describe, expect, it } from "vitest";
import {
  QUE_HACE_CADA_ACCION,
  efectoDeClasificar,
  efectoDeRechazo,
  efectoDeResolver,
  efectoDeSilenciar,
  motivoDelMotor,
} from "./efecto";
import type { ClassifyApplyResponse, ReviewResolveResponse, TransactionRow } from "../api/types";

function clasificado(overrides: Partial<ClassifyApplyResponse> = {}): ClassifyApplyResponse {
  return {
    ok: true,
    pattern: "comercio de ejemplo a",
    counterparty: "Comercio de Ejemplo A",
    category: "salud",
    reclassified: 14,
    reclassified_this_month: 2,
    ...overrides,
  };
}

function fila(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 7,
    gmail_msg_id: "m-7",
    gmail_thread_id: null,
    ts: "2026-09-01T10:00:00Z",
    direction: "out",
    type: "debito",
    amount: 34.5,
    currency: "USD",
    counterparty: "Comercio de Ejemplo A",
    account: null,
    category: null,
    raw_subject: "Notificacion de consumo",
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    source: "parser",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

describe("F13/R19 — la pantalla dice qué cambió, con el número", () => {
  it("la frase del plan, tal cual: 14 movimientos, 2 de ellos de este mes", () => {
    const efecto = efectoDeClasificar(clasificado());
    expect(efecto.titulo).toContain("14 movimientos");
    expect(efecto.titulo).toContain("2 de ellos de este mes");
    expect(efecto.tono).toBe("ok");
  });

  it("movió historial pero nada del mes: se dice que el gráfico no se va a mover", () => {
    const efecto = efectoDeClasificar(clasificado({ reclassified: 14, reclassified_this_month: 0 }));
    expect(efecto.titulo).toContain("ninguno de este mes");
    expect(efecto.detalle).toContain("no vas a ver moverse ninguna barra");
    // Sigue siendo un éxito: reclasificar historial viejo es correcto y útil.
    expect(efecto.tono).toBe("ok");
  });

  it("no movió nada: se dice POR QUÉ, y el tono deja de ser de éxito", () => {
    const efecto = efectoDeClasificar(clasificado({ reclassified: 0, reclassified_this_month: 0 }));
    expect(efecto.tono).toBe("neu");
    expect(efecto.titulo).toContain("no movió ningún movimiento");
    expect(efecto.detalle).toContain("su tipo la decida antes que cualquier regla");
  });

  it("un solo movimiento no se lee como una fracción de sí mismo", () => {
    const efecto = efectoDeClasificar(clasificado({ reclassified: 1, reclassified_this_month: 1 }));
    expect(efecto.titulo).toContain("1 movimiento");
    expect(efecto.titulo).toContain("y es de este mes");
    expect(efecto.titulo).not.toContain("1 de ellos");
  });

  it("silenciar dice cuánta plata sale de la cola y que cuenta como cubierta (M5)", () => {
    const efecto = efectoDeSilenciar("Comercio de Ejemplo A", 6, 312.4);
    expect(efecto.titulo).toContain("No se pregunta más por Comercio de Ejemplo A");
    expect(efecto.detalle).toContain("6 movimientos");
    expect(efecto.detalle).toContain("312,40");
    expect(efecto.detalle).toContain("cuenta como cubierta");
  });
});

describe("R12 — la pantalla dice qué hace cada acción con el total", () => {
  it("descartar NO mueve el saldo, y el texto lo dice", () => {
    expect(QUE_HACE_CADA_ACCION.discard).toContain("descartar no mueve el saldo");
    expect(QUE_HACE_CADA_ACCION.discard).toContain("NO suma");
  });

  it("confirmar y corregir dicen que la fila vuelve a los totales", () => {
    expect(QUE_HACE_CADA_ACCION.confirm).toContain("entra a los totales");
    expect(QUE_HACE_CADA_ACCION.correct).toContain("entra a los totales");
  });

  it("descartar, ya hecho, repite que el saldo no se movió", () => {
    const respuesta: ReviewResolveResponse = {
      ok: true,
      changed: true,
      action: "discard",
      transaction: fila(),
      resolution: {
        id: 1,
        transaction_id: 7,
        gmail_msg_id: "m-7",
        action: "discard",
        previous_amount: 34.5,
        new_amount: null,
        note: null,
        resolved_by: "http",
        resolved_at: "2026-09-03T10:00:00Z",
      },
    };
    const efecto = efectoDeResolver(respuesta);
    expect(efecto.detalle).toContain("NO entra a los totales");
    expect(efecto.detalle).toContain("el saldo no se mueve");
  });
});

describe("R13 — changed:false no es éxito", () => {
  it("se dice que ya estaba resuelto, con tono neutro y no de celebración", () => {
    const efecto = efectoDeResolver({
      ok: true,
      changed: false,
      reason: "already_resolved",
      transaction: fila(),
    });
    expect(efecto.tono).toBe("neu");
    expect(efecto.titulo).toContain("ya lo resolviste en otro lado");
    expect(efecto.detalle).toContain("No se escribió nada nuevo");
  });

  it("confirmar de verdad sí celebra, con el monto", () => {
    const efecto = efectoDeResolver({
      ok: true,
      changed: true,
      action: "confirm",
      transaction: fila({ amount: 34.5 }),
      resolution: {
        id: 1,
        transaction_id: 7,
        gmail_msg_id: "m-7",
        action: "confirm",
        previous_amount: 34.5,
        new_amount: null,
        note: null,
        resolved_by: "http",
        resolved_at: "2026-09-03T10:00:00Z",
      },
    });
    expect(efecto.tono).toBe("ok");
    expect(efecto.titulo).toContain("34,50");
  });
});

describe("el motivo del motor se muestra tal cual, nunca un rojo genérico", () => {
  it("R14: foreign_currency explica por qué Confirmar no es una salida", () => {
    expect(motivoDelMotor("foreign_currency")).toContain("sin convertir");
    expect(motivoDelMotor("foreign_currency")).toContain("descartarlo");
  });

  it("counterparty_not_found explica la trampa del patrón", () => {
    expect(motivoDelMotor("counterparty_not_found")).toContain("no clasificaría una sola fila");
  });

  it("un código desconocido se muestra, no se traduce a 'algo salió mal'", () => {
    expect(motivoDelMotor("codigo_nuevo_del_motor")).toContain("codigo_nuevo_del_motor");
  });

  it("un rechazo tiene tono de rechazo", () => {
    expect(efectoDeRechazo("foreign_currency").tono).toBe("bad");
  });
});
