import { describe, expect, it } from "vitest";
import { cleanFieldValue, htmlToText } from "./html-text.js";

describe("htmlToText", () => {
  it("deja intacto un texto que ya es plano", () => {
    const plain = "Contacto: ANA PEREZ\nBanco Destino: Produbanco";
    expect(htmlToText(plain)).toBe(plain);
  });

  it("quita las etiquetas y decodifica las entidades", () => {
    expect(htmlToText("<STRONG>Contacto:</STRONG><SPAN>&nbsp;</SPAN>ANA PEREZ")).toBe("Contacto: ANA PEREZ");
  });

  it("traduce los saltos de linea a \\n para que extractField pueda cortar ahi", () => {
    // Colapsarlos a espacio uniria el valor de un campo con el label del
    // siguiente, que es exactamente el bug que este modulo arregla.
    expect(htmlToText("Contacto: ANA PEREZ<BR>Banco Destino: Produbanco")).toBe(
      "Contacto: ANA PEREZ\nBanco Destino: Produbanco"
    );
  });

  // El mailer de Produbanco (MSHTML) envuelve el HTML a ~72 columnas y el
  // salto del codigo fuente cae en cualquier parte. En HTML eso es espacio en
  // blanco y nada mas: preservarlo partia los campos en lugares arbitrarios.
  // Ver docs/formato-correos-produbanco.md seccion 2.
  it("colapsa el salto de linea del codigo fuente que cae DENTRO de un valor", () => {
    expect(htmlToText("<STRONG>Cuenta Débito:</STRONG> ANA\nXXXXXX54321<BR>Fin")).toBe(
      "Cuenta Débito: ANA XXXXXX54321\nFin"
    );
  });

  it("colapsa el salto que cae ENTRE el label y su valor", () => {
    expect(htmlToText("<P><STRONG>Monto:</STRONG>\n$12.34</P>")).toBe("Monto: $12.34");
  });

  it("colapsa el salto que cae DENTRO del label", () => {
    expect(htmlToText("<STRONG>Cuenta\nDestino:</STRONG> XXXXX54321")).toBe("Cuenta Destino: XXXXX54321");
  });

  it("descarta el contenido de <style>, no solo la etiqueta", () => {
    expect(htmlToText("<style>body{color:red}</style><p>Monto: $10.00</p>")).toBe("Monto: $10.00");
  });

  it("decodifica entidades numericas decimales y hexadecimales", () => {
    expect(htmlToText("A&#160;B&#xA0;C")).toBe("A B C");
  });

  it("no re-decodifica el resultado de una entidad ya decodificada", () => {
    // `&#38;` es `&`; si se decodificaran las numericas primero, `&#38;nbsp;`
    // se volveria `&nbsp;` y luego un espacio.
    expect(htmlToText("A&#38;nbsp;B")).toBe("A&nbsp;B");
  });
});

describe("cleanFieldValue", () => {
  it("limpia la contraparte con marcado que se guardaba en la base", () => {
    // Caso real observado en el ledger migrado: el `<BR>` separaba la
    // contraparte del label "Banco Destino" que la seguia.
    expect(cleanFieldValue("</STRONG><SPAN>&nbsp;</SPAN>ANA PEREZ<BR><STRONG>Banco")).toBe("ANA PEREZ");
  });

  it("conserva un nombre limpio tal cual", () => {
    expect(cleanFieldValue("Comercio Ejemplo S.A.")).toBe("Comercio Ejemplo S.A.");
  });

  it("colapsa los espacios internos sobrantes", () => {
    expect(cleanFieldValue("ANA   PEREZ ")).toBe("ANA PEREZ");
  });

  it("devuelve null cuando no queda nada legible", () => {
    // Un "" en counterparty diria "el banco mando la contraparte vacia", que
    // no es lo mismo que "no habia contraparte".
    expect(cleanFieldValue("<SPAN>&nbsp;</SPAN>")).toBeNull();
  });

  it("propaga null y undefined sin tocarlos", () => {
    expect(cleanFieldValue(null)).toBeNull();
    expect(cleanFieldValue(undefined)).toBeNull();
  });
});
