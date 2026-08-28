import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { onboardStatus, type OnboardStatus, type StepId } from "./status.js";

function status(env: NodeJS.ProcessEnv = {}): OnboardStatus {
  const db = new Database(":memory:");
  migrate(db);
  // envPath apunta a un archivo que no existe: el paso "env" queda pendiente,
  // que es irrelevante para lo que se prueba aca.
  return onboardStatus({ envPath: "/no/existe/.env", env, db });
}

function step(env: NodeJS.ProcessEnv, id: StepId) {
  const found = status(env).steps.find((s) => s.id === id);
  if (!found) throw new Error(`no hay paso '${id}' en el checklist`);
  return found;
}

describe("onboardStatus: huso horario", () => {
  it("lista el huso como un paso propio del checklist", () => {
    expect(status().steps.map((s) => s.id)).toEqual(["env", "claude", "gmail", "sync", "huso", "profile"]);
  });

  // El default -5 decide que cae en "hoy" y en "este mes" en TODOS los totales.
  // Aplicarlo sin decirlo le da a alguien en Madrid o Buenos Aires cifras
  // diarias corridas sin ningun aviso.
  it("queda pendiente cuando WALLET_UTC_OFFSET_HOURS no esta seteada", () => {
    const huso = step({}, "huso");
    expect(huso.done).toBe(false);
    expect(huso.action).toContain("WALLET_UTC_OFFSET_HOURS");
    expect(huso.action).toContain("-5");
  });

  it("se da por hecho cuando el usuario la puso explicitamente", () => {
    expect(step({ WALLET_UTC_OFFSET_HOURS: "-3" }, "huso").done).toBe(true);
  });

  it("una variable vacia no cuenta como elegida", () => {
    expect(step({ WALLET_UTC_OFFSET_HOURS: "  " }, "huso").done).toBe(false);
  });

  it("el onboarding no se declara completo mientras el huso siga implicito", () => {
    expect(status().complete).toBe(false);
  });
});
