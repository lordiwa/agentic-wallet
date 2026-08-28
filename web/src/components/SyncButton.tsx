import { useState } from "react";
import { postSync } from "../api/client";
import type { SyncResponse } from "../api/types";

type Status = "idle" | "loading" | "done" | "error";

/**
 * Triggers POST /api/sync and reflects the result summary (AC4). /api/sync
 * lands in F1-08, a separate ticket not yet built when this was written —
 * a 404 or any other error is shown as a readable message instead of
 * crashing the dashboard.
 */
export function SyncButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setError(null);
    try {
      const res = await postSync();
      setResult(res);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al sincronizar");
      setStatus("error");
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={status === "loading"}>
        {status === "loading" ? "Sincronizando..." : "Sincronizar"}
      </button>
      {status === "done" && result && <p role="status">Sincronizacion completa: {JSON.stringify(result)}</p>}
      {status === "error" && error && <p role="alert">{error}</p>}
    </div>
  );
}
