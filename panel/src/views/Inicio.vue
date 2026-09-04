<script setup lang="ts">
/**
 * `Inicio` — la portada publica, replica de `home.html` del design system
 * (tarjeta `group="Páginas" name="Home — página institucional"`).
 *
 * **No es el shell del panel, y no puede serlo.** El shell es el bloque que se
 * repite identico en las once `p*.html` —barra lateral oscura, contenido
 * claro— y ya vive en `components/AppShell.vue`. `home.html` es otra cosa: una
 * pagina de una sola columna, oscura, con hero y secciones, cuyos cuatro
 * botones de entrada (en el nav, en el hero, en el cierre y en el pie) apuntan
 * a `p0-acceso.html`. En el propio sistema esta DELANTE de la puerta, no
 * alrededor de las pantallas. De ahi que su paleta no comparta un solo hex con
 * la del panel: son dos superficies distintas, no dos versiones de una.
 *
 * Por eso esta vista se dibuja **sola**, fuera de `AppShell` y fuera de las dos
 * puertas de `App.vue`: trae su propia navegacion y su propio fondo.
 *
 * Las dos fuentes (Space Grotesk, IBM Plex Mono) ya NO se piden desde aca.
 * Las pide `index.html`, junto con sus `preconnect`. El motivo por el que
 * vivian en un `onMounted` —"el panel usa `system-ui` y esta pagina no es
 * razon para que cargue tipografia de terceros en cada visita al Resumen"—
 * dejo de ser cierto cuando el sistema paso al tema oscuro: ahora Space
 * Grotesk titula y IBM Plex Mono dibuja las etiquetas en TODA pantalla, asi
 * que la descarga ya no es un costo que la portada le imponga al panel.
 */
import { toHash } from "../router/ruta";

/** A donde va "Entrar al panel": la puerta, o sea la raiz del panel. */
const alPanel = toHash("resumen");

/**
 * Los enlaces del indice hacen scroll, no navegan.
 *
 * En `home.html` son anclas (`href="#que-es"`), pero el panel enruta POR el
 * hash: escribir `#que-es` seria una ruta que `parseHash` no entiende, y
 * mandaria al Resumen — un enlace del indice te sacaria de la pagina. Mismo
 * gesto, misma posicion, sin tocar la barra de direcciones.
 */
