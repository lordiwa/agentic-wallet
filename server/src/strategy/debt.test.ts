import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertStatement } from "../db/repository.js";
import { proyeccionSinDeuda } from "./debt.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function insertDebt(person: string, amount: number, status = "pending"): void {
  db.prepare("INSERT INTO debts (person, amount, kind, status) VALUES (?, ?, 'personal', ?)").run(person, amount, status);
}

const NOW = new Date("2026-07-20T12:00:00.000Z");

describe("proyeccionSinDeuda (spec §9.7)", () => {
  it("returns meses 0 and fechaEstimada today when there is no debt at all", () => {
    expect(proyeccionSinDeuda(db, 100, NOW)).toEqual({ meses: 0, fechaEstimada: "2026-07-20" });
  });

  it("returns meses null and fechaEstimada null when abonoMensual is not provided but debt exists", () => {
    insertDebt("Persona Uno", 100);

    expect(proyeccionSinDeuda(db, undefined, NOW)).toEqual({ meses: null, fechaEstimada: null });
  });

  it("returns meses null when abonoMensual is 0 or negative", () => {
    insertDebt("Persona Uno", 100);

    expect(proyeccionSinDeuda(db, 0, NOW)).toEqual({ meses: null, fechaEstimada: null });
    expect(proyeccionSinDeuda(db, -50, NOW)).toEqual({ meses: null, fechaEstimada: null });
  });

  it("combines the card's saldoCorte with pending debts, dividing evenly", () => {
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 300, issue_date: "2026-07-01" });
    insertDebt("Persona Uno", 100);
    insertDebt("Luis", 100);
    insertDebt("Anna Paid Off", 999, "paid"); // must NOT count -- only 'pending'

    // deuda total = 300 + 100 + 100 = 500; abono 100/mes -> 5 meses exactly
    const result = proyeccionSinDeuda(db, 100, NOW);

    expect(result.meses).toBe(5);
    expect(result.fechaEstimada).toBe("2026-12-20"); // July 20 + 5 months
  });

  it("rounds a non-even division up to the next whole month (ceil, never guesses a partial month)", () => {
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 300, issue_date: "2026-07-01" });
    insertDebt("Persona Uno", 200); // deuda total 500, abono 150/mes -> ceil(3.33) = 4

    const result = proyeccionSinDeuda(db, 150, NOW);

    expect(result.meses).toBe(4);
    expect(result.fechaEstimada).toBe("2026-11-20");
  });

  it("never crashes on an empty database", () => {
    expect(() => proyeccionSinDeuda(db, 100, NOW)).not.toThrow();
  });
});
