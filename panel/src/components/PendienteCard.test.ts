/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PendienteCard from "./PendienteCard.vue";

function montar(props: Record<string, unknown> = {}) {
  return mount(PendienteCard, { props: { titulo: "Tus movimientos", ...props } as never });
}

describe("PendienteCard — 'todavía no', que no es 'se rompió'", () => {
  it("usa la tarjeta y la etiqueta del sistema, no un cartel propio", () => {
    const w = montar();

    expect(w.get('[data-testid="pendiente"]').classes()).toContain("card");
    const tag = w.get(".tag");
    // Neutra: un `501 no_portado` no es un error, y el rojo diría que lo es.
    expect(tag.classes()).toContain("neu");
    expect(tag.classes()).not.toContain("bad");
  });

  it("no dibuja un cero ni un dato de ejemplo en lugar del dato que falta", () => {
    const w = montar();
    const texto = w.text();

    expect(texto).toContain("No es un error");
    expect(texto).toContain("no se dibuja un cero");
    expect(w.find(".num").exists()).toBe(false);
  });

  it("dice qué es lo que no puede mostrar todavía", () => {
    expect(montar({ titulo: "Tu cola de preguntas" }).text()).toContain("Tu cola de preguntas");
  });

  it("la nota es opcional: sin ella no queda un renglón vacío", () => {
    expect(montar().find(".nota").exists()).toBe(false);
    expect(montar({ nota: "Mientras tanto, conectá tu correo." }).get(".nota").text()).toBe(
      "Mientras tanto, conectá tu correo."
    );
  });
});