function irA(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <div class="home" data-testid="inicio">
    <nav>
      <div class="wrap">
        <span class="brand"><span class="mark"><i></i></span> Agentic Wallet</span>
        <a class="lnk" href="" @click.prevent="irA('que-es')">Qué es</a>
        <a class="lnk" href="" @click.prevent="irA('como-funciona')">Cómo funciona</a>
        <a class="lnk" href="" @click.prevent="irA('privacidad')">Privacidad</a>
        <a class="lnk" href="" @click.prevent="irA('empezar')">Empezar</a>
        <a class="lnk" href="" @click.prevent="irA('faq')">FAQ</a>
        <a class="btn grn" :href="alPanel" data-testid="inicio-entrar">Entrar al panel</a>
      </div>
    </nav>

    <header class="hero">
      <div class="coords">LAT −0.1807 / LON −78.4678<br />BUILD nube · REGIÓN us-central1</div>
      <div class="wrap">
        <div>
          <span class="pill rise"><i></i> ENTRÁS Y YA ESTÁ — NADA QUE INSTALAR</span>
          <h1 class="rise d1">Tu plata, en <em>tus</em> propias manos.</h1>
          <p class="lead rise d2">
            Agentic Wallet lee los correos que <b>tu banco ya te manda</b>, arma tu historial de
            gastos <b>en tu espacio privado</b>, y te deja preguntarle lo que quieras en lenguaje
            natural.
          </p>
          <p class="hard rise d3">
            No hay nada que descargar. No se conecta a tu banco ni te pide su clave. Tu historial
            es tuyo y de nadie más: un ledger por persona, sin nada compartido entre cuentas.
          </p>
          <div class="ctas rise d4">
            <a class="btn pri" href="" @click.prevent="irA('empezar')">Cómo empezar</a>
            <a class="btn" :href="alPanel">Entrar con Google</a>
          </div>
        </div>
        <div class="demo hud">
          <div class="bar">
            <i></i><i></i><i></i> agentic-wallet · chat
            <span class="url"><b>●</b> tu panel</span>
          </div>
          <div class="body">
            <div class="msg q">¿Cuánto gasté en comida este mes?</div>
            <div class="msg a">
              Llevás 18 consumos en comida este mes. La mayoría son de supermercado; el resto,
              delivery.<span class="src">fuente: <b>tu ledger</b> · 18 filas · 0 en revisión</span>
            </div>
            <div class="msg q">¿Me alcanza para la cuota de la moto?</div>
            <div class="msg a">
              Sí. Después de reservar tu colchón te queda margen, y tu próximo sueldo entra en 6
              días.<span class="src">fuente: <b>tu ledger</b> · saldo + colchón + ciclo de sueldo</span>
            </div>
            <div class="msg a escribiendo">escribí tu pregunta <span class="caret"></span></div>
          </div>
          <p class="cap">
            <span>// ejemplo ilustrativo con datos de demostración</span><span>en tu navegador</span>
          </p>
        </div>
      </div>

      <div class="pipe">
        <div class="head">
          <div class="wrap">
            <span>ARQUITECTURA / RECORRIDO DEL DATO</span>
            <span>NINGÚN TRAMO SALE DE TU CUENTA</span>
          </div>
        </div>
        <div class="wrap sin-padding">
          <div class="grid">
            <div class="pnode">
              <span class="k">ORIGEN <em>solo lectura</em></span><b>Tu Gmail</b>
              <span class="d">Los avisos que tu banco ya te manda.</span>
              <div class="lane"></div>
            </div>
            <div class="pnode">
              <span class="k">PARSER <em>determinista</em></span><b>Lector automático</b>
              <span class="d">Monto, fecha y comercio. Mismas reglas, mismo resultado.</span>
              <div class="lane"></div>
            </div>
            <div class="pnode">
              <span class="k">LEDGER <em>privado</em></span><b>Sólo tuyo</b>
              <span class="d">Un historial por persona. Ninguna cuenta ve la de otra.</span>
              <div class="lane"></div>
            </div>
            <div class="pnode">
              <span class="k">INTERFAZ <em>tu navegador</em></span><b>Tablero + chat</b>
              <span class="d">Lo abrís donde estés. No hay nada que instalar.</span>
              <div class="lane"></div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section id="que-es">
      <div class="wrap">
        <div class="shead">
          <h2>Un copiloto financiero que entiende tus correos del banco</h2>
          <span class="side">QUÉ ES<br />/QUE-ES</span>
        </div>
        <p class="lede">
          Tu banco ya te avisa por correo cada vez que pagás algo, transferís o te entra el sueldo.
          Esa información es tuya y está ahí, desordenada, entre miles de mails. Agentic Wallet la
          ordena — y la deja donde debe estar: atada a tu cuenta, y a ninguna otra.
        </p>
        <div class="grid3 hud">
          <div class="cell">
            <div class="ic">↓</div>
            <h3>Ordena lo que ya tenés</h3>
            <p>
              Convierte los correos de tu banco en un historial claro: consumos, transferencias,
              retiros, sueldos y reversos, cada uno con su fecha, su monto y dónde fue.
            </p>
          </div>
          <div class="cell">
            <div class="ic">#</div>
            <h3>Categoriza a tu manera</h3>
            <p>
              Nada viene precargado. Vos decidís qué es "comida", qué es "salud" y qué es
              "suscripción" — es tu clasificación, no la de un algoritmo que no te conoce.
            </p>
          </div>
          <div class="cell">
            <div class="ic">Σ</div>
            <h3>Te da la foto completa</h3>
            <p>
              Saldo, gasto por categoría, cuántos días faltan para tu próximo sueldo, tus deudas y
              el colchón que querés mantener. Todo en un tablero, desde cualquier navegador.
            </p>
          </div>
          <div class="cell">
            <div class="ic">?</div>
            <h3>Le preguntás como a una persona</h3>
            <p>
              "¿Cuánto gasté en delivery?", "¿me alcanza para esto?", "¿qué pagué la semana
              pasada?". Un chat que responde sobre tu historial real, no en general.
            </p>
          </div>
          <div class="cell">
            <div class="ic">⌘</div>
            <h3>Tu asistente de IA lo puede usar</h3>
            <p>
              El wallet se expone como herramientas MCP: tu agente puede consultar tu saldo o
              sincronizar por vos — siempre contra tu mismo ledger.
            </p>
          </div>
          <div class="cell">
            <div class="ic">∅</div>
            <h3>Sin formularios, sin contraseñas</h3>
            <p>
              No hay usuario ni clave que recordar: entrás con tu cuenta de Google y listo. Tampoco
              hay tarjeta que cargar para empezar a usarlo.
            </p>
          </div>
        </div>
      </div>
    </section>

    <div class="band">
      <div class="wrap">
        <div class="stat">
          <b><em>0</em></b><span>CLAVES DE BANCO QUE DAR</span>
          <div class="g"><i class="g2"></i></div>
        </div>
        <div class="stat">
          <b><em>0</em></b><span>ARCHIVOS QUE INSTALAR</span>
          <div class="g"><i class="g2"></i></div>
        </div>
        <div class="stat">
          <b>1</b><span>LEDGER POR PERSONA</span>
          <div class="g"><i class="g14"></i></div>
        </div>
        <div class="stat">
          <b>100<em>%</em></b><span>DEL PERMISO, SÓLO LECTURA</span>
          <div class="g"><i class="g100"></i></div>
        </div>
      </div>
    </div>

    <section id="como-funciona" class="lt">
      <div class="wrap">
        <div class="shead">
          <h2>Cuatro pasos, y ninguno toca tu banco</h2>
          <span class="side">CÓMO FUNCIONA<br />/PIPELINE</span>
        </div>
        <p class="lede">
          No hace falta que entiendas la parte técnica para usarlo, pero sí conviene que sepas por
          dónde pasa tu información. Es corto:
        </p>
        <div class="steps">
          <div class="step">
            <div class="n">›</div>
            <h3>Lee tu Gmail</h3>
            <p>
              Solo los correos de tu banco, y solo para leerlos. El permiso es de lectura: no puede
              enviar, cambiar ni borrar nada.
            </p>
            <span class="f">scope: gmail.readonly</span>
          </div>
          <div class="step">
            <div class="n">›</div>
            <h3>Entiende el correo</h3>
            <p>
              Un lector automático saca el monto, la fecha y el comercio del texto del mail. Siempre
              las mismas reglas, siempre el mismo resultado.
            </p>
            <span class="f">parser determinista</span>
          </div>
          <div class="step">
            <div class="n">›</div>
            <h3>Guarda en tu ledger</h3>
            <p>
              Cada movimiento queda en tu historial, atado a tu cuenta. Podés exportarlo o borrarlo
              entero cuando quieras.
            </p>
            <span class="f">un ledger por persona</span>
          </div>
          <div class="step">
            <div class="n">›</div>
            <h3>Lo consultás</h3>
            <p>
              Abrís el tablero o le preguntás por chat. Reconoce reversos, duplicados y
              transferencias entre tus propias cuentas.
            </p>
            <span class="f">desde cualquier navegador</span>
          </div>
        </div>
        <div class="rule">
          <span class="flag">REGLA DE ORO</span>
          <div class="rb">
            <b class="t">La IA nunca inventa un monto</b>
            <p>
              Los números siempre salen del lector automático. La IA es solo una
              <b>segunda opinión</b>: lee el mismo correo y dice qué monto ve. Si no coinciden, el
              movimiento se marca <span class="tag">EN REVISIÓN</span> y queda fuera de todos los
              totales hasta que vos lo mires. Preferimos "esto no lo tengo claro" antes que una
              cifra inventada.
            </p>
          </div>
        </div>
      </div>
    </section>

    <section id="privacidad">
      <div class="wrap">
        <div class="shead">
          <h2>Lo que hacemos con tus datos, y lo que no</h2>
          <span class="side">PRIVACIDAD<br />/AUDITABLE</span>
        </div>
        <p class="lede">
          Preferimos ser explícitos antes que decir "tu privacidad nos importa" y dejarlo ahí.
        </p>
        <div class="two">
          <div class="plist si hud">
            <div class="ph"><i></i>ASÍ FUNCIONA</div>
            <div class="pb">
              <div>
                <span class="m">[✓]</span>
                <p>
                  <b>Tu historial es sólo tuyo.</b> Un ledger por persona, atado a tu cuenta. Nadie
                  más lo consulta, y no se cruza con el de nadie.
                </p>
              </div>
              <div>
                <span class="m">[✓]</span>
                <p>
                  <b>Gmail, solo lectura.</b> Filtrado por los remitentes de tu banco: el resto de
                  tu bandeja no se toca.
                </p>
              </div>
              <div>
                <span class="m">[✓]</span>
                <p>
                  <b>Lo revocás cuando quieras.</b> Desde tu cuenta de Google, en dos clics, sin
                  pedirle permiso a nadie.
                </p>
              </div>
              <div>
                <span class="m">[✓]</span>
                <p>
                  <b>Lo único que viaja</b> es el texto del correo bancario para la segunda opinión
                  — enmascarado: las cuentas salen como <code>XXXXXX1234</code>.
                </p>
              </div>
            </div>
          </div>
          <div class="plist no">
            <div class="ph"><i></i>LO QUE NO EXISTE</div>
            <div class="pb">
              <div>
                <span class="m">[✕]</span>
                <p>
                  <b>No hay formulario de registro.</b> No te pedimos nombre, teléfono ni tarjeta:
                  tu identidad es tu cuenta de Google y nada más.
                </p>
              </div>
              <div>
                <span class="m">[✕]</span>
                <p>
                  <b>No se conecta a tu banco.</b> Nunca te pide tu clave. No podría entrar aunque
                  quisiera: solo lee correos.
                </p>
              </div>
              <div>
                <span class="m">[✕]</span>
                <p>
                  <b>No hay publicidad ni venta de datos.</b> Tus movimientos no alimentan a nadie:
                  el código es abierto para que lo revises.
                </p>
              </div>
              <div>
                <span class="m">[✕]</span>
                <p>
                  <b>No quedás atado.</b> Desconectás el correo y borrás tu historial completo desde
                  el panel, sin pedirle permiso a nadie.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="empezar" class="lt">
      <div class="wrap">
        <div class="shead">
          <h2>Tres pasos, y el tercero ya es tu tablero</h2>
          <span class="side">EMPEZAR<br />/EN-EL-NAVEGADOR</span>
        </div>
        <p class="lede">
          No hay que descargar nada ni escribir comandos. Abrís el panel, entrás con tu cuenta y le
          das permiso de lectura a tu correo. Se hace una sola vez; de ahí en más sólo entrás.
        </p>
        <div class="inst">
          <div class="icard">
            <div class="th">Entrar <em>~10 SEG</em></div>
            <div class="tb">
              <h3>Con tu cuenta de Google</h3>
              <p>
                Sin usuario ni contraseña que recordar. Entrar es sólo identidad: todavía no toca tu
                correo, y podés entrar y no conectarlo nunca.
              </p>
              <div class="ok">✓ ya estás adentro</div>
            </div>
          </div>
          <div class="icard">
            <div class="th">Conectar Gmail <em>~1 MIN</em></div>
            <div class="tb">
              <h3>Permiso de sólo lectura</h3>
              <p>
                Google te lo pide en su propia pantalla y te dice exactamente qué se le da. Lo
                revocás cuando quieras, desde tu cuenta y en dos clics.
              </p>
              <div class="ok">✓ scope: gmail.readonly</div>
            </div>
          </div>
          <div class="icard">
            <div class="th">Sincronizar <em>5–20 MIN</em></div>
            <div class="tb">
              <h3>Y ya está</h3>
              <p>
                La primera lectura arma tu historial con los avisos que tu banco ya te mandó. Podés
                cerrar la pestaña: sigue del lado del servicio y lo encontrás hecho.
              </p>
              <div class="ok">✓ tu tablero, con tus movimientos</div>
            </div>
          </div>
        </div>
        <p class="req">
          <b>Necesitás:</b> un navegador · tu cuenta de Gmail · un banco que te avise cada
          movimiento por correo. Nada más: ni instalar, ni configurar, ni poner una tarjeta.
        </p>
      </div>
    </section>

    <section id="faq">
      <div class="wrap">
        <div class="shead">
          <h2>Todo lo que te vas a preguntar</h2>
          <span class="side">PREGUNTAS<br />/FAQ</span>
        </div>
        <div class="faq">
          <div class="qa">
            <h3>¿Necesito saber programar?</h3>
            <p>
              No. Entrás con tu cuenta de Google y le das permiso de lectura a tu correo. Lo único
              que hacés vos es contestar preguntas — cada cuánto cobrás, a qué categoría va cada
              comercio — dentro del mismo panel.
            </p>
          </div>
          <div class="qa">
            <h3>¿Cuánto cuesta?</h3>
            <p>
              Hoy no se cobra nada: no hay plan mensual ni tarjeta que cargar para empezar, ni se
              cobra por movimiento o por pregunta. El código es abierto y podés revisarlo.
            </p>
          </div>
          <div class="qa">
            <h3>¿Es seguro? ¿Alguien más ve mis datos?</h3>
            <p>
              Cada persona tiene su propio ledger, atado a su cuenta, y ninguna cuenta puede leer la
              de otra. El permiso a tu correo es de sólo lectura y lo revocás vos, cuando quieras,
              desde tu cuenta de Google.
            </p>
          </div>
          <div class="qa">
            <h3>¿Puede mover mi plata o pagar algo?</h3>
            <p>
              No puede hacer nada de eso. El permiso a Gmail es de solo lectura y no existe ninguna
              conexión con tu banco. Es un programa que mira y ordena. Nada más.
            </p>
          </div>
          <div class="qa">
            <h3>¿Funciona con mi banco?</h3>
            <p>
              Tu banco tiene que mandarte un correo por cada movimiento. Hoy está probado con
              Produbanco (Ecuador); agregar otro banco es un trabajo técnico acotado, documentado en
              el repositorio.
            </p>
          </div>
          <div class="qa">
            <h3>¿Funciona en Mac o en el celular?</h3>
            <p>
              Sí: es una página, no un programa. Funciona igual en Windows, Mac, Linux y en el
              navegador del teléfono — no hay nada que instalar en ningún lado.
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="cta">
      <i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i>
      <div class="wrap">
        <span class="kicker">SOBERANÍA DE DATOS</span>
        <h2>Tu historial financiero debería ser tuyo</h2>
        <p>
          No hace falta darle la clave de tu banco a una aplicación que no conocés para saber en qué
          se te va la plata. Ya tenés los datos en tu correo — esto sólo los ordena, y los deja
          donde estaban: con vos.
        </p>
        <div class="ctas">
          <a class="btn pri" href="" @click.prevent="irA('empezar')">Empezar — son tres pasos</a>
          <a class="btn" :href="alPanel">Entrar al panel</a>
        </div>
      </div>
    </section>

    <footer>
      <div class="wrap">
        <span
          ><b>Agentic Wallet</b> — un ledger por persona, permiso de sólo lectura y la clave de tu
          banco nunca en el medio.</span
        >
        <a href="https://github.com/lordiwa/agentic-wallet">Código en GitHub</a>
        <a :href="alPanel">Entrar al panel</a>
        <span class="m">tu historial empieza vacío · sin datos de nadie más</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/*
 * Transcripcion de `home.html`. Los selectores y los valores son los del
 * sistema; lo unico que cambia es que los colores salen de `tokens.css` con el
 * prefijo `--home-`. Todo va bajo `.home` porque el panel no tiene reset
 * global para esta pagina: vive al lado del shell claro, no lo reemplaza.
 */
.home {
  background: var(--home-bg);
  color: var(--home-ink);
  font: 15px/1.55 var(--fuente);
  -webkit-font-smoothing: antialiased;
  position: relative;
  min-height: 100vh;
}
.home :deep(*),
.home * {
  box-sizing: border-box;
}
/* La trama de lineas de barrido sobre toda la pagina. */
.home::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 99;
  background: repeating-linear-gradient(
    0deg,
    var(--home-scan) 0 1px,
    transparent 1px 3px
  );
}
a {
  color: var(--home-acc2);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
h1,
h2,
h3 {
  font-family: "Space Grotesk", system-ui, sans-serif;
}
.wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 28px;
}
.wrap.sin-padding {
  padding: 0;
}

