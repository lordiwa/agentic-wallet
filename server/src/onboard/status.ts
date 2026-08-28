/**
 * "Where am I in the setup?" — the pure half of `npm run onboard`.
 *
 * Onboarding is not a wizard you have to finish in one sitting: every step is
 * independently checkable, so the CLI (and any agent driving it) can be run
 * repeatedly and will always report exactly what is still missing. Nothing
 * here reads stdin, prints, or mutates anything — cli.ts owns all of that,
 * which is what makes these rules testable.
 */
import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { getStrategyConfig } from "../db/strategy-config.js";

export type StepId = "env" | "claude" | "gmail" | "sync" | "profile";

export interface OnboardStep {
  id: StepId;
  /** Short label shown in the checklist. */
  title: string;
  done: boolean;
  /** What the user (or the agent guiding them) must do when `done` is false. */
  action: string;
}

export interface OnboardStatus {
  steps: OnboardStep[];
  /** True when every step is done. */
  complete: boolean;
  /** The first step that is not done, or null when complete. */
  next: OnboardStep | null;
}

export interface OnboardInputs {
  /** Absolute path to the repo-root `.env`. */
  envPath: string;
  /** Usually `process.env`. */
  env: NodeJS.ProcessEnv;
  /** Open, migrated database — or null when it doesn't exist yet. */
  db: Database.Database | null;
}

function hasValue(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim() !== "";
}

/** Number of transactions in the ledger (0 when the db isn't there yet). */
export function ledgerSize(db: Database.Database | null): number {
  if (!db) return 0;
  const row = db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number };
  return row.c;
}

/**
 * The profile step is "done" once the user's own numbers are in
 * `strategy_config` — specifically the two fields nothing else can infer
 * safely: who the account holder is (used to recognise their own transfers as
 * internal) and when they get paid (every "days until payday" figure depends
 * on it). A colchon of 0 is a legitimate choice, so it is deliberately NOT
 * part of this check.
 */
export function profileConfigured(db: Database.Database | null): boolean {
  if (!db) return false;
  const config = getStrategyConfig(db);
  return config.titular.trim() !== "" && config.sueldo.diasPago.length > 0;
}

export function onboardStatus({ envPath, env, db }: OnboardInputs): OnboardStatus {
  const steps: OnboardStep[] = [
    {
      id: "env",
      title: "Archivo .env creado",
      done: existsSync(envPath),
      action: "Copia .env.example a .env en la raiz del repo (el CLI lo hace por ti).",
    },
    {
      id: "claude",
      title: "Credencial de Claude",
      done: hasValue(env, "ANTHROPIC_API_KEY") || hasValue(env, "CLAUDE_CODE_OAUTH_TOKEN"),
      action:
        "Corre `claude setup-token` y pega el token en CLAUDE_CODE_OAUTH_TOKEN " +
        "(suscripcion Pro/Max), o pon una ANTHROPIC_API_KEY de la consola de Anthropic.",
    },
    {
      id: "gmail",
      title: "Gmail conectado (solo lectura)",
      done:
        hasValue(env, "GMAIL_OAUTH_CLIENT_ID") &&
        hasValue(env, "GMAIL_OAUTH_CLIENT_SECRET") &&
        hasValue(env, "GMAIL_OAUTH_REFRESH_TOKEN"),
      action:
        "Crea un cliente OAuth2 tipo 'Desktop app' en Google Cloud, pon client id/secret " +
        "en .env y corre `npm run gmail-auth` para obtener el refresh token. Ver docs/conectar-gmail.md.",
    },
    {
      id: "sync",
      title: "Primer sync (historial en el ledger)",
      done: ledgerSize(db) > 0,
      action: "Levanta el server (`npm run dev`) y pulsa 'Sincronizar', o `curl -X POST localhost:3000/api/sync`.",
    },
    {
      id: "profile",
      title: "Perfil financiero configurado",
      done: profileConfigured(db),
      action: "Corre `npm run onboard` otra vez: propone titular, sueldo, dias de pago y colchon leyendo tu ledger.",
    },
  ];

  const next = steps.find((s) => !s.done) ?? null;
  return { steps, complete: next === null, next };
}
