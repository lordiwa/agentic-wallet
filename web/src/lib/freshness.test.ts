import { describe, expect, it } from "vitest";
import { syncFreshness, timeAgo } from "./freshness";

const NOW = new Date("2026-09-01T12:00:00Z");

describe("syncFreshness", () => {
  it("sin fecha es 'nunca', no 'atrasado'", () => {
    expect(syncFreshness(null, false, NOW)).toBe("nunca");
  });

  it("una fecha ilegible se trata como 'nunca', no revienta", () => {
    expect(syncFreshness("no-es-una-fecha", false, NOW)).toBe("nunca");
  });

  it("dentro de las 24h esta al dia", () => {
    expect(syncFreshness("2026-09-01T11:00:00Z", false, NOW)).toBe("al-dia");
    expect(syncFreshness("2026-08-31T12:00:00Z", false, NOW)).toBe("al-dia");
  });

  it("pasadas las 24h esta atrasado", () => {
    expect(syncFreshness("2026-08-31T11:59:00Z", false, NOW)).toBe("atrasado");
  });

  it("un backlog a medias gana sobre una fecha reciente", () => {
    expect(syncFreshness("2026-09-01T11:59:00Z", true, NOW)).toBe("en-progreso");
  });
});

describe("timeAgo", () => {
  it("sin fecha devuelve null en vez de inventar una", () => {
    expect(timeAgo(null, NOW)).toBeNull();
    expect(timeAgo("no-es-una-fecha", NOW)).toBeNull();
  });

  it("escala de segundos a dias", () => {
    expect(timeAgo("2026-09-01T11:59:30Z", NOW)).toBe("recien");
    expect(timeAgo("2026-09-01T11:59:00Z", NOW)).toBe("hace 1 minuto");
    expect(timeAgo("2026-09-01T11:30:00Z", NOW)).toBe("hace 30 minutos");
    expect(timeAgo("2026-09-01T09:00:00Z", NOW)).toBe("hace 3 horas");
    expect(timeAgo("2026-08-29T12:00:00Z", NOW)).toBe("hace 3 dias");
  });

  it("un reloj adelantado dice 'recien', no un negativo", () => {
    expect(timeAgo("2026-09-01T12:05:00Z", NOW)).toBe("recien");
  });
});