/* ---- nav ---- */
nav {
  background: var(--home-nav-bg);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 9;
  border-bottom: 1px solid var(--home-line);
}
nav .wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  height: 58px;
}
.brand {
  color: var(--home-blanco);
  font-family: "Space Grotesk", sans-serif;
  font-weight: 600;
  font-size: 15.5px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: auto;
  letter-spacing: -0.01em;
}
.mark {
  width: 28px;
  height: 28px;
  border: 1px solid var(--home-line2);
  background: linear-gradient(135deg, var(--home-ic-a), var(--home-bg));
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  position: relative;
}
.mark i {
  width: 8px;
  height: 8px;
  background: var(--home-ok);
  display: block;
  box-shadow: 0 0 8px var(--home-ok-08);
}
.mark::after {
  content: "";
  position: absolute;
  inset: 2px;
  border: 1px solid var(--home-ok-025);
}
nav a.lnk {
  color: var(--home-mut);
  font-size: 12.5px;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  letter-spacing: 0.01em;
  cursor: pointer;
}
nav a.lnk:hover {
  color: var(--home-blanco);
  text-decoration: none;
}

/* ---- botones ---- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--home-line2);
  background: transparent;
  color: var(--home-texto-boton);
  padding: 10px 20px;
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  position: relative;
  cursor: pointer;
  clip-path: polygon(
    0 0,
    calc(100% - 10px) 0,
    100% 10px,
    100% 100%,
    10px 100%,
    0 calc(100% - 10px)
  );
}
.btn:hover {
  text-decoration: none;
  color: var(--home-blanco);
}
.btn.pri {
  background: var(--home-acc);
  border-color: var(--home-acc);
  color: var(--home-blanco);
  box-shadow: 0 0 24px var(--home-acc-035);
}
.btn.pri:hover {
  background: var(--home-acc-hover);
}
.btn.grn {
  border-color: var(--home-ok-05);
  color: var(--home-menta);
}
.btn.grn:hover {
  border-color: var(--home-ok);
}

/* ---- hero ---- */
.hero {
  padding: 84px 0 0;
  position: relative;
  overflow: hidden;
  background: var(--home-bg2);
}
.hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(var(--home-rejilla) 1px, transparent 1px),
    linear-gradient(90deg, var(--home-rejilla) 1px, transparent 1px);
  background-size: 44px 44px;
  opacity: 0.55;
  mask-image: radial-gradient(760px 520px at 66% 16%, var(--home-mask) 25%, transparent 72%);
  animation: gridDrift 24s linear infinite;
}
@keyframes gridDrift {
  to {
    background-position: 44px 44px, 44px 44px;
  }
}
.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(680px 440px at 72% 4%, var(--home-acc-02), transparent 68%),
    radial-gradient(420px 300px at 12% 90%, var(--home-ok-007), transparent 70%);
}
.hero > .wrap {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 52px;
  align-items: start;
  position: relative;
  z-index: 1;
}
.coords {
  position: absolute;
  top: 18px;
  right: 28px;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10px;
  color: var(--home-gris-mono);
  text-align: right;
  z-index: 1;
  letter-spacing: 0.06em;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--home-ok-04);
  background: var(--home-ok-006);
  padding: 6px 14px;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 11px;
  color: var(--home-menta);
  margin-bottom: 24px;
  letter-spacing: 0.08em;
}
.pill i {
  width: 7px;
  height: 7px;
  background: var(--home-ok);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--home-ok-09);
  animation: blink 2.2s infinite;
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
h1 {
  font-size: 56px;
  line-height: 1.02;
  letter-spacing: -0.032em;
  margin: 0 0 22px;
  font-weight: 700;
  text-wrap: balance;
  color: var(--home-blanco);
}
h1 em {
  font-style: normal;
  color: transparent;
  background: linear-gradient(100deg, var(--home-ok), var(--home-menta-clara));
  -webkit-background-clip: text;
  background-clip: text;
}
.hero p.lead {
  color: var(--home-lead);
  font-size: 16.5px;
  margin: 0 0 14px;
  max-width: 32em;
  text-wrap: pretty;
}
.hero p.lead b {
  color: var(--home-blanco);
}
.hero p.hard {
  color: var(--home-mut);
  font-size: 13.5px;
  max-width: 36em;
}
.ctas {
  display: flex;
  gap: 12px;
  margin-top: 30px;
  flex-wrap: wrap;
}
.rise {
  animation: rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.rise.d1 {
  animation-delay: 0.08s;
}
.rise.d2 {
  animation-delay: 0.16s;
}
.rise.d3 {
  animation-delay: 0.24s;
}
.rise.d4 {
  animation-delay: 0.32s;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ---- la demo tipo terminal ---- */
.demo {
  background: var(--home-panel);
  border: 1px solid var(--home-line2);
  box-shadow: 0 30px 80px var(--home-sombra),
    0 0 0 1px var(--home-acc-012), 0 0 60px var(--home-acc-008);
  animation: rise 0.8s 0.2s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  position: relative;
  overflow: hidden;
}
.demo::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 80px;
  top: -80px;
  background: linear-gradient(180deg, transparent, var(--home-acc2-006), transparent);
  animation: scan 5.5s linear infinite;
}
@keyframes scan {
  to {
    transform: translateY(560px);
  }
}
.demo .bar {
  background: var(--home-negro);
  color: var(--home-mut);
  padding: 0 14px;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  border-bottom: 1px solid var(--home-line);
}
.demo .bar i {
  width: 8px;
  height: 8px;
  background: var(--home-line2);
  font-style: normal;
  flex: none;
}
.demo .bar i:first-child {
  background: var(--home-bad-07);
}
.demo .bar .url {
  margin-left: auto;
  color: var(--home-dim);
}
.demo .bar .url b {
  color: var(--home-menta);
  font-weight: 500;
}
.demo .body {
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.msg {
  max-width: 88%;
  padding: 10px 13px;
  font-size: 13px;
  line-height: 1.5;
  border: 1px solid var(--home-line);
}
.msg.q {
  align-self: flex-end;
  background: linear-gradient(135deg, var(--home-acc), var(--home-msg-q-fin));
  border-color: var(--home-acc-hover);
  color: var(--home-blanco);
}
.msg.a {
  align-self: flex-start;
  background: var(--home-msg-a);
  color: var(--home-texto-boton);
}
/* La ultima burbuja del sistema lleva su estilo en el atributo; aca es una
 * clase, que es lo mismo sin escribir color en el markup. */
.msg.escribiendo {
  background: transparent;
  border-style: dashed;
  color: var(--home-tenue);
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 11.5px;
}
.msg .src {
  display: block;
  margin-top: 7px;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10px;
  color: var(--home-tenue);
  border-top: 1px dashed var(--home-line);
  padding-top: 6px;
}
.msg .src b {
  color: var(--home-menta-oscura);
  font-weight: 500;
}
.caret {
  display: inline-block;
  width: 7px;
  height: 13px;
  background: var(--home-menta);
  vertical-align: -2px;
  animation: blink 1s steps(1) infinite;
}
.demo .cap {
  font-size: 10.5px;
  color: var(--home-tenue);
  padding: 9px 16px;
  margin: 0;
  border-top: 1px solid var(--home-line);
  font-family: "IBM Plex Mono", var(--fuente-mono);
  display: flex;
  justify-content: space-between;
}

/* ---- el recorrido del dato ---- */
.pipe {
  position: relative;
  z-index: 1;
  margin-top: 68px;
  border-top: 1px solid var(--home-line);
  background: var(--home-pipe-bg);
}
.pipe .head {
  border-bottom: 1px solid var(--home-line);
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10px;
  color: var(--home-gris-mono);
  letter-spacing: 0.18em;
  padding: 8px 0;
}
.pipe .head .wrap {
  display: flex;
  justify-content: space-between;
}
.pipe .grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
.pnode {
  padding: 20px 22px 22px;
  border-left: 1px solid var(--home-line);
  position: relative;
}
.pnode:last-child {
  border-right: 1px solid var(--home-line);
}
.pnode .k {
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10.5px;
  color: var(--home-dim);
  letter-spacing: 0.08em;
  display: flex;
  justify-content: space-between;
}
.pnode .k em {
  font-style: normal;
  color: var(--home-ok);
}
.pnode b {
  display: block;
  color: var(--home-blanco);
  font-size: 14px;
  margin: 8px 0 4px;
  font-weight: 600;
  font-family: "Space Grotesk", sans-serif;
}
.pnode span.d {
  font-size: 12px;
  color: var(--home-mut);
  display: block;
  text-wrap: pretty;
}
.pnode .lane {
  height: 2px;
  background: var(--home-line);
  margin-top: 14px;
  position: relative;
  overflow: hidden;
}
.pnode .lane::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 34px;
  background: linear-gradient(90deg, transparent, var(--home-ok));
  animation: flow 2.8s linear infinite;
}
@keyframes flow {
  from {
    left: -40px;
  }
  to {
    left: 110%;
  }
}
.pnode::after {
  content: "▸";
  position: absolute;
  right: -6px;
  top: 22px;
  color: var(--home-tenue);
  font-size: 12px;
  z-index: 2;
}
.pnode:last-child::after {
  content: "";
}

/* ---- secciones ---- */
section {
  padding: 78px 0;
  position: relative;
}
section.lt {
  background: var(--home-seccion-clara);
  color: var(--home-tinta-clara);
}
section.lt .lede {
  color: var(--home-mut-claro);
}
.shead {
  display: flex;
  align-items: baseline;
  gap: 16px;
  border-bottom: 1px solid var(--home-line);
  padding-bottom: 14px;
  margin-bottom: 36px;
  position: relative;
}
.shead::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 64px;
  border-bottom: 2px solid var(--home-acc);
}
section.lt .shead {
  border-color: var(--home-linea-clara);
}
h2 {
  font-size: 31px;
  letter-spacing: -0.025em;
  margin: 0;
  font-weight: 650;
  text-wrap: balance;
  color: var(--home-blanco);
}
section.lt h2 {
  color: var(--home-tinta-clara);
}
.shead .side {
  margin-left: auto;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10.5px;
  color: var(--home-tenue);
  text-align: right;
  letter-spacing: 0.05em;
}
.lede {
  color: var(--home-mut);
  font-size: 15px;
  max-width: 46em;
  margin: -16px 0 36px;
  text-wrap: pretty;
}

