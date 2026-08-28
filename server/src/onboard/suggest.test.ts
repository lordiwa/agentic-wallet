import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { parseDiasPago } from "../strategy/calendar.js";
import { buildSuggestions, suggestSalary, suggestSpendBaseline, suggestTitular } from "./suggest.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

let seq = 0;
function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  seq += 1;
  return {
    gmail_msg_id: `tx-${seq}`,
    ts: "2026-07-10T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    ...overrides,
  };
}

function salary(ts: string, amount: number, counterparty = "EMPRESA EJEMPLO SA"): NewTransaction {
  return tx({ ts, amount, counterparty, direction: "in", type: "sueldo" });
}

describe("suggestTitular", () => {
  it("returns the most frequent account-holder spelling in the ledger", () => {
    insertTransaction(db, tx({ account: "PEREZ GOMEZ ANA MARIA" }));
    insertTransaction(db, tx({ account: "PEREZ GOMEZ ANA MARIA" }));
    insertTransaction(db, tx({ account: "OTRO NOMBRE" }));

    expect(suggestTitular(db)).toBe("PEREZ GOMEZ ANA MARIA");
  });

  it("returns null on an empty ledger rather than inventing a name", () => {
    expect(suggestTitular(db)).toBeNull();
  });

  it("ignores blank account values", () => {
    insertTransaction(db, tx({ account: "   " }));
    expect(suggestTitular(db)).toBeNull();
  });
});

describe("suggestSalary", () => {
  it("reads source, median amount and recurring paydays off real deposits", () => {
    insertTransaction(db, salary("2026-05-15T12:00:00Z", 1000));
    insertTransaction(db, salary("2026-05-30T12:00:00Z", 1000));
    insertTransaction(db, salary("2026-06-15T12:00:00Z", 1200));
    insertTransaction(db, salary("2026-06-30T12:00:00Z", 1000));

    const result = suggestSalary(db);

    expect(result).not.toBeNull();
    expect(result?.fuente).toBe("EMPRESA EJEMPLO SA");
    expect(result?.diasPago).toEqual(["15-15", "30-30"]);
    expect(result?.cadencia).toBe("quincenal");
    expect(result?.sampleSize).toBe(4);
  });

  it("uses the median, so a one-off bonus does not inflate the estimate", () => {
    insertTransaction(db, salary("2026-05-15T12:00:00Z", 1000));
    insertTransaction(db, salary("2026-06-15T12:00:00Z", 1000));
    insertTransaction(db, salary("2026-07-15T12:00:00Z", 9000)); // bonus

    // mean would be ~3667; median stays at the real salary
    expect(suggestSalary(db)?.montoEstimado).toBe(1000);
  });

  it("calls a single recurring payday 'mensual'", () => {
    insertTransaction(db, salary("2026-05-30T12:00:00Z", 800));
    insertTransaction(db, salary("2026-06-30T12:00:00Z", 800));

    const result = suggestSalary(db);
    expect(result?.diasPago).toEqual(["30-30"]);
    expect(result?.cadencia).toBe("mensual");
  });

  it("drops non-recurring days when recurring ones exist", () => {
    insertTransaction(db, salary("2026-05-15T12:00:00Z", 500));
    insertTransaction(db, salary("2026-06-15T12:00:00Z", 500));
    insertTransaction(db, salary("2026-06-03T12:00:00Z", 500)); // one-off

    expect(suggestSalary(db)?.diasPago).toEqual(["15-15"]);
  });

  // El calendario lee ventanas, no dias sueltos: un "15" pelado no parsea y
  // deja next_payday en null sin avisar. La sugerencia tiene que salir en el
  // mismo formato que el motor consume, porque el usuario la acepta tal cual.
  it("emits paydays as windows the calendar can actually parse", () => {
    insertTransaction(db, salary("2026-05-15T12:00:00Z", 1000));
    insertTransaction(db, salary("2026-05-30T12:00:00Z", 1000));
    insertTransaction(db, salary("2026-06-15T12:00:00Z", 1000));
    insertTransaction(db, salary("2026-06-30T12:00:00Z", 1000));

    const diasPago = suggestSalary(db)!.diasPago;

    expect(diasPago).toEqual(["15-15", "30-30"]);
    expect(parseDiasPago(diasPago)).toEqual([
      { minDay: 15, maxDay: 15 },
      { minDay: 30, maxDay: 30 },
    ]);
  });

  it("returns null with no salary rows instead of guessing a payday", () => {
    insertTransaction(db, tx({ amount: 50 }));
    expect(suggestSalary(db)).toBeNull();
  });

  it("ignores reversed deposits", () => {
    insertTransaction(db, salary("2026-05-15T12:00:00Z", 1000));
    insertTransaction(db, { ...salary("2026-06-15T12:00:00Z", 5000), is_reversed: true });

    expect(suggestSalary(db)?.montoEstimado).toBe(1000);
  });
});

describe("suggestSpendBaseline", () => {
  it("averages outgoing spend over the months the ledger actually covers", () => {
    // 2 months of history, 600 total -> 300/month (approx, 30.44-day months)
    insertTransaction(db, tx({ ts: "2026-05-01T12:00:00Z", amount: 300 }));
    insertTransaction(db, tx({ ts: "2026-07-01T12:00:00Z", amount: 300 }));

    const result = suggestSpendBaseline(db);
    expect(result.gastoMensualPromedio).toBeGreaterThan(280);
    expect(result.gastoMensualPromedio).toBeLessThan(320);
    expect(result.mesesDeHistorial).toBeGreaterThan(1.9);
  });

  it("returns a null average for less than a month of history", () => {
    insertTransaction(db, tx({ ts: "2026-07-01T12:00:00Z", amount: 100 }));
    insertTransaction(db, tx({ ts: "2026-07-10T12:00:00Z", amount: 100 }));

    expect(suggestSpendBaseline(db).gastoMensualPromedio).toBeNull();
  });

  it("returns zeros on an empty ledger", () => {
    expect(suggestSpendBaseline(db)).toEqual({ gastoMensualPromedio: null, mesesDeHistorial: 0 });
  });

  it("excludes internal, reversed and needs_review rows from the baseline", () => {
    insertTransaction(db, tx({ ts: "2026-05-01T12:00:00Z", amount: 300 }));
    insertTransaction(db, tx({ ts: "2026-07-01T12:00:00Z", amount: 300 }));
    insertTransaction(db, tx({ ts: "2026-06-01T12:00:00Z", amount: 9999, is_internal: true }));
    insertTransaction(db, tx({ ts: "2026-06-02T12:00:00Z", amount: 9999, is_reversed: true }));
    insertTransaction(db, tx({ ts: "2026-06-03T12:00:00Z", amount: 9999, needs_review: true }));

    expect(suggestSpendBaseline(db).gastoMensualPromedio).toBeLessThan(320);
  });
});

describe("buildSuggestions", () => {
  it("returns an all-null/empty proposal for a fresh ledger, never fabricated values", () => {
    expect(buildSuggestions(db)).toEqual({
      titular: null,
      salary: null,
      uncategorized: [],
      gastoMensualPromedio: null,
      mesesDeHistorial: 0,
    });
  });

  it("surfaces the merchants still landing in 'otros', biggest spend first", () => {
    insertTransaction(db, tx({ counterparty: "TIENDA CHICA", amount: 5, category: "otros" }));
    insertTransaction(db, tx({ counterparty: "TIENDA GRANDE", amount: 500, category: "otros" }));

    const result = buildSuggestions(db);
    expect(result.uncategorized.map((u) => u.counterparty)).toEqual(["TIENDA GRANDE", "TIENDA CHICA"]);
  });
});
