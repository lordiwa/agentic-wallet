/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Inicio from "./Inicio.vue";
import { parseHash, PANTALLAS, RUTAS } from "../router/ruta";

describe("Inicio (la portada institucional)", () => {
  it("dibuja las seis secciones de `home.html`, con sus ids", () => {
    const wrapper = mount(Inicio);
    // Los ids son los que enlaza el indice del nav: si uno se renombra, el
    // enlace deja de hacer scroll y no lo nota nadie.
    for (const id of ["que-es", "como-funciona", "privacidad", "empezar", "faq"]) {
      expect(wrapper.find(`#${id}`).exists()).toBe(true);
    }
    expect(wrapper.find(".cta").exists()).toBe(true);
  });

  it("los cuatro botones a la puerta llevan al panel, no a un archivo del sistema", () => {
    const wrapper = mount(Inicio);
    // En `home.html` los cuatro (nav, hero, cierre y pie) apuntan a
    // `p0-acceso.html`, que es una tarjeta del design system y no una ruta de
    // esta aplicacion.
    const alPanel = wrapper.findAll('a[href="#/resumen"]');
    expect(alPanel).toHaveLength(4);
    expect(wrapper.find('[data-testid="inicio-entrar"]').text()).toBe("Entrar al panel");
    expect(wrapper.html()).not.toContain("p0-acceso.html");
  });

  it("ningún enlace del índice escribe el hash: sacaría de la portada", () => {
    const wrapper = mount(Inicio);
    // En `home.html` el indice son anclas (`href="#que-es"`). Aca no pueden
    // serlo: el panel enruta POR el hash, asi que `#que-es` es una ruta que
    // `parseHash` no entiende y que manda al Resumen — el indice expulsaria de
    // la pagina que estas leyendo. Los unicos hrefs con hash son los tres que
    // van al panel a proposito.
    const conHash = wrapper
      .findAll("a")
      .map((a) => a.attributes("href") ?? "")
      .filter((href) => href.startsWith("#"));
    expect(conHash).toEqual(["#/resumen", "#/resumen", "#/resumen", "#/resumen"]);
  });

  it("pide las tipografías de la portada recién al montarla, y una sola vez", () => {
    const selector = 'link[href*="Space+Grotesk"]';
    // Los `mount` de los casos anteriores comparten este `document`, asi que la
    // pregunta "se pidieron?" solo tiene sentido desde una cabeza limpia.
    for (const previo of document.head.querySelectorAll(selector)) previo.remove();
    expect(document.head.querySelectorAll(selector)).toHaveLength(0);

    mount(Inicio);
    expect(document.head.querySelectorAll(selector)).toHaveLength(1);

    // Un segundo montaje no vuelve a pedirlas.
    mount(Inicio);
    expect(document.head.querySelectorAll(selector)).toHaveLength(1);
  });
});

describe("la ruta de la portada", () => {
  it("`inicio` es una ruta válida y NO está en la barra lateral", () => {
    expect(RUTAS).toContain("inicio");
    // La barra dibuja las tres del MVP. La portada va delante de la puerta, no
    // adentro del panel: enlazarla desde la barra seria salir desde adentro.
    expect(PANTALLAS).not.toContain("inicio");
  });

  it("se llega por `#/inicio` y el arranque sigue siendo el Resumen", () => {
    expect(parseHash("#/inicio").pantalla).toBe("inicio");
    // Lo que importa de verdad: agregar la portada no movio el hogar.
    expect(parseHash("").pantalla).toBe("resumen");
    expect(parseHash("#/").pantalla).toBe("resumen");
  });
});
