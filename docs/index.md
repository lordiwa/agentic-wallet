---
title: Inicio
permalink: /
description: >-
  Agentic Wallet es tu copiloto financiero local-first: lee los correos que tu
  banco ya te manda, arma tu historial de gastos en tu propia computadora, y te
  deja preguntarle cosas en lenguaje natural. Sin nube, sin cuenta, sin que tus
  datos salgan de tu máquina.
---

<section class="hero">
  <div class="wrap hero-inner">
    <div>
      <p class="pill"><span class="dot"></span> Todo corre en tu computadora</p>

      <h1>Tu plata, <span class="hl">en tus propias manos</span>.</h1>

      <p class="tagline">Agentic Wallet lee los correos que <strong>tu banco ya te manda</strong>, arma tu historial de gastos <strong>en tu computadora</strong>, y te deja preguntarle lo que quieras en lenguaje natural.</p>

      <p class="hero-note">No hay servidor en la nube. No hay cuenta que crear. No se conecta a tu banco. Nadie más ve tus movimientos — ni siquiera nosotros, porque no hay un "nosotros" del otro lado.</p>

      <p class="cta-row">
        <a class="btn btn-primary" href="#instalacion">Cómo empezar</a>
        <a class="btn btn-ghost" href="{{ site.repo_url }}">Ver el código</a>
      </p>
    </div>

    <div class="hero-card">
      <div class="hero-card-bar">
        <span class="tl"></span><span class="tl"></span><span class="tl"></span>
        <span class="where">localhost:3000</span>
      </div>
      <div class="hero-card-body">
        <p class="bubble you">¿Cuánto gasté en comida este mes?</p>
        <p class="bubble wallet">Llevás <span class="num">18 consumos</span> en comida este mes. La mayoría son de supermercado; el resto, delivery.</p>
        <p class="bubble you">¿Me alcanza para la cuota de la moto?</p>
        <p class="bubble wallet">Sí. Después de reservar tu colchón te queda margen, y tu próximo sueldo entra en <span class="num">6 días</span>.</p>
      </div>
      <p class="hero-card-foot">Ejemplo ilustrativo con datos de demostración. <a href="#pantallas">Las capturas reales del tablero están más abajo.</a></p>
    </div>
  </div>
</section>

<section id="que-es">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Qué es</p>
      <h2>Un copiloto financiero que vive en tu computadora</h2>
      <p>Tu banco ya te avisa por correo cada vez que pagás algo, transferís o te entra el sueldo. Esa información es tuya y está ahí, desordenada, entre miles de mails. Agentic Wallet la ordena — y la deja donde debe estar: <strong>en tu máquina</strong>.</p>
    </div>

    <div class="grid grid-3">
      <div class="card">
        <div class="ico" aria-hidden="true">📥</div>
        <h3>Ordena lo que ya tenés</h3>
        <p>Convierte los correos de tu banco en un historial claro: consumos, transferencias, retiros, sueldos y reversos, cada uno con su fecha, su monto y dónde fue.</p>
      </div>
      <div class="card">
        <div class="ico" aria-hidden="true">🏷️</div>
        <h3>Categoriza a tu manera</h3>
        <p>Nada viene precargado. Vos decidís qué es "comida", qué es "salud" y qué es "suscripción" — es tu clasificación, no la de un algoritmo que no te conoce.</p>
      </div>
      <div class="card">
        <div class="ico" aria-hidden="true">📊</div>
        <h3>Te da la foto completa</h3>
        <p>Saldo, gasto por categoría, cuántos días faltan para tu próximo sueldo, tus deudas y el colchón que querés mantener. Todo en un tablero en tu navegador.</p>
      </div>
      <div class="card">
        <div class="ico" aria-hidden="true">💬</div>
        <h3>Le preguntás como a una persona</h3>
        <p>"¿Cuánto gasté en delivery?", "¿me alcanza para esto?", "¿qué pagué la semana pasada?". Un chat que responde <em>sobre tu historial real</em>, no en general.</p>
      </div>
      <div class="card">
        <div class="ico" aria-hidden="true">🤖</div>
        <h3>Tu asistente de IA lo puede usar</h3>
        <p>El wallet también se expone como herramientas para asistentes que hablan MCP, así que tu agente puede consultar tu saldo o sincronizar por vos — siempre contra la misma base local.</p>
      </div>
      <div class="card">
        <div class="ico" aria-hidden="true">🔒</div>
        <h3>Sin cuenta, sin suscripción al servicio</h3>
        <p>No hay registro, no hay plan mensual, no hay base de datos de usuarios. Es un programa que corrés vos, con tus datos, en tu equipo.</p>
      </div>
    </div>
  </div>
</section>

