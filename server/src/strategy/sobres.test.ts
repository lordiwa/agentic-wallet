import { describe, expect, it } from "vitest";
import {
  armarSobres,
  ID_COLCHON,
  MAX_NOMBRE,
  MAX_SOBRES,
  NOMBRE_COLCHON,
  idDeSobre,
  nombreChoca,
  normalizarNombre,
  planAjustarSobre,
  planCrearSobre,
  totalEnSobresCents,
  type SobreCents,
  type SobreDoc,
} from "./sobres.js";

function sobre(parcial: Partial<SobreCents> & { id: string }): SobreCents {
  return {
    nombre: parcial.id,
    montoCents: 0,
    objetivoCents: null,
    sistema: false,
    creadoEn: null,
    actualizadoEn: null,
    ...parcial,
  };
}

describe("idDeSobre", () => {
  it("es legible: sin tildes, sin mayúsculas, con guiones", () => {
    expect(idDeSobre("FlexiAhorro")).toBe("flexiahorro");
    expect(idDeSobre("Viaje a Perú")).toBe("viaje-a-peru");
    expect(idDeSobre("  Cuenta   corriente  ")).toBe("cuenta-corriente");
  });

  it("un nombre sin letras ni números no tiene id", () => {
    expect(idDeSobre("···")).toBe("");
    expect(idDeSobre("   ")).toBe("");
  });

  it("no deja un id que Firestore rechace como segmento de path", () => {
    expect(idDeSobre("../etc")).toBe("etc");
    expect(idDeSobre("a/b")).toBe("a-b");
    expect(idDeSobre("__proto__")).toBe("proto");
  });
});

describe("armarSobres", () => {
  it("el colchón está aunque su documento no exista", () => {
    const sobres = armarSobres([], 0);
    expect(sobres).toHaveLength(1);
    expect(sobres[0]).toMatchObject({
      id: ID_COLCHON,
      nombre: NOMBRE_COLCHON,
      montoCents: 0,
      objetivoCents: null,
      sistema: true,
    });
  });

  it("el objetivo del colchón sale de la config, no del documento", () => {
    // Un `targetCents` en el documento del colchón NO manda: el motor lee
    // `colchonObjetivo` de la config, y mostrar otro número sería un objetivo
    // que el safe-to-spend ignora.
    const docs: SobreDoc[] = [{ id: ID_COLCHON, reservedCents: 14_000, targetCents: 999_999 }];
    expect(armarSobres(docs, 50_000)[0]).toMatchObject({
      montoCents: 14_000,
      objetivoCents: 50_000,
    });
  });

  it("R25: un objetivo en cero es SIN FIJAR, no uno cumplido", () => {
    expect(armarSobres([{ id: ID_COLCHON, reservedCents: 0 }], 0)[0]!.objetivoCents).toBeNull();
    expect(armarSobres([{ id: "viaje", label: "Viaje", targetCents: 0 }], 0)[1]!.objetivoCents).toBeNull();
  });

  it("el colchón primero, el resto por monto y el nombre desempata", () => {
    const docs: SobreDoc[] = [
      { id: "viaje", label: "Viaje", reservedCents: 5_000 },
      { id: "flexiahorro", label: "FlexiAhorro", reservedCents: 110_573 },
      { id: "regalos", label: "Regalos", reservedCents: 5_000 },
      { id: ID_COLCHON, reservedCents: 14_000 },
    ];
    expect(armarSobres(docs, 0).map((s) => s.id)).toEqual([
      ID_COLCHON,
      "flexiahorro",
      "regalos",
      "viaje",
    ]);
  });

  it("el nombre del colchón es el del motor, no su label guardado", () => {
    // El documento guarda `label:"colchon"`, que es un token interno.
    const sobres = armarSobres([{ id: ID_COLCHON, label: "colchon", reservedCents: 0 }], 0);
    expect(sobres[0]!.nombre).toBe(NOMBRE_COLCHON);
  });

  it("un documento sin label cae al id, no a una cadena vacía", () => {
    expect(armarSobres([{ id: "viaje" }], 0)[1]!.nombre).toBe("viaje");
  });
});

describe("totalEnSobresCents", () => {
  it("suma en centavos enteros", () => {
    const sobres = armarSobres(
      [
        { id: ID_COLCHON, reservedCents: 14_000 },
        { id: "flexiahorro", label: "FlexiAhorro", reservedCents: 110_573 },
      ],
      0
    );
    expect(totalEnSobresCents(sobres)).toBe(124_573);
  });
});

