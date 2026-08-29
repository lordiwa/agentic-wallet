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
      <h2>Qué necesitás y cómo se pone en marcha</h2>
      <p>La configuración lleva unos 30-40 minutos y se hace una sola vez. Está pensada para que <strong>un asistente de IA te vaya guiando</strong> paso a paso: tu parte es responder preguntas y autorizar en el navegador cuando te lo pida.</p>
    </div>

    <table class="req-table">
      <thead>
        <tr><th>Necesitás</th><th>Para qué</th></tr>
      </thead>
      <tbody>
        <tr><td>Una cuenta de Gmail</td><td>Es donde llegan los correos de tu banco.</td></tr>
        <tr><td>Un banco que te avise por correo</td><td>Debe mandarte un mail por cada movimiento. Si tu banco solo avisa dentro de su app, esto no puede funcionar.</td></tr>
        <tr><td>Una suscripción de Claude (Pro o Max) o una clave de Anthropic</td><td>Para la segunda opinión sobre los correos y para el chat. Con la suscripción no se paga por uso.</td></tr>
        <tr><td>Node.js 22 o más nuevo</td><td>Es lo que hace correr el programa en tu equipo. Se instala una vez.</td></tr>
      </tbody>
    </table>

    <div class="install-steps">
      <div class="install-step">
        <div>
          <h3>Traés el proyecto a tu computadora</h3>
          <p>Se descarga el código y sus piezas. Un par de minutos.</p>
<pre class="cmd">git clone https://github.com/lordiwa/agentic-wallet.git
cd agentic-wallet
npm install</pre>
        </div>
      </div>

      <div class="install-step">
        <div>
          <h3>Arrancás la configuración guiada</h3>
          <p>Este comando crea tu archivo de configuración y después te dice, en cada momento, qué falta y cuál es el siguiente paso. Lo podés cortar y retomar cuando quieras.</p>
<pre class="cmd">npm run onboard -- --init-env   <span class="c"># crea tu archivo de configuración</span>
npm run onboard                 <span class="c"># te dice qué falta, paso a paso</span></pre>
        </div>
      </div>

      <div class="install-step">
        <div>
          <h3>Conectás tu Claude y tu Gmail</h3>
          <p>Abrís un par de enlaces de autorización y le das permiso de <strong>lectura</strong> a tu correo. Es el tramo más largo (~10 minutos) porque hay que pasar por la consola de Google, pero está explicado pantalla por pantalla y no se repite.</p>
          <p><a href="{{ '/conectar-gmail.html' | relative_url }}">Ver la guía de Gmail →</a></p>
        </div>
      </div>

      <div class="install-step">
        <div>
          <h3>Traés tu historial y armás tu perfil</h3>
          <p>La primera sincronización lee tus correos viejos del banco y arma tu historial. Después viene la parte donde ayudás vos: el wallet te muestra tus comercios más frecuentes y te pregunta a qué categoría va cada uno, cuál es tu sueldo y cuánto querés guardar de colchón.</p>
        </div>
      </div>

      <div class="install-step">
        <div>
          <h3>Lo usás</h3>
          <p>Levantás el programa y abrís <strong>http://localhost:3000</strong> en tu navegador: ahí está tu tablero y el chat.</p>