<section id="pantallas">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Cómo se ve</p>
      <h2>El tablero, tal cual sale</h2>
      <p>Estas son capturas <strong>reales</strong> del tablero corriendo en una máquina, contra una base de datos de demostración. Sin retoques y sin maquillaje: hoy el proyecto pone el esfuerzo en que cada número sea correcto y verificable antes que en la presentación.</p>
    </div>

    <p class="shots-note"><strong>Todo lo que ves acá es inventado.</strong> La titular, los comercios y los montos son ficticios y no corresponden a ninguna persona real — el repositorio no incluye datos de nadie.</p>

    <div class="shots">
      <figure class="shot">
        <a href="{{ '/assets/img/dashboard-resumen.png' | relative_url }}">
          <img src="{{ '/assets/img/dashboard-resumen.png' | relative_url }}" width="620" height="1185" loading="lazy" decoding="async" alt="Tablero con las tarjetas de saldo, tarjeta de crédito, safe to spend, colchón, transferencias del mes y próximo pago, con datos de demostración.">
        </a>
        <figcaption>Saldo, estado de la tarjeta, cuánto podés gastar hoy, el colchón, las transferencias del mes y cuándo entra el próximo sueldo.</figcaption>
      </figure>

      <figure class="shot">
        <a href="{{ '/assets/img/dashboard-gasto.png' | relative_url }}">
          <img src="{{ '/assets/img/dashboard-gasto.png' | relative_url }}" width="420" height="521" loading="lazy" decoding="async" alt="Gráfico de barras de gasto por categoría del mes y línea de gasto diario contra el promedio, con datos de demostración.">
        </a>
        <figcaption>Gasto por categoría del mes — con <em>tus</em> categorías, las que definiste vos — y el gasto diario contra tu propio promedio.</figcaption>
      </figure>

      <figure class="shot wide">
        <a href="{{ '/assets/img/dashboard-transacciones.png' | relative_url }}">
          <img src="{{ '/assets/img/dashboard-transacciones.png' | relative_url }}" width="912" height="620" loading="lazy" decoding="async" alt="Bandeja de movimientos que necesitan revisión y tabla de transacciones con filtros por fecha, tipo, dirección y contraparte, con datos de demostración.">
        </a>
        <figcaption>Arriba, la bandeja de los movimientos que <strong>no</strong> entran en ningún total hasta que los mires. Abajo, la tabla completa con filtros por fecha, tipo, dirección y comercio.</figcaption>
      </figure>

      <figure class="shot wide">
        <a href="{{ '/assets/img/dashboard-chat.png' | relative_url }}">
          <img src="{{ '/assets/img/dashboard-chat.png' | relative_url }}" width="912" height="466" loading="lazy" decoding="async" alt="Chat del wallet respondiendo cuánto se gastó en comida en el mes y si alcanza para una cuota, con datos de demostración.">
        </a>
        <figcaption>El chat contesta sobre tu propio historial: cuánto va en comida, si te alcanza para algo, cuánto falta para el colchón. Y te dice cuántos movimientos dejó fuera por estar en revisión.</figcaption>
      </figure>
    </div>
  </div>
</section>

<section id="como-funciona" class="tinted">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Cómo funciona</p>
      <h2>Cuatro pasos, y ninguno sale de tu equipo</h2>
      <p>No hace falta que entiendas la parte técnica para usarlo, pero sí conviene que sepas por dónde pasa tu información. Es corto:</p>
    </div>

    <div class="flow">
      <div class="step">
        <div class="n">1</div>
        <h3>Lee tu Gmail</h3>
        <p>Solo los correos de tu banco, y solo para leerlos. El permiso que le das a Google es de <strong>lectura</strong>: no puede enviar, cambiar ni borrar nada.</p>
      </div>
      <div class="step">
        <div class="n">2</div>
        <h3>Entiende el correo</h3>
        <p>Un lector automático saca el monto, la fecha y el comercio del texto del mail. Siempre las mismas reglas, siempre el mismo resultado.</p>
      </div>
      <div class="step">
        <div class="n">3</div>
        <h3>Guarda en tu máquina</h3>
        <p>Cada movimiento queda en un archivo de base de datos en tu carpeta. Ese archivo es tuyo: lo copiás, lo respaldás o lo borrás cuando quieras.</p>
      </div>
      <div class="step">
        <div class="n">4</div>
        <h3>Lo consultás</h3>
        <p>Abrís el tablero en tu navegador o le preguntás por chat. También puede reconocer reversos, duplicados y transferencias entre tus propias cuentas.</p>
      </div>
    </div>

    <div class="note">
      <h3>La regla de oro: la IA nunca inventa un monto</h3>
      <p>Los números <strong>siempre</strong> salen del lector automático, que hace lo mismo cada vez. La inteligencia artificial se usa solo como <strong>segunda opinión</strong>: lee el mismo correo y dice qué monto ve.</p>
      <p>Si las dos lecturas no coinciden, ese movimiento se marca <strong>"para revisar"</strong> y queda <strong>fuera de todos los totales</strong> hasta que vos lo mires. Preferimos decirte "esto no lo tengo claro" antes que darte una cifra inventada — un copiloto financiero que alucina un número es peor que no tener nada.</p>
    </div>
  </div>
</section>