/* Las esquinas tipo HUD. */
.hud {
  position: relative;
}
.hud::before,
.hud::after {
  content: "";
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: none;
}
.hud::before {
  top: -1px;
  left: -1px;
  border-top: 2px solid var(--home-acc);
  border-left: 2px solid var(--home-acc);
}
.hud::after {
  bottom: -1px;
  right: -1px;
  border-bottom: 2px solid var(--home-acc);
  border-right: 2px solid var(--home-acc);
}

/* ---- la grilla de funciones ---- */
.grid3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  border: 1px solid var(--home-line);
  background: var(--home-line);
}
.cell {
  background: var(--home-panel);
  padding: 26px 24px;
  position: relative;
  transition: background 0.2s;
}
.cell:hover {
  background: var(--home-celda-hover);
}
.cell:hover .ic {
  border-color: var(--home-acc);
  box-shadow: 0 0 18px var(--home-acc-035);
}
.cell .ic {
  width: 38px;
  height: 38px;
  border: 1px solid var(--home-line2);
  background: linear-gradient(135deg, var(--home-ic-a), var(--home-ic-b));
  color: var(--home-acc2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 18px;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  transition: all 0.2s;
}
.cell h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 6px;
  letter-spacing: -0.01em;
  color: var(--home-blanco);
}
.cell p {
  font-size: 13px;
  color: var(--home-mut);
  margin: 0;
  text-wrap: pretty;
}

