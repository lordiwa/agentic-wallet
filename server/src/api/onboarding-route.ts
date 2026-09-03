/**
 * `/api/onboarding/*` — las dos puertas de la fase N4: el perfil mínimo (H2) y
 * la lectura de gastos fijos (H30).
 *
 * Cero lógica financiera acá, igual que en el resto de la capa HTTP: qué es un
 * día de pago válido, qué significa un objetivo en cero y cuál es la mediana de
 * un gasto fijo lo deciden `onboard/profile.ts` y `onboard/recurring.ts`, que
 * tienen sus tests. Esta ruta valida la forma del request, llama, y traduce el
 * error tipado del motor a un status.
 *
 * Los tres errores del perfil son 400 y no 500 ni 404: son afirmaciones del
 * cliente que el motor rechaza —un día que el calendario no sabría leer, un
 * colchón negativo, un cuerpo sin ningún campo—, exactamente como en
 * `POST /review/:id/resolve` y `POST /classify`.
 *
 * Va en su propio archivo y no en `routes.ts` por lo mismo que `sync-route.ts`
 * y `chat-route.ts`: es una superficie con su propio ciclo de vida, y un test
 * puede montarla sola.
 */
import type Database from "better-sqlite3";
import { Router } from "express";
import { readProfile, writeProfile } from "../onboard/profile.js";
import { suggestRecurringExpenses } from "../onboard/recurring.js";
import { onboardingProfileBodySchema } from "./schemas.js";

/** El perfil serializado. Los nombres van en `snake_case` como el resto de la
 * API; `colchon_fijado` es R25 y no es derivable de `colchon_objetivo` sin
 * repetir la regla en el cliente. */
function serializarPerfil(db: Database.Database) {
  const perfil = readProfile(db);
  return {
    dias_pago: perfil.diasPago,
    dia_de_pago_fijado: perfil.diaDePagoFijado,
    colchon_objetivo: perfil.colchonObjetivo,
    colchon_fijado: perfil.colchonFijado,
  };
}

export function createOnboardingRouter(getDb: () => Database.Database): Router {
  const router = Router();

  router.get("/onboarding/profile", (_req, res) => {
    res.json(serializarPerfil(getDb()));
  });

  /**
   * Escribe los dos campos del perfil. **Parcial**: lo que no viene no se toca,
   * porque el usuario fija el colchón y el día de pago en momentos distintos.
   * Un cuerpo sin ninguno de los dos es un 400 y no un 200 mudo: guardar nada
   * no es guardar.
   */
  router.post("/onboarding/profile", (req, res) => {
    const body = onboardingProfileBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid profile body", details: body.error.flatten() });
      return;
    }

    const resultado = writeProfile(getDb(), {
      diasPago: body.data.dias_pago,
      colchonObjetivo: body.data.colchon_objetivo,
    });
    if (!resultado.ok) {
      res.status(400).json({ error: resultado.error });
      return;
    }

    res.json({ ok: true, campos: resultado.campos, ...serializarPerfil(getDb()) });
  });

  /**
   * La lectura de gastos fijos (H30). Es un GET porque **no escribe nada**: el
   * análisis propone y el usuario confirma ítem por ítem, y cada confirmación
   * va por `POST /api/classify`, que es el único escritor de categoría del MVP
   * (M4). Que esto sea de sólo lectura es el criterio 4 del ticket dicho en
   * verbos HTTP.
   */
  router.get("/onboarding/recurring", (_req, res) => {
    const salida = suggestRecurringExpenses(getDb());
    res.json({
      propuestas: salida.propuestas.map((propuesta) => ({
        pattern: propuesta.pattern,
        counterparty: propuesta.counterparty,
        monto_estimado: propuesta.montoEstimado,
        dia_tipico: propuesta.diaTipico,
        sample_size: propuesta.sampleSize,
        count: propuesta.count,
        total: propuesta.total,
        last_ts: propuesta.lastTs,
      })),
      candidatas: salida.candidatas,
      en_la_cola: salida.enLaCola,
      meses_de_historial: salida.mesesDeHistorial,
      meses_minimos: salida.mesesMinimos,
      suficiente_historial: salida.suficienteHistorial,
    });
  });

  return router;
}