<section id="privacidad">
  <div class="wrap">
    <div class="privacy-split">
      <div>
        <div class="section-head">
          <p class="eyebrow">Privacidad</p>
          <h2>Lo que sale de tu computadora, y lo que no</h2>
          <p>Preferimos ser explícitos antes que decir "tu privacidad nos importa" y dejarlo ahí.</p>
        </div>

        <ul class="checks">
          <li><span class="mark">✓</span><span><strong>Tu historial vive en un archivo tuyo.</strong> Una base de datos local, en tu carpeta. No se sube a ningún lado ni se sincroniza con nadie.</span></li>
          <li><span class="mark">✓</span><span><strong>Gmail, solo lectura.</strong> El permiso es exclusivamente de lectura, y las búsquedas se filtran por los remitentes de tu banco: el resto de tu bandeja no se toca.</span></li>
          <li><span class="mark">✓</span><span><strong>Lo revocás cuando quieras.</strong> Desde tu cuenta de Google, en dos clics, sin pedirle permiso a nadie.</span></li>
          <li><span class="mark">✓</span><span><strong>Lo único que viaja</strong> es el texto del correo bancario que se manda a la IA para la segunda opinión — y va <strong>enmascarado</strong>: los números de cuenta se reemplazan por <code>XXXXXX1234</code> antes de salir.</span></li>
          <li><span class="mark no">✕</span><span><strong>No hay cuenta ni registro.</strong> Nadie tiene una lista de usuarios porque no hay servicio del otro lado.</span></li>
          <li><span class="mark no">✕</span><span><strong>No se conecta a tu banco.</strong> Nunca te pide tu clave del banco. No podría entrar aunque quisiera: solo lee correos.</span></li>
          <li><span class="mark no">✕</span><span><strong>No hay publicidad ni venta de datos.</strong> No hay modelo de negocio: es un proyecto de uso personal, con el código abierto para que lo revises.</span></li>
        </ul>
      </div>

      <div class="card">
        <h3>Una advertencia honesta</h3>
        <p>El tablero no tiene contraseña, porque está pensado para escuchar <strong>solo en tu propia computadora</strong> (<code>127.0.0.1</code>), donde nadie más llega.</p>
        <p>Si alguien lo instala en un servidor con dirección pública y lo abre a internet, estaría publicando su historial bancario. La instalación normal en tu equipo no corre ese riesgo — pero preferimos decírtelo antes que escondértelo.</p>
        <p>El archivo de configuración y tu base de datos están excluidos del repositorio: una actualización nunca toca tus datos ni tus credenciales.</p>
      </div>
    </div>
  </div>
</section>

<section id="instalacion" class="tinted">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Instalación</p>
      <h2>Tres dobles clics, en orden</h2>
      <p>No hay que escribir comandos ni saber programar. Descargás una carpeta y hacés doble clic en tres archivos, uno después del otro. Se hace <strong>una sola vez</strong>, y de ahí en más usás solo el tercero.</p>
    </div>

    <table class="req-table">
      <thead>
        <tr><th>Necesitás</th><th>Para qué</th></tr>
      </thead>
      <tbody>
        <tr><td>Una computadora con Windows 10 u 11</td><td>Por ahora la instalación de doble clic es solo para Windows.</td></tr>
        <tr><td>Internet</td><td>Para descargar el wallet y para que después lea tus correos.</td></tr>
        <tr><td>Tu cuenta de Gmail</td><td>Es donde llegan los avisos de tu banco.</td></tr>
        <tr><td>Un banco que te avise por correo</td><td>Tiene que mandarte un mail por cada movimiento. Si solo te avisa dentro de su app, no hay de dónde sacar los datos.</td></tr>
        <tr><td>Una cuenta de Claude (Pro o Max)</td><td>Es la que revisa los correos y contesta tus preguntas. Con la suscripción que ya pagás alcanza: no se paga nada aparte.</td></tr>
      </tbody>
    </table>

    <div class="install-steps">
      <div class="install-step">
        <div>
          <h3>Descargás la carpeta y hacés doble clic en <code>setup.bat</code></h3>
          <p><a href="{{ site.repo_url }}/archive/refs/heads/main.zip">Descargá el wallet acá</a>. Te baja un archivo ZIP. Hacele <strong>clic derecho → Extraer todo</strong> y guardalo en <strong>Documentos</strong>. Importante: no abras los archivos desde adentro del ZIP, hay que extraerlo primero.</p>
          <p>Entrá a la carpeta que quedó y hacé <strong>doble clic en <code>setup.bat</code></strong>. Se abre una ventana negra con letras: <strong>eso es normal, no es un error</strong>. Va contando sola en qué paso va, y tarda entre 5 y 20 minutos según tu internet. Podés dejarla trabajando y hacer otra cosa.</p>
          <p>Mientras tanto Windows te puede preguntar un par de cosas. Si aparece una ventana azul preguntando si permitís cambios, decile que <strong>sí</strong>. Si dice <em>"Windows protegió tu PC"</em>, tocá <strong>Más información</strong> y después <strong>Ejecutar de todos modos</strong>: sale porque el archivo lo bajaste de internet, no porque tenga algo malo.</p>
          <p class="ok"><strong>Si salió bien:</strong> la ventana termina diciendo <em>"La instalación terminó bien"</em>. Si dice otra cosa, cerrá la ventana y hacé doble clic en <code>setup.bat</code> de nuevo — no rompe nada y retoma donde había quedado.</p>
        </div>
      </div>

      <div class="install-step">
        <div>
          <h3>Doble clic en <code>configurar.bat</code> y contestás lo que te pregunta</h3>
          <p>Acá el wallet aprende de vos. Se abre un asistente y, cuando aparezca, le escribís (o copiás y pegás) esto:</p>
