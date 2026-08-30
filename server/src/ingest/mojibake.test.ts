import { describe, expect, it } from "vitest";
import { repairMojibake } from "./mojibake.js";

describe("repairMojibake", () => {
  it("repara el doble-encode UTF-8 -> latin-1 del cuerpo real de Produbanco", () => {
    // El correo de "COMPRA MINUTOS CLARO" llega con estos bytes exactos.
    expect(repairMojibake("La informaciÃ³n y adjuntos")).toBe("La información y adjuntos");
    expect(repairMojibake("Cualquier opiniÃ³n expresada")).toBe("Cualquier opinión expresada");
  });

  it("repara las demás vocales acentuadas y la eñe", () => {
    expect(repairMojibake("PAZMIÃ‘O AndrÃ©s NÃºÃ±ez dÃ©bito automÃ¡tico")).toBe(
      "PAZMIÑO Andrés Núñez débito automático"
    );
  });

  it("deja intacto un cuerpo que ya está bien decodificado", () => {
    const bueno = "La información y adjuntos contenidos en este mensaje son confidenciales.";
    expect(repairMojibake(bueno)).toBe(bueno);
  });

  it("deja intacto un cuerpo ASCII puro", () => {
    expect(repairMojibake("Monto: USD 12.34")).toBe("Monto: USD 12.34");
  });

  it("no toca un cuerpo mezclado: si la reparación no es UTF-8 válido, no se aplica", () => {
    // "ó" bien decodificada (U+00F3) junto a una secuencia con pinta de
    // mojibake. Re-encodear a latin-1 daría el byte 0xF3 suelto, que no es
    // UTF-8 válido: antes de devolver algo con U+FFFD se devuelve el original.
    const mezclado = "información Ã³";
    expect(repairMojibake(mezclado)).toBe(mezclado);
  });

  it("no toca un cuerpo con caracteres fuera de latin-1", () => {
    // Un emoji (o cualquier código > U+00FF) no sobrevive el round-trip por
    // latin-1, así que la reparación se descarta entera en vez de mutilarlo.
    const conEmoji = "Ã³ 🙂";
    expect(repairMojibake(conEmoji)).toBe(conEmoji);
  });

  it("es idempotente: reparar dos veces da lo mismo que reparar una", () => {
    const once = repairMojibake("informaciÃ³n");
    expect(repairMojibake(once)).toBe(once);
  });

  it("no confunde un nombre que legítimamente lleva Ã seguido de espacio", () => {
    // El guarda es "Ã/Â seguido de un carácter latin-1 alto", no "hay una Ã".
    expect(repairMojibake("Ã B")).toBe("Ã B");
  });
});