/* ---- la banda de cifras ---- */
.band {
  border-top: 1px solid var(--home-line);
  border-bottom: 1px solid var(--home-line);
  background: linear-gradient(180deg, var(--home-band-a), var(--home-negro));
}
.band .wrap {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
.stat {
  padding: 34px 26px;
  border-left: 1px solid var(--home-line);
  position: relative;
}
.stat:last-child {
  border-right: 1px solid var(--home-line);
}
.stat b {
  font-family: "Space Grotesk", sans-serif;
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.02em;
  display: block;
  font-variant-numeric: tabular-nums;
  color: var(--home-blanco);
}
.stat b em {
  font-style: normal;
  color: var(--home-ok);
  text-shadow: 0 0 22px var(--home-ok-05);
}
.stat span {
  font-size: 11.5px;
  color: var(--home-dim);
  font-family: "IBM Plex Mono", var(--fuente-mono);
  letter-spacing: 0.03em;
}
.stat .g {
  height: 3px;
  background: var(--home-line);
  margin-top: 12px;
  overflow: hidden;
}
.stat .g i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--home-acc), var(--home-ok));
}
/* Los anchos van en el sistema como `style="width:2%"`; aca son clases para no
 * escribir presentacion en el markup. */
.stat .g i.g2 {
  width: 2%;
}
.stat .g i.g14 {
  width: 14%;
}
.stat .g i.g100 {
  width: 100%;
}