describe("planCrearSobre", () => {
  const colchon = armarSobres([], 0);

  it("crea con el id derivado del nombre y monto cero por defecto", () => {
    const resultado = planCrearSobre({ nombre: "  Viaje a  Perú " }, colchon);
    expect(resultado).toEqual({
      ok: true,
      plan: { id: "viaje-a-peru", nombre: "Viaje a Perú", montoCents: 0, objetivoCents: null },
    });
  });

  it("no se puede crear un segundo colchón, ni llamándolo Emergencia", () => {
    expect(planCrearSobre({ nombre: "Emergencia" }, colchon)).toEqual({
      ok: false,
      error: "sobre_reservado",
    });
    expect(planCrearSobre({ nombre: "colchon" }, colchon)).toEqual({
      ok: false,
      error: "sobre_reservado",
    });
  });

  it("dos sobres que sólo difieren en tildes o mayúsculas son el mismo", () => {
    const existentes = [...colchon, sobre({ id: "viaje-a-peru", nombre: "Viaje a Perú" })];
    expect(planCrearSobre({ nombre: "viaje a peru" }, existentes)).toEqual({
      ok: false,
      error: "sobre_duplicado",
    });
  });

  it("rechaza el nombre vacío, el larguísimo y el que no tiene letras", () => {
    expect(planCrearSobre({ nombre: "   " }, colchon)).toEqual({ ok: false, error: "nombre_vacio" });
    expect(planCrearSobre({ nombre: "x".repeat(MAX_NOMBRE + 1) }, colchon)).toEqual({
      ok: false,
      error: "nombre_largo",
    });
    expect(planCrearSobre({ nombre: "···" }, colchon)).toEqual({
      ok: false,
      error: "nombre_sin_letras",
    });
  });

  it("el colchón no consume cupo, pero los demás sí", () => {
    const llenos = [
      ...colchon,
      ...Array.from({ length: MAX_SOBRES }, (_, i) => sobre({ id: `s${i}`, nombre: `Sobre ${i}` })),
    ];
    expect(planCrearSobre({ nombre: "Uno más" }, llenos)).toEqual({
      ok: false,
      error: "demasiados_sobres",
    });
    const casiLlenos = llenos.slice(0, MAX_SOBRES);
    expect(planCrearSobre({ nombre: "Uno más" }, casiLlenos).ok).toBe(true);
  });

  it("un objetivo en cero se guarda como sin fijar", () => {
    const resultado = planCrearSobre({ nombre: "Viaje", objetivoCents: 0 }, colchon);
    expect(resultado.ok && resultado.plan.objetivoCents).toBeNull();
  });

  it("un monto negativo no es un sobre", () => {
    expect(planCrearSobre({ nombre: "Viaje", montoCents: -1 }, colchon)).toEqual({
      ok: false,
      error: "monto_negativo",
    });
  });
});

describe("planAjustarSobre", () => {
  const viaje = sobre({ id: "viaje", nombre: "Viaje", montoCents: 5_000 });
  const colchon = armarSobres([{ id: ID_COLCHON, reservedCents: 14_000 }], 50_000)[0]!;

  it("un aporte suma sobre lo que había", () => {
    expect(planAjustarSobre(viaje, { aporteCents: 2_500 })).toEqual({
      ok: true,
      plan: { id: "viaje", sistema: false, montoCents: 7_500 },
    });
  });

  it("un retiro resta, y no puede dejar el sobre en negativo", () => {
    expect(planAjustarSobre(viaje, { aporteCents: -5_000 })).toEqual({
      ok: true,
      plan: { id: "viaje", sistema: false, montoCents: 0 },
    });
    expect(planAjustarSobre(viaje, { aporteCents: -5_001 })).toEqual({
      ok: false,
      error: "monto_negativo",
    });
  });

  it("monto y aporte a la vez es una contradicción, no una preferencia", () => {
    expect(planAjustarSobre(viaje, { montoCents: 100, aporteCents: 100 })).toEqual({
      ok: false,
      error: "monto_y_aporte",
    });
  });

  it("un patch sin campos no es un cambio silencioso: es un rechazo", () => {
    expect(planAjustarSobre(viaje, {})).toEqual({ ok: false, error: "sin_cambios" });
  });

  it("el colchón se ajusta pero no se renombra", () => {
    expect(planAjustarSobre(colchon, { aporteCents: 1_000 })).toEqual({
      ok: true,
      plan: { id: ID_COLCHON, sistema: true, montoCents: 15_000 },
    });
    expect(planAjustarSobre(colchon, { nombre: "Vacaciones" })).toEqual({
      ok: false,
      error: "sobre_del_sistema",
    });
  });

  it("borrar el objetivo es mandar null, y cero es lo mismo", () => {
    expect(planAjustarSobre(viaje, { objetivoCents: null })).toEqual({
      ok: true,
      plan: { id: "viaje", sistema: false, objetivoCents: null },
    });
    expect(planAjustarSobre(viaje, { objetivoCents: 0 })).toEqual({
      ok: true,
      plan: { id: "viaje", sistema: false, objetivoCents: null },
    });
  });

  it("un nombre nuevo se normaliza igual que al crear", () => {
    expect(planAjustarSobre(viaje, { nombre: "  Viaje   largo " })).toEqual({
      ok: true,
      plan: { id: "viaje", sistema: false, nombre: "Viaje largo" },
    });
  });
});

describe("nombreChoca", () => {
  const existentes = [
    sobre({ id: "viaje", nombre: "Viaje a Perú" }),
    sobre({ id: "regalos", nombre: "Regalos" }),
  ];

  it("choca con otro sobre, pero no consigo mismo", () => {
    expect(nombreChoca("regalos", "viaje", existentes)).toBe(true);
    expect(nombreChoca("Viaje a peru", "viaje", existentes)).toBe(false);
    expect(nombreChoca("Nuevo", "viaje", existentes)).toBe(false);
  });
});

describe("normalizarNombre", () => {
  it("colapsa lo que no distingue dos sobres", () => {
    expect(normalizarNombre("  FlexiAhorro  ")).toBe("flexiahorro");
    expect(normalizarNombre("Viaje  a   Perú")).toBe("viaje a peru");
  });
});