<pre class="cmd">Ayudame a terminar de configurar mi wallet.
Segui docs/onboarding.md paso a paso.</pre>
          <p>De ahí en adelante él pregunta y vos contestás. Te va a pedir conectar tu cuenta de Claude, darle permiso de <strong>solo lectura</strong> a tu Gmail, tu nombre, cada cuánto cobrás, y a qué categoría va cada comercio donde gastás ("¿el supermercado es comida?"). Esas últimas son las importantes: es <em>tu</em> clasificación, no hay respuestas correctas ni incorrectas.</p>
          <p>El permiso de Gmail es el tramo más largo (unos 10 minutos) porque hay que pasar por la página de Google. Está explicado pantalla por pantalla, con qué botón tocar en cada una: <a href="{{ '/oauth-para-humanos.html' | relative_url }}">ver la guía del permiso de Gmail →</a></p>
          <p>Son unos 30 a 40 minutos en total. <strong>Podés cortar cuando quieras y seguir otro día</strong>: volvés a hacer doble clic en <code>configurar.bat</code> y el asistente retoma donde quedó.</p>
          <p class="ok"><strong>Si salió bien:</strong> el asistente te dice que ya está todo configurado y que abras el wallet. Además ya trajo tus movimientos viejos, así que tu historial arranca lleno, no vacío.</p>
        </div>
      </div>

      <div class="install-step">
        <div>
          <h3>Doble clic en <code>iniciar.bat</code> — y ya está</h3>
          <p>A los pocos segundos <strong>se abre solo tu navegador</strong> con el tablero. Si no se abriera, entrá vos a <strong>http://localhost:3000</strong>.</p>
          <p>Dejá la ventana negra abierta mientras lo usás — es el wallet funcionando. Para cerrarlo, cerrá esa ventana.</p>
          <p>Para traer los movimientos nuevos de tu banco, tocá el botón <strong>Sincronizar</strong> del tablero. No lo hace solo: lo pedís vos cuando querés.</p>
          <p class="ok"><strong>Si salió bien:</strong> ves tu saldo, tus gastos por categoría y el chat. De acá en más este es <strong>el único archivo que vas a usar</strong>: doble clic en <code>iniciar.bat</code> cada vez que quieras mirar tu plata.</p>
        </div>
      </div>
    </div>

    <p class="install-foot">¿Querés el detalle de cada pantalla, con la tabla de "si ves esto, hacé esto otro"? Está en <a href="{{ '/instalar-en-windows.html' | relative_url }}">Instalar el wallet en Windows</a>.</p>
    <p class="install-foot">Si sos una persona técnica o estás en Mac o Linux, la instalación por línea de comandos está en el <a href="{{ site.repo_url }}#readme">README del repositorio</a>.</p>
  </div>
</section>

<section id="guias">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Guías</p>
      <h2>Para leer antes de empezar</h2>
      <p>Las dos primeras son las que te conviene leer si vas a ser la persona que usa el wallet. Las otras son para quien te ayude con la parte técnica.</p>
    </div>

    <div class="grid grid-2">
      <a class="card" href="{{ '/instalar-en-windows.html' | relative_url }}">
        <h3>Instalar el wallet en Windows</h3>
        <p>Los tres dobles clics con todo el detalle: qué ves en cada pantalla, qué te puede preguntar Windows y una tabla de "si aparece esto, hacé esto otro". <strong>Si vas a instalarlo vos, es esta.</strong></p>
        <span class="more">Ver los tres pasos →</span>
      </a>

      <a class="card" href="{{ '/onboarding-para-humanos.html' | relative_url }}">
        <h3>Configurar tu wallet — guía para humanos</h3>
        <p>Qué va a pasar, qué necesitás tener a mano y qué te van a preguntar, sin un solo tecnicismo. <strong>Si es tu primera vez, empezá por acá.</strong></p>
        <span class="more">Leer la guía →</span>
      </a>

      <a class="card" href="{{ '/oauth-para-humanos.html' | relative_url }}">
        <h3>Darle permiso a tu Gmail — para no técnicos</h3>
        <p>El único tramo que no se puede automatizar, explicado pantalla por pantalla: qué botón tocar, qué escribir en cada campo y cómo saber en cada paso que lo hiciste bien. Sin jerga.</p>
        <span class="more">Ver los 46 pasos →</span>
      </a>

      <a class="card" href="{{ '/conectar-gmail.html' | relative_url }}">
        <h3>Conectar Gmail (solo lectura)</h3>
        <p>La misma conexión, en versión corta y técnica: qué ve exactamente el wallet, por qué el cliente es de tipo escritorio y cómo revocarlo cuando quieras.</p>
        <span class="more">Ver el resumen →</span>
      </a>

      <a class="card" href="{{ '/multibanco.html' | relative_url }}">
        <h3>Que entienda tu banco</h3>
        <p>El proyecto trae de ejemplo el lector de un banco de Ecuador (Produbanco). Si el tuyo es otro, acá está cómo se agrega — es trabajo técnico, pero acotado.</p>
        <span class="more">Documento técnico →</span>
      </a>

      <a class="card" href="{{ '/mcp.html' | relative_url }}">
        <h3>Usarlo desde tu asistente de IA</h3>
        <p>Cómo el wallet se convierte en herramientas para un agente que hable MCP: consultar saldo, movimientos, gasto por categoría y sincronizar.</p>
        <span class="more">Documento técnico →</span>
      </a>
    </div>
  </div>