/* ---- los cuatro pasos ---- */
.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  position: relative;
}
.steps::before {
  content: "";
  position: absolute;
  left: 2%;
  right: 2%;
  top: 18px;
  border-top: 1px dashed var(--home-guia);
}
.step {
  background: var(--home-blanco);
  border: 1px solid var(--home-linea-clara);
  padding: 0 18px 18px;
  position: relative;
}
.step .n {
  width: 36px;
  height: 36px;
  background: var(--home-bg2);
  color: var(--home-blanco);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 13px;
  margin: -1px 0 14px -1px;
  position: relative;
  z-index: 1;
}
.step .n::after {
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid var(--home-acc2-04);
}
.step h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 5px;
  color: var(--home-tinta-clara);
}
.step p {
  font-size: 12.5px;
  color: var(--home-mut-claro);
  margin: 0;
  text-wrap: pretty;
}
.step .f {
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10.5px;
  color: var(--home-acc);
  display: block;
  margin-top: 12px;
  border-top: 1px solid var(--home-linea-suave);
  padding-top: 9px;
}

/* ---- la regla de oro ---- */
.rule {
  border: 1px solid var(--home-warn);
  background: var(--home-rule-bg);
  margin-top: 30px;
  display: grid;
  grid-template-columns: auto 1fr;
  overflow: hidden;
  color: var(--home-tinta-clara);
}
.rule .flag {
  background: var(--home-warn);
  color: var(--home-bg2);
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  padding: 12px 5px;
  text-align: center;
  font-weight: 600;
}
.rule .rb {
  padding: 18px 22px;
}
.rule b.t {
  display: block;
  margin-bottom: 4px;
  font-size: 15.5px;
  font-family: "Space Grotesk", sans-serif;
}
.rule p {
  margin: 0;
  font-size: 13.5px;
  color: var(--texto-nota);
  max-width: 58em;
  text-wrap: pretty;
}
.tag {
  display: inline-flex;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border: 1px solid var(--home-warn);
  background: var(--home-tag-bg);
  color: var(--tag-warn-texto);
  font-family: "IBM Plex Mono", var(--fuente-mono);
}

