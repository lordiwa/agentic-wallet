// Lo minimo para que la navegacion funcione en el celular: abrir/cerrar el
// cajon lateral y marcar en que seccion va la lectura.

(function () {
  var burger = document.getElementById("burger");
  var scrim = document.getElementById("scrim");
  var sidebar = document.getElementById("sidebar");

  function setNav(open) {
    document.body.classList.toggle("nav-open", open);
    if (scrim) scrim.hidden = !open;
    if (burger) burger.setAttribute("aria-expanded", String(open));
  }

  if (burger) {
    burger.addEventListener("click", function () {
      setNav(!document.body.classList.contains("nav-open"));
    });
  }
  if (scrim) scrim.addEventListener("click", function () { setNav(false); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setNav(false);
  });

  // Tocar un enlace del indice ya cambio de seccion: dejar el cajon abierto
  // encima del texto no sirve de nada.
  if (sidebar) {
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest("a")) setNav(false);
    });
  }

  // Resaltar la seccion visible en el indice lateral.
  var links = [].slice.call(document.querySelectorAll(".nav-sub"));
  if (!links.length || !("IntersectionObserver" in window)) return;

  var byId = {};
  var targets = [];
  links.forEach(function (a) {
    var id = decodeURIComponent(a.getAttribute("href").slice(1));
    var el = document.getElementById(id);
    if (!el) return;
    byId[id] = a;
    targets.push(el);
  });

  var current = null;
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var a = byId[entry.target.id];
        if (!a || a === current) return;
        if (current) current.style.color = "";
        a.style.color = "var(--accent)";
        current = a;
      });
    },
    { rootMargin: "-10% 0px -75% 0px" },
  );
  targets.forEach(function (el) { observer.observe(el); });
})();