<pre class="cmd">npm run dev</pre>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="guias">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Guías</p>
      <h2>Para leer antes de empezar</h2>
      <p>La primera es la que te conviene si vas a ser la persona que usa el wallet. Las otras son para quien te ayude con la parte técnica.</p>
    </div>

    <div class="grid grid-2">
      <a class="card" href="{{ '/onboarding-para-humanos.html' | relative_url }}">
        <h3>Configurar tu wallet — guía para humanos</h3>
        <p>Qué va a pasar, qué necesitás tener a mano y qué te van a preguntar, sin un solo tecnicismo. <strong>Si es tu primera vez, empezá por acá.</strong></p>
        <span class="more">Leer la guía →</span>
      </a>

      <a class="card" href="{{ '/conectar-gmail.html' | relative_url }}">
        <h3>Conectar Gmail (solo lectura)</h3>
        <p>El paso a paso para darle permiso de lectura a tu correo, qué ve exactamente y cómo revocarlo cuando quieras.</p>
        <span class="more">Ver el paso a paso →</span>
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
      <h2>Lo que todo el mundo pregunta primero</h2>
    </div>

    <div class="faq">
      <details open>
        <summary>¿Se conecta a mi banco? ¿Le tengo que dar mi clave?</summary>
        <div class="answer"><p>No, y no. Agentic Wallet <strong>nunca</strong> se conecta a tu banco ni te pide tu clave. Lo único que hace es leer los correos de aviso que el banco ya te manda a tu Gmail. Si mañana borrás el programa, tu banco ni se entera de que existió.</p></div>
      </details>

      <details>
        <summary>¿Mis datos van a alguna nube?</summary>
        <div class="answer">
          <p>Tu historial no. Vive en un archivo de base de datos en tu computadora y no se sube a ningún lado.</p>
          <p>Lo único que sale de tu equipo es el <strong>texto del correo bancario</strong>, que se envía a Claude para la segunda opinión sobre el monto — y va enmascarado: los números de cuenta se reemplazan antes de salir.</p>
        </div>
      </details>

      <details>
        <summary>¿Necesito saber programar?</summary>
        <div class="answer">
          <p>Para <em>usarlo</em>, no: es un tablero en tu navegador y un chat.</p>
          <p>Para <em>instalarlo</em>, hay que escribir unos comandos. Está diseñado para que un asistente de IA (como Claude Code) haga esa parte y te vaya preguntando lo que hace falta. Si tenés a alguien técnico cerca, también sirve.</p>
        </div>
      </details>

      <details>
        <summary>¿Funciona con mi banco?</summary>
        <div class="answer">
          <p>Depende de dos cosas. Primero: tu banco tiene que <strong>mandarte un correo por cada movimiento</strong>. Si solo te avisa dentro de su app, no hay de dónde sacar los datos.</p>
          <p>Segundo: cada banco escribe sus correos distinto, así que hay que enseñarle a leer los del tuyo. El proyecto trae de ejemplo el lector de Produbanco (Ecuador). Si tu banco es otro, no es que "no funcione": es que <strong>todavía no está hecho</strong>, y es un trabajo acotado que puede hacer alguien técnico o un agente.</p>
        </div>
      </details>

      <details>
        <summary>¿Cuánto cuesta?</summary>
        <div class="answer">
          <p>El proyecto es gratis y de código abierto. Lo que sí necesitás es acceso a Claude: con una suscripción Pro o Max <strong>no se paga por uso</strong>. La alternativa es una clave de API de Anthropic, que sí se cobra por consumo.</p>
        </div>
      </details>

      <details>
        <summary>¿Y si lee mal un movimiento?</summary>
        <div class="answer">
          <p>Por diseño, no se lo guarda para sí. Cuando el lector automático y la IA no coinciden en el monto, el movimiento se marca <strong>"para revisar"</strong> y <strong>no entra en ningún total</strong> hasta que vos lo mires. En el tablero tenés una bandeja con esos casos.</p>
        </div>
      </details>

      <details>
        <summary>¿Puedo borrar todo?</summary>
        <div class="answer">
          <p>Sí, y es tan simple como borrar la carpeta. No queda una copia en ningún servidor porque nunca hubo servidor. Además podés quitarle el permiso a tu Gmail desde tu cuenta de Google cuando quieras.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué pasa cuando salgan mejoras?</summary>
        <div class="answer">
          <p>Actualizás el proyecto con un par de comandos. Tu configuración y tu base de datos están fuera del control de versiones a propósito: una actualización <strong>nunca</strong> toca tus datos ni tus credenciales.</p>
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
      <a class="btn btn-primary" href="{{ '/onboarding-para-humanos.html' | relative_url }}">Empezar con la guía</a>
      <a class="btn btn-ghost" href="{{ site.repo_url }}">Ver el código en GitHub</a>
    </p>
  </div>
</section>