/* ---- las dos consolas de privacidad ---- */
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.plist {
  background: var(--home-panel);
  border: 1px solid var(--home-line2);
  padding: 0;
}
.plist .ph {
  font-size: 11px;
  letter-spacing: 0.12em;
  padding: 11px 18px;
  font-weight: 600;
  font-family: "IBM Plex Mono", var(--fuente-mono);
  display: flex;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--home-line);
}
.plist.si .ph {
  color: var(--home-menta-clara);
  background: var(--home-ok-006);
}
.plist.no .ph {
  color: var(--home-bad);
  background: var(--home-bad-006);
}
.plist .ph i {
  width: 7px;
  height: 7px;
  font-style: normal;
}
.plist.si .ph i {
  background: var(--home-ok);
  box-shadow: 0 0 8px var(--home-ok-08);
}
.plist.no .ph i {
  background: var(--home-bad);
  box-shadow: 0 0 8px var(--home-bad-07);
}
.plist .pb {
  padding: 8px 18px 14px;
}
.plist .pb div {
  display: flex;
  gap: 12px;
  font-size: 13.5px;
  padding: 11px 0;
  border-top: 1px solid var(--home-linea-plist);
}
.plist .pb div:first-child {
  border-top: 0;
}
.plist span.m {
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-weight: 600;
  flex: none;
  line-height: 1.5;
  font-size: 12px;
}
.si span.m {
  color: var(--home-ok);
}
.no span.m {
  color: var(--home-bad);
}
.plist p {
  margin: 0;
  color: var(--home-lead);
  text-wrap: pretty;
}
.plist p b {
  color: var(--home-blanco);
}
.plist code {
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 12px;
  background: var(--home-bg);
  border: 1px solid var(--home-line2);
  padding: 0 5px;
  color: var(--home-menta);
}