</section>

<section id="faq" class="tinted">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Preguntas</p>
      <h2>Todo lo que te vas a preguntar</h2>
      <p>Están agrupadas por el momento en que suelen aparecer. La idea es que puedas instalarlo y usarlo sin tener que preguntarle a nadie.</p>
    </div>

    <div class="faq">
      <p class="faq-group">Antes de empezar</p>

      <details open>
        <summary>¿Necesito saber programar?</summary>
        <div class="answer">
          <p><strong>No.</strong> Son tres dobles clics: <code>setup.bat</code>, <code>configurar.bat</code> e <code>iniciar.bat</code>. No hay que escribir ni un comando ni entender nada de lo que aparece en la ventana negra.</p>
          <p>Lo único que hacés vos es <em>contestar preguntas</em> en el paso 2 — tu nombre, cada cuánto cobrás, a qué categoría va cada comercio — y darle el permiso a tu Gmail siguiendo <a href="{{ '/oauth-para-humanos.html' | relative_url }}">una guía con capturas de cada pantalla</a>.</p>
        </div>
      </details>

      <details>
        <summary>¿Cuánto cuesta? ¿Es gratis?</summary>
        <div class="answer">
          <p>El wallet es <strong>gratis</strong> y de código abierto. No hay suscripción, no hay versión "pro", no hay nada que pagar por usarlo.</p>
          <p>Lo único que necesitás es <strong>una cuenta de Claude</strong>, que es la que lee los correos y contesta tus preguntas. Si ya tenés Claude <strong>Pro o Max</strong>, con eso alcanza: el wallet usa esa misma suscripción y <strong>no se te cobra nada aparte</strong>, ni por movimiento ni por pregunta.</p>
          <p>(Existe otra forma de conectarlo, con una clave de programador de Anthropic, que sí se cobra por uso. No hace falta y no es la recomendada — con tu suscripción normal estás.)</p>
        </div>
      </details>

      <details>
        <summary>¿Cuánto tarda instalarlo?</summary>
        <div class="answer">
          <p>Contá una tarde tranquila: entre <strong>40 y 60 minutos</strong> en total, y buena parte es esperar mirando una barra de progreso.</p>
          <p>El paso 1 (<code>setup.bat</code>) tarda 5 a 20 minutos y no requiere que hagas nada. El paso 2 (<code>configurar.bat</code>) son 30 a 40 minutos de preguntas y respuestas. <strong>Podés cortar el paso 2 y seguir otro día</strong>: retoma exactamente donde quedaste.</p>
          <p>Se hace una sola vez. Después abrirlo son 10 segundos.</p>
        </div>
      </details>

      <details>
        <summary>¿Funciona en Mac? ¿En Linux? ¿En el celular?</summary>
        <div class="answer">
          <p><strong>Por ahora, solo Windows 10 y 11.</strong> Los tres archivos de doble clic están hechos para Windows; en Mac o Linux no se abren.</p>
          <p>En Mac y Linux <em>el wallet en sí funciona</em>, pero hay que instalarlo escribiendo comandos, así que hoy es un camino para alguien técnico. Hacer el instalador fácil para esos sistemas queda para más adelante.</p>
          <p>En el celular no se instala. Sí podés <em>mirarlo</em> desde el celular si estás en la misma red de tu casa, pero eso ya es una configuración manual.</p>
        </div>
      </details>

      <details>
        <summary>¿Funciona con mi banco?</summary>
        <div class="answer">
          <p>Depende de dos cosas. Primero: tu banco tiene que <strong>mandarte un correo por cada movimiento</strong>. Si solo te avisa dentro de su app, no hay de dónde sacar los datos y esto no puede funcionar.</p>
          <p>Segundo: cada banco escribe sus correos distinto, así que hay que enseñarle a leer los del tuyo. Hoy está probado con <strong>Produbanco (Ecuador)</strong>. Si tu banco es otro, no es que "no funcione": es que <strong>todavía no está hecho</strong>. Es un trabajo acotado que puede hacer alguien técnico o un asistente de IA — <a href="{{ '/multibanco.html' | relative_url }}">acá está cómo</a>.</p>
          <p>Si no sabés si tu banco te manda correos, buscá en tu Gmail el nombre de tu banco. Si aparecen avisos de "consumo", "transferencia" o "retiro", vas bien.</p>
        </div>
      </details>

      <details>
        <summary>¿Necesito tener la computadora prendida todo el día?</summary>
        <div class="answer">
          <p>No. El wallet solo corre cuando vos lo abrís con <code>iniciar.bat</code>. Mientras tanto tus correos se siguen acumulando tranquilos en tu Gmail, y cuando lo abras y toques <strong>Sincronizar</strong>, se pone al día con todo lo que pasó.</p>
        </div>
      </details>

      <p class="faq-group">Privacidad y seguridad</p>

      <details>
        <summary>¿Es seguro? ¿Alguien más ve mis datos?</summary>
        <div class="answer">
          <p>Nadie más los ve, y no es una promesa: es que <strong>no hay a dónde mandarlos</strong>. No existe un servidor del otro lado, no existe una cuenta que crear, no existe una base de datos con usuarios. Tu historial es un archivo (<code>wallet.sqlite</code>) dentro de la carpeta del wallet, en tu computadora, igual que un documento de Word.</p>
          <p>Ni siquiera quien hizo el programa puede ver tus movimientos: no tiene por dónde. El código está abierto para que cualquiera que sepa lo verifique.</p>
        </div>
      </details>

      <details>
        <summary>¿Se conecta a mi banco? ¿Le tengo que dar mi clave?</summary>
        <div class="answer">
          <p><strong>No, y no.</strong> El wallet nunca se conecta a tu banco y nunca te pide tu clave. Si alguna vez algo te pide la clave del banco, no es esto: cerrá todo y preguntá.</p>
          <p>Lo único que hace es leer los correos de aviso que el banco ya te manda a tu Gmail. Si mañana borrás el programa, tu banco ni se entera de que existió.</p>
        </div>
      </details>

      <details>
        <summary>¿Puede mover mi plata, pagar algo o mandar correos?</summary>
        <div class="answer">
          <p>No puede hacer <strong>nada</strong> de eso. El permiso que le das a tu Gmail es de <strong>solo lectura</strong>: no puede enviar, responder, borrar ni modificar un correo. Y como no tiene ninguna conexión con tu banco, no puede transferir ni pagar nada.</p>
          <p>Es un programa que <em>mira</em> y <em>ordena</em>. Nada más.</p>
        </div>
      </details>

      <details>
        <summary>¿Mis correos se suben a la nube de Claude?</summary>
        <div class="answer">
          <p>Tu bandeja de entrada no se sube a ningún lado. Tu historial de gastos tampoco.</p>
          <p>Lo que sí sale de tu computadora es el <strong>texto de cada correo bancario</strong>, que se le manda a Claude para que dé su segunda opinión sobre el monto. Y sale <strong>enmascarado</strong>: los números de cuenta se reemplazan por algo como <code>XXXXXX1234</code> <em>antes</em> de salir.</p>
          <p>Los correos que no son de tu banco nunca se tocan. La búsqueda en tu Gmail está filtrada por los remitentes de tu banco: el resto de tu bandeja el wallet ni la mira.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué pasa si me hackean o me roban la computadora?</summary>
        <div class="answer">
          <p>Pasaría lo mismo que con cualquier archivo tuyo: quien tenga tu computadora desbloqueada podría abrir tu historial de gastos, igual que podría abrir tus fotos o tus documentos. Por eso la mejor protección es la de siempre: <strong>contraseña en tu usuario de Windows</strong>.</p>
          <p>Lo importante es lo que <em>no</em> pasaría: nadie puede sacarte plata, porque el wallet no tiene acceso a tu banco. Y nadie puede leer tus datos "desde afuera", porque el tablero solo escucha dentro de tu propia computadora — desde otra máquina no se llega.</p>
          <p>Si te preocupa, podés quitarle el permiso a tu Gmail en dos clics desde tu cuenta de Google, cuando quieras, sin pedirle permiso a nadie.</p>
        </div>
      </details>

      <details>
        <summary>¿Puedo borrar todo?</summary>
        <div class="answer">
          <p>Sí, y es tan simple como <strong>borrar la carpeta</strong>. Listo. No queda una copia en ningún servidor porque nunca hubo servidor.</p>
          <p>Aparte, si querés cortar el acceso a tu correo: entrá a tu cuenta de Google, buscá las aplicaciones con acceso y quitale el permiso al wallet. Son dos clics.</p>
        </div>
      </details>

      <p class="faq-group">Usarlo todos los días</p>

      <details>
        <summary>¿Cómo le hago una pregunta al wallet?</summary>
        <div class="answer">
          <p>En el tablero hay un chat. Escribís como le hablarías a una persona y te contesta <strong>sobre tu historial real</strong>, no en general. Por ejemplo:</p>
          <p>"¿Cuánto gasté en comida este mes?" · "¿Qué pagué la semana pasada?" · "¿Me alcanza para la cuota de la moto?" · "¿En qué se me está yendo más plata que el mes pasado?" · "¿Cuánto falta para que cobre?" · "Mostrame todo lo que gasté en el supermercado".</p>
          <p>No hay que aprenderse ninguna fórmula ni escribir de una manera especial. Si no entiende algo, preguntale de nuevo con otras palabras.</p>
        </div>
      </details>

      <details>
        <summary>¿Trae los movimientos nuevos solo?</summary>
        <div class="answer">
          <p>No: lo pedís vos. Abrís el wallet y tocás el botón <strong>Sincronizar</strong>. Ahí va a tu Gmail, busca los avisos del banco que todavía no había leído y los agrega.</p>
          <p>Si hacía mucho que no lo abrías y hay muchos correos, puede decirte que quedan algunos pendientes: tocá <strong>Sincronizar</strong> otra vez hasta que termine. No repite ni duplica nada — lo que ya leyó, ya está.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué son los movimientos "en revisión"?</summary>
        <div class="answer">
          <p>Son los movimientos que el wallet <strong>no está 100% seguro de haber leído bien</strong>, y por eso prefiere avisarte antes que darte un número inventado.</p>
          <p>Cada correo lo leen dos: un lector automático (que siempre hace lo mismo) y la IA como segunda opinión. Si los dos coinciden en el monto, entra. Si no coinciden, el movimiento va a la bandeja <strong>"Necesitan revisión"</strong> y <strong>queda fuera de todos los totales</strong> hasta que vos lo mires. Por eso a veces el chat te dice "dejé fuera 3 movimientos que están en revisión": está siendo honesto con vos.</p>
          <p>Para resolverlos, abrí el asistente (<code>configurar.bat</code>) y pedile: <em>"mostrame los movimientos en revisión y ayudame a resolverlos"</em>. Te los va mostrando de a uno y vos decís si el monto está bien (se confirma y entra a los totales) o si hay que descartarlo. Podés dejarlos ahí todo el tiempo que quieras: no molestan, solo no suman.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué pasa si cierro la ventana o se corta la luz?</summary>
        <div class="answer">
          <p>No se pierde nada. Todo lo que el wallet ya leyó quedó <strong>guardado en tu computadora</strong> en el momento, no en la memoria. Volvés a hacer doble clic en <code>iniciar.bat</code> y está todo como lo dejaste.</p>
          <p>Si se corta en la mitad de una sincronización, tampoco pasa nada: la próxima vez retoma desde donde había llegado y sigue. Y si se corta en la mitad de la configuración, <code>configurar.bat</code> retoma en la pregunta donde quedaste.</p>
        </div>
      </details>

      <details>
        <summary>¿Puedo usarlo sin internet?</summary>
        <div class="answer">
          <p>Casi todo, sí. Tu tablero, tu saldo, tus gastos por categoría, tus movimientos, los filtros: todo eso vive en tu computadora y funciona <strong>sin internet</strong>.</p>
          <p>Dos cosas sí lo necesitan: <strong>Sincronizar</strong> (porque tiene que ir a buscar los correos a tu Gmail) y el <strong>chat</strong> (porque la respuesta la arma Claude). Sin conexión, esas dos te van a dar error; el resto anda igual.</p>
        </div>
      </details>

      <details>
        <summary>¿Puedo tenerlo en dos computadoras?</summary>
        <div class="answer">
          <p>Sí, pero cada una es independiente: <strong>los datos viven en cada computadora, no en la nube</strong>, así que no se sincronizan entre sí. Si cargás algo en una, la otra no se entera.</p>
          <p>Tenés dos formas. Instalarlo de cero en la segunda (los tres dobles clics otra vez) y que arme su propio historial desde tu Gmail — funciona, pero volvés a contestar todas las preguntas. O copiar la carpeta entera en un pendrive y, en la máquina nueva, hacer doble clic en <code>setup.bat</code> una sola vez: así se lleva tu configuración y tu historial tal cual, y <code>setup.bat</code> solo acomoda las piezas de esa computadora sin tocarte los datos.</p>
        </div>
      </details>

      <details>
        <summary>¿Cómo hago una copia de respaldo?</summary>
        <div class="answer">
          <p>Copiá la carpeta del wallet a un pendrive o a un disco externo. Ahí adentro está todo: tu historial (<code>wallet.sqlite</code>) y tu configuración.</p>
          <p>Pensalo como un documento: si lo perdés, no hay nadie que tenga otra copia. La contracara de que nadie más vea tus datos es que <strong>el respaldo lo hacés vos</strong>.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué pasa cuando salgan mejoras? ¿Tengo que actualizar?</summary>
        <div class="answer">
          <p>No estás obligado a nada: el que tenés instalado va a seguir funcionando igual.</p>
          <p>Cuando quieras la versión nueva, lo más fácil es abrir <code>configurar.bat</code> y pedirle al asistente: <em>"actualizá el wallet a la última versión sin tocar mis datos"</em>. Él se encarga.</p>
          <p><strong>Tu historial y tu configuración están guardados en archivos aparte, a propósito</strong>, justamente para que una actualización no te borre nada. No hay que volver a contestar las preguntas.</p>
        </div>
      </details>

      <p class="faq-group">Si algo no sale bien</p>

      <details>
        <summary>¿Qué hago si algo no funciona?</summary>
        <div class="answer">
          <p>Tres cosas, en este orden:</p>
          <p><strong>1. Volvé a intentar el mismo paso.</strong> Los tres archivos están hechos para poder ejecutarse las veces que quieras: no rompen nada y retoman donde quedaron. La mitad de los problemas se arreglan cerrando la ventana y haciendo doble clic de nuevo.</p>
          <p><strong>2. Buscá el mensaje en la tabla de problemas.</strong> En <a href="{{ '/instalar-en-windows.html' | relative_url }}">Instalar el wallet en Windows</a> hay una tabla de "si ves esto, hacé esto otro" con los casos más comunes.</p>
          <p><strong>3. Pedí ayuda, pero con el mensaje exacto.</strong> Sacale una foto o una captura a la ventana, o copiá el texto tal cual aparece. "No me anda" no se puede arreglar; el mensaje exacto casi siempre sí. Cuando el instalador falla también te dice la ruta de un archivo de registro: mandá ese archivo, no tiene datos tuyos, solo mensajes del instalador.</p>
        </div>
      </details>

      <details>
        <summary>Se abrió una ventana negra llena de letras. ¿Rompí algo?</summary>
        <div class="answer">
          <p>No. Esa ventana <strong>es</strong> el programa trabajando — así se ve por dentro. Va escribiendo lo que va haciendo. No hace falta que entiendas nada de lo que dice; solo mirá el final, que te avisa si terminó bien o no.</p>
          <p>Mientras usás el wallet, esa ventana tiene que quedar abierta. Si la cerrás, el wallet se apaga (y no pasa nada: lo volvés a abrir con <code>iniciar.bat</code>).</p>
        </div>
      </details>

      <details>
        <summary>Windows me dice que "protegió mi PC" o que el archivo es peligroso</summary>
        <div class="answer">
          <p>Es un aviso automático que Windows le pone a <strong>todo</strong> archivo bajado de internet, no un antivirus que encontró algo. Tocá <strong>Más información</strong> y después <strong>Ejecutar de todos modos</strong>.</p>
          <p>Si en cambio la ventana se cierra sola al instante, es que Windows bloqueó el archivo: clic derecho en <code>setup.bat</code> → <strong>Propiedades</strong> → tildá <strong>Desbloquear</strong> → <strong>Aceptar</strong>, y probá de nuevo.</p>
        </div>
      </details>

      <details>
        <summary>Los números no me cuadran con lo que dice mi banco</summary>
        <div class="answer">
          <p>Lo más común es que haya movimientos <strong>en revisión</strong>, que a propósito no suman a ningún total. Fijate primero en esa bandeja del tablero.</p>
          <p>También puede ser que falten movimientos de los que tu banco no te mandó correo (algunos no avisan de ciertas operaciones), o que no hayas tocado <strong>Sincronizar</strong> desde la última compra.</p>
          <p>El wallet no adivina: solo sabe lo que llegó por correo. Si un movimiento nunca te lo avisaron por mail, para el wallet no existe.</p>
        </div>
      </details>

      <details>
        <summary>Nunca configuré nada de esto. ¿Y si me equivoco en una respuesta?</summary>
        <div class="answer">
          <p>No hay forma de romper nada. En las preguntas de categorías (<em>"¿el supermercado es comida?"</em>) <strong>no hay respuestas incorrectas</strong>: es tu clasificación, la usás vos y la podés cambiar cuando quieras pidiéndoselo al asistente.</p>
          <p>Y si te equivocaste en algo más grande —el sueldo, los días de cobro— volvés a abrir <code>configurar.bat</code> y le decís qué querés corregir. Nada se escribe sin que vos lo confirmes antes.</p>
        </div>
      </details>
    </div>
  </div>
</section>

<section class="closing">
  <div class="wrap">
    <h2>Tu historial financiero debería ser tuyo</h2>
    <p>No hace falta subir tus movimientos a una aplicación que no conocés para saber en qué se te va la plata. Ya tenés los datos en tu correo — esto solo los ordena, y los deja donde estaban: con vos.</p>
    <p class="cta-row">
      <a class="btn btn-primary" href="#instalacion">Instalarlo — son tres dobles clics</a>
      <a class="btn btn-ghost" href="{{ '/onboarding-para-humanos.html' | relative_url }}">Leer la guía primero</a>
    </p>
  </div>
</section>