/* ---- empezar ---- */
.inst {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.icard {
  background: var(--home-blanco);
  border: 1px solid var(--home-linea-clara);
  display: flex;
  flex-direction: column;
}
.icard .th {
  background: var(--home-bg);
  color: var(--home-texto-boton);
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 12px;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid var(--home-acc);
}
.icard .th em {
  font-style: normal;
  color: var(--home-dim);
  font-size: 10.5px;
}
.icard .tb {
  padding: 18px 20px;
  color: var(--home-tinta-clara);
}
.icard h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 6px;
  color: var(--home-tinta-clara);
}
.icard p {
  font-size: 13px;
  color: var(--home-mut-claro);
  margin: 0;
  text-wrap: pretty;
}
.icard .ok {
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 11px;
  color: var(--home-ok);
  margin-top: 14px;
  border-top: 1px dashed var(--home-linea-clara);
  padding-top: 10px;
}
.req {
  font-size: 12.5px;
  color: var(--home-mut-claro);
  margin-top: 24px;
  max-width: 56em;
  border-left: 2px solid var(--home-acc);
  padding-left: 14px;
}
.req b {
  color: var(--home-tinta-clara);
}

/* ---- preguntas ---- */
.faq {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  border: 1px solid var(--home-line);
  background: var(--home-line);
}
.qa {
  background: var(--home-panel);
  padding: 22px 24px;
  transition: background 0.2s;
}
.qa:hover {
  background: var(--home-celda-hover);
}
.qa h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 6px;
  display: flex;
  gap: 11px;
  color: var(--home-blanco);
}
.qa p {
  font-size: 13px;
  color: var(--home-mut);
  margin: 0;
  text-wrap: pretty;
}

/* ---- el cierre ---- */
.cta {
  background: var(--home-bg2);
  color: var(--home-blanco);
  text-align: center;
  padding: 96px 0;
  position: relative;
  overflow: hidden;
  border-top: 1px solid var(--home-line);
}
.cta::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(var(--home-rejilla) 1px, transparent 1px),
    linear-gradient(90deg, var(--home-rejilla) 1px, transparent 1px);
  background-size: 44px 44px;
  opacity: 0.45;
  mask-image: radial-gradient(620px 360px at 50% 50%, var(--home-mask) 25%, transparent 72%);
}
.ring {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border: 1px solid var(--home-acc-025);
  border-radius: 50%;
  pointer-events: none;
}
.r1 {
  width: 420px;
  height: 420px;
  animation: pulse 4s ease-out infinite;
}
.r2 {
  width: 680px;
  height: 680px;
  animation: pulse 4s 1s ease-out infinite;
}
.r3 {
  width: 960px;
  height: 960px;
  animation: pulse 4s 2s ease-out infinite;
}
@keyframes pulse {
  0% {
    opacity: 0.5;
  }
  70% {
    opacity: 0.08;
  }
  100% {
    opacity: 0.5;
  }
}
.cta .wrap {
  position: relative;
  z-index: 1;
}
.cta .kicker {
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--home-acc2);
  display: block;
  margin-bottom: 16px;
}
.cta h2 {
  color: var(--home-blanco);
  font-size: 40px;
  margin: 0 0 16px;
  letter-spacing: -0.03em;
}
.cta p {
  color: var(--home-lead);
  max-width: 36em;
  margin: 0 auto 32px;
  text-wrap: pretty;
}
.cta .ctas {
  justify-content: center;
}

/* ---- pie ---- */
footer {
  background: var(--home-negro);
  color: var(--home-dim);
  font-size: 12.5px;
  padding: 30px 0;
  border-top: 1px solid var(--home-line);
}
footer .wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
footer b {
  color: var(--home-texto-boton);
}
footer a {
  color: var(--home-mut);
}
footer .m {
  font-family: "IBM Plex Mono", var(--fuente-mono);
  font-size: 10.5px;
  margin-left: auto;
  color: var(--home-gris-mono);
}

@media (max-width: 920px) {
  .hero > .wrap,
  .grid3,
  .steps,
  .two,
  .inst,
  .faq,
  .pipe .grid,
  .band .wrap {
    grid-template-columns: 1fr;
  }
  h1 {
    font-size: 38px;
  }
  .steps::before {
    display: none;
  }
  .coords {
    display: none;
  }
}
</style>
