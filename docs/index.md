---
title: Inicio
permalink: /
description: >-
  Agentic Wallet es un copiloto financiero: lee los correos que tu banco ya te
  manda, arma tu historial de gastos y te deja preguntarle cosas en lenguaje
  natural. Es un servicio que operamos nosotros — tus datos viven en nuestro
  servidor, en una base que es sólo tuya, y acá está exactamente qué vemos y
  qué no.
---

<section class="hero">
  <div class="wrap hero-inner">
    <div>
      <p class="pill"><span class="dot"></span> Piloto cerrado — todavía no está abierto</p>

      <h1>Saber en qué se te va la plata, <span class="hl">sin llevar la cuenta a mano</span>.</h1>

      <p class="tagline">Agentic Wallet lee los correos que <strong>tu banco ya te manda</strong>, arma tu historial de gastos y te deja preguntarle lo que quieras en lenguaje natural.</p>

      <p class="hero-note">Es un <strong>servicio que operamos nosotros</strong>. Tu historial vive en nuestro servidor, en una base de datos que es sólo tuya. Eso quiere decir que hay un "nosotros" del otro lado — y que, técnicamente, podríamos leerla. <a href="#privacidad">Está explicado sin vueltas acá abajo</a>, porque preferimos que lo sepas antes de entrar y no después.</p>

      <p class="cta-row">
        <a class="btn btn-primary" href="#acceso">Cómo se entra</a>
        <a class="btn btn-ghost" href="{{ site.repo_url }}">Ver el código</a>
      </p>
    </div>

    <div class="hero-card">
      <div class="hero-card-bar">
        <span class="tl"></span><span class="tl"></span><span class="tl"></span>
        <span class="where">tu wallet</span>
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

<section id="estado" class="tinted">
  <div class="wrap">
    <div class="note">
      <h3>En qué estado está esto, hoy</h3>
      <p><strong>El servicio está en construcción y el piloto es cerrado.</strong> No hay un botón de "registrarme": hoy entra un grupo chico de personas invitadas, para probar el flujo completo con usuarios reales antes de abrirlo.</p>
      <p>Lo que <strong>sí</strong> funciona hoy, y funciona hace meses, es el motor: leer los correos del banco, armar el historial, categorizar, el tablero y el chat. Lo que se está construyendo es la parte de <em>servicio</em>: entrar con tu cuenta de Google, que la sincronización corra sola en nuestro servidor y que cada usuario tenga su espacio aislado.</p>
      <p>Y hay una tercera opción que existe desde el día uno y no se va: <strong>el código es abierto y lo podés correr vos, en tu computadora, sin nosotros en el medio</strong>. <a href="#acceso">Las dos formas están abajo.</a></p>
    </div>
  </div>
</section>

<section id="que-es">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Qué es</p>
      <h2>Un copiloto financiero armado con lo que ya te llega al correo</h2>
      <p>Tu banco ya te avisa por correo cada vez que pagás algo, transferís o te entra el sueldo. Esa información es tuya y está ahí, desordenada, entre miles de mails. Agentic Wallet la ordena y te la devuelve como algo que se puede mirar y preguntar.</p>
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
        <div class="ico" aria-hidden="true">🔄</div>
        <h3>Se pone al día solo</h3>
        <p>En el servicio, la sincronización corre en nuestro servidor cada pocas horas: no tenés que dejar nada prendido ni acordarte de apretar un botón.</p>
      </div>
      <div class="card">
        <div class="ico" aria-hidden="true">🧾</div>
        <h3>Te dice cuándo no está seguro</h3>
        <p>Un movimiento que no se leyó con certeza queda marcado y <strong>fuera de todos los totales</strong> hasta que vos lo mires. Preferimos un "no sé" a un número inventado.</p>
      </div>
    </div>
  </div>
</section>

<section id="pantallas">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Cómo se ve</p>
      <h2>El tablero, tal cual sale</h2>
      <p>Estas son capturas <strong>reales</strong> del tablero corriendo contra una base de datos de demostración. Sin retoques y sin maquillaje: el esfuerzo del proyecto está en que cada número sea correcto y verificable antes que en la presentación.</p>
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
      <h2>Cuatro pasos, y conviene que sepas por dónde pasa cada dato</h2>
      <p>No hace falta que entiendas la parte técnica para usarlo. Sí conviene que sepas el recorrido, porque es lo que te deja decidir si te sirve. Es corto:</p>
    </div>

    <div class="flow">
      <div class="step">
        <div class="n">1</div>
        <h3>Le das permiso a tu Gmail</h3>
        <p>Sólo de <strong>lectura</strong>: no puede enviar, cambiar ni borrar nada. Se lo das una vez desde tu cuenta de Google, y se lo quitás cuando quieras.</p>
      </div>
      <div class="step">
        <div class="n">2</div>
        <h3>Buscamos los correos de tu banco</h3>
        <p>La búsqueda está filtrada por los remitentes de tu banco. Del resto de tu bandeja no leemos nada, ni siquiera los asuntos.</p>
      </div>
      <div class="step">
        <div class="n">3</div>
        <h3>Se arma tu historial en nuestro servidor</h3>
        <p>Cada movimiento queda en una base de datos <strong>tuya</strong>, separada de la de cualquier otro usuario, en un disco que administramos nosotros. Podés pedir una copia o que la borremos.</p>
      </div>
      <div class="step">
        <div class="n">4</div>
        <h3>Lo consultás</h3>
        <p>Entrás al tablero desde el navegador o le preguntás por chat. También reconoce reversos, duplicados y transferencias entre tus propias cuentas.</p>
      </div>
    </div>

    <div class="note">
      <h3>La regla de oro: la IA nunca inventa un monto</h3>
      <p>Los números <strong>siempre</strong> salen de un lector automático, que hace lo mismo cada vez. La inteligencia artificial se usa sólo como <strong>segunda opinión</strong>: lee el mismo correo y dice qué monto ve.</p>
      <p>Si las dos lecturas no coinciden, ese movimiento se marca <strong>"para revisar"</strong> y queda <strong>fuera de todos los totales</strong> hasta que vos lo mires. Preferimos decirte "esto no lo tengo claro" antes que darte una cifra inventada — un copiloto financiero que alucina un número es peor que no tener nada.</p>
    </div>
  </div>
</section>

<section id="privacidad">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Privacidad</p>
      <h2>Qué vemos, qué no, y qué te podemos garantizar de verdad</h2>
      <p>Esta página decía, hasta hace poco, que nadie podía ver tus movimientos "ni siquiera nosotros, porque no hay un nosotros del otro lado". Eso era cierto cuando el wallet corría solamente en tu computadora. Con el servicio <strong>ya no lo es</strong>, y cambiarlo en esta página es lo primero que hicimos. Un servicio financiero que promete algo que no puede cumplir es peor que uno que no promete nada.</p>
    </div>

    <div class="privacy-split">
      <div>
        <ul class="checks">
          <li><span class="mark">✓</span><span><strong>Tu historial vive en una base que es sólo tuya.</strong> Un archivo por usuario, en un directorio propio. No hay una tabla gigante con los movimientos de todo el mundo mezclados.</span></li>
          <li><span class="mark">✓</span><span><strong>Gmail, sólo lectura, y sólo tu banco.</strong> El permiso no alcanza para enviar, responder ni borrar. La búsqueda está filtrada por los remitentes de tu banco: el resto de tu bandeja no se lee.</span></li>
          <li><span class="mark">✓</span><span><strong>El permiso lo revocás vos, cuando quieras.</strong> Desde tu cuenta de Google, en dos clics, sin pedirnos permiso. A partir de ahí no podemos leer un correo más.</span></li>
          <li><span class="mark">✓</span><span><strong>La llave de tu Gmail se guarda cifrada.</strong> Cifrado moderno y ligado a tu cuenta: aunque alguien copiara el archivo a otro lado, no serviría.</span></li>
          <li><span class="mark">✓</span><span><strong>Podés pedir tu copia o el borrado.</strong> Nos escribís y lo hacemos a mano, con confirmación. Hoy no hay un botón: somos pocos y preferimos decirlo así en vez de fingir que está automatizado.</span></li>
          <li><span class="mark no">✕</span><span><strong>No nos conectamos a tu banco.</strong> Nunca te pedimos la clave del banco. No podríamos entrar aunque quisiéramos: sólo leemos correos.</span></li>
          <li><span class="mark no">✕</span><span><strong>No vendemos ni compartimos tus datos.</strong> No hay publicidad, no hay terceros analíticos mirando tu historial, no hay perfilado para vender nada.</span></li>
          <li><span class="mark no">✕</span><span><strong>No entrenamos ningún modelo con tus movimientos.</strong> Lo que se le manda a la IA es el texto de un correo bancario para leer un monto, y nada más.</span></li>
        </ul>
      </div>

      <div class="card">
        <h3>Lo incómodo, dicho sin adornos</h3>
        <p><strong>Podemos leer tu historial.</strong> Vive en un servidor que administramos nosotros, y quien tiene acceso de administrador a ese servidor puede abrir esa base de datos. Ninguna configuración lo evita: es la consecuencia de que el servicio corra en algún lado que no es tu casa.</p>
        <p>Lo que sí podemos decir es <strong>qué protege cada cosa</strong>. La llave de tu Gmail está cifrada, así que una copia del disco o un backup filtrado no la entrega. Pero tu historial de movimientos <strong>no está cifrado fila por fila</strong> — el plan es cifrar el disco entero y los backups, y hasta que eso esté, la protección real contra alguien con acceso de administrador es la confianza y nada más.</p>
        <p><strong>El texto de cada correo bancario sale hacia la IA</strong> (Claude, de Anthropic) para la segunda opinión sobre el monto. Sale <strong>enmascarado</strong>: los números de cuenta se reemplazan por algo como <code>XXXXXX1234</code> antes de salir. Pero sale.</p>
        <p><strong>Si esto no te cierra, hay una salida real:</strong> el código es abierto y podés correrlo en tu propia computadora, sin nosotros. Ahí vuelve a ser cierta la promesa vieja, y es exactamente por eso que esa opción no se elimina. <a href="#acceso">Está abajo.</a></p>
      </div>
    </div>
  </div>
</section>

<section id="acceso" class="tinted">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Cómo se entra</p>
      <h2>Dos caminos, y son distintos a propósito</h2>
      <p>Uno es cómodo y nos tenés que creer. El otro es más trabajo y no tenés que creerle a nadie. Los dos existen, y no vamos a empujarte al primero escondiendo el segundo.</p>
    </div>

    <table class="req-table">
      <thead>
        <tr><th></th><th>El servicio (piloto)</th><th>Correrlo vos</th></tr>
      </thead>
      <tbody>
        <tr><td>Dónde viven tus datos</td><td>En nuestro servidor</td><td>En tu computadora</td></tr>
        <tr><td>Quién puede leerlos</td><td>Vos y quien administre el servidor</td><td>Sólo vos</td></tr>
        <tr><td>Se pone al día solo</td><td>Sí, cada pocas horas</td><td>No: apretás "Sincronizar" cuando querés</td></tr>
        <tr><td>Qué hay que instalar</td><td>Nada</td><td>El wallet, en Windows (o por consola en Mac/Linux)</td></tr>
        <tr><td>Cuánto tarda empezar</td><td>Minutos</td><td>Entre 40 y 60 minutos, una sola vez</td></tr>
        <tr><td>Disponible hoy</td><td><strong>No: piloto cerrado, por invitación</strong></td><td><strong>Sí</strong></td></tr>
      </tbody>
    </table>

    <div class="install-steps">
      <div class="install-step">
        <div>
          <h3>Camino A — el servicio</h3>
          <p>Entrás con tu cuenta de Google, le das permiso de <strong>solo lectura</strong> a tu Gmail, y el wallet arma tu historial y lo mantiene al día solo. No instalás nada.</p>
          <p><strong>Todavía no está abierto.</strong> Durante el piloto entra un grupo chico de personas invitadas. No hay lista de espera pública ni formulario: si conocés a alguien del proyecto, ese es el camino.</p>
          <p>Dos cosas que te van a llamar la atención cuando entres, y que no son errores: vas a ver <strong>dos pantallas de Google</strong> (una para entrar, otra para el permiso de tu correo — son permisos distintos), y Google va a decir que <strong>la app no está verificada</strong>, porque el proceso de verificación para leer correo es largo y todavía no lo terminamos. Hay que tocar "Avanzado" para seguir.</p>
        </div>
      </div>

      <div class="install-step">
        <div>
          <h3>Camino B — en tu propia computadora</h3>
          <p>Es lo que existe desde el principio y sigue funcionando igual: descargás una carpeta y hacés doble clic en tres archivos, uno después del otro. No hay que escribir comandos ni saber programar. Se hace <strong>una sola vez</strong>.</p>
          <p><a href="{{ site.repo_url }}/archive/refs/heads/main.zip">Descargá el wallet acá</a>, extraé el ZIP en <strong>Documentos</strong> y ejecutá en orden <code>setup.bat</code>, <code>configurar.bat</code> e <code>iniciar.bat</code>. El paso a paso, con qué ves en cada pantalla y una tabla de "si aparece esto, hacé esto otro", está en <a href="{{ '/instalar-en-windows.html' | relative_url }}">Instalar el wallet en Windows</a>.</p>
          <p>Acá <strong>ninguno de tus datos pasa por nosotros</strong>: tu historial es un archivo en tu carpeta y la sincronización la disparás vos. Necesitás una cuenta de Claude (Pro o Max alcanza) para la lectura de los correos y el chat.</p>
          <p>Si estás en Mac o Linux, la instalación por línea de comandos está en el <a href="{{ site.repo_url }}#readme">README del repositorio</a>.</p>
        </div>
      </div>
    </div>

    <table class="req-table">
      <thead>
        <tr><th>Para cualquiera de los dos, necesitás</th><th>Para qué</th></tr>
      </thead>
      <tbody>
        <tr><td>Tu cuenta de Gmail</td><td>Es donde llegan los avisos de tu banco.</td></tr>
        <tr><td>Un banco que te avise por correo</td><td>Tiene que mandarte un mail por cada movimiento. Si sólo te avisa dentro de su app, no hay de dónde sacar los datos.</td></tr>
        <tr><td>Que ese banco esté soportado</td><td>Hoy está probado con <strong>Produbanco (Ecuador)</strong>. Cada banco escribe sus correos distinto y hay que enseñarle a leer los tuyos.</td></tr>
      </tbody>
    </table>

    <p class="install-foot">¿Querés saber si tu banco sirve? Buscá su nombre en tu Gmail. Si aparecen avisos de "consumo", "transferencia" o "retiro", los datos están; falta el lector, y <a href="{{ '/multibanco.html' | relative_url }}">acá está cómo se agrega</a>.</p>
  </div>
</section>

<section id="guias">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Guías</p>
      <h2>Para leer antes de empezar</h2>
      <p>Las dos primeras son las que te conviene leer si vas a instalarlo vos. Las otras son para quien te ayude con la parte técnica.</p>
    </div>

    <div class="grid grid-2">
      <a class="card" href="{{ '/instalar-en-windows.html' | relative_url }}">
        <h3>Instalar el wallet en Windows</h3>
        <p>Los tres dobles clics con todo el detalle: qué ves en cada pantalla, qué te puede preguntar Windows y una tabla de "si aparece esto, hacé esto otro". <strong>Si vas por el camino B, es esta.</strong></p>
        <span class="more">Ver los tres pasos →</span>
      </a>

      <a class="card" href="{{ '/onboarding-para-humanos.html' | relative_url }}">
        <h3>Configurar tu wallet — guía para humanos</h3>
        <p>Qué va a pasar, qué necesitás tener a mano y qué te van a preguntar, sin un solo tecnicismo. <strong>Si es tu primera vez, empezá por acá.</strong></p>
        <span class="more">Leer la guía →</span>
      </a>

      <a class="card" href="{{ '/oauth-para-humanos.html' | relative_url }}">
        <h3>Darle permiso a tu Gmail — para no técnicos</h3>
        <p>El tramo que más preguntas genera, explicado pantalla por pantalla: qué botón tocar, qué escribir en cada campo y cómo saber en cada paso que lo hiciste bien. Sin jerga.</p>
        <span class="more">Ver los 46 pasos →</span>
      </a>

      <a class="card" href="{{ '/conectar-gmail.html' | relative_url }}">
        <h3>Conectar Gmail (solo lectura)</h3>
        <p>La misma conexión, en versión corta y técnica: qué ve exactamente el wallet, por qué el permiso es el que es y cómo revocarlo cuando quieras.</p>
        <span class="more">Ver el resumen →</span>
      </a>

      <a class="card" href="{{ '/multibanco.html' | relative_url }}">
        <h3>Que entienda tu banco</h3>
        <p>El proyecto trae el lector de un banco de Ecuador (Produbanco). Si el tuyo es otro, acá está cómo se agrega — es trabajo técnico, pero acotado.</p>
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
      <p>Agrupadas por el momento en que suelen aparecer. Las de privacidad están primero a propósito: son las que más importan y las que más cambiaron.</p>
    </div>

    <div class="faq">
      <p class="faq-group">Privacidad y seguridad</p>

      <details open>
        <summary>¿Ustedes pueden ver mis movimientos?</summary>
        <div class="answer">
          <p><strong>En el servicio, sí, técnicamente podemos.</strong> Tu historial vive en una base de datos en un servidor que administramos nosotros, y quien tiene acceso de administrador a ese servidor puede abrir esa base. No hay una configuración que lo impida.</p>
          <p>Lo que hacemos con eso: no lo miramos salvo que vos pidas ayuda con algo concreto y nos autorices; no lo compartimos con nadie; y el objetivo de corto plazo es cifrar el disco y los backups para que una copia robada no sirva de nada. Lo que <strong>no</strong> vamos a hacer es decirte que es imposible cuando no lo es.</p>
          <p>Si esa respuesta no te alcanza —y es completamente razonable que no te alcance— <a href="#acceso">corré el wallet en tu propia computadora</a>. Ahí nadie más que vos tiene acceso, y el código está abierto para que lo verifiques.</p>
        </div>
      </details>

      <details>
        <summary>Antes decía que "no hay un nosotros del otro lado". ¿Qué cambió?</summary>
        <div class="answer">
          <p>Cambió el producto. El wallet nació como un programa que corrías vos en tu computadora, y con eso esa frase era literalmente cierta: no existía ningún servidor al que mandar nada.</p>
          <p>Ahora, además, hay un <strong>servicio</strong>: nosotros corremos el wallet por vos, en nuestro servidor, para que no tengas que instalar nada y para que se ponga al día solo. Eso trae comodidad y trae un costo: hay un "nosotros", y tiene acceso.</p>
          <p>Reescribir esta página fue lo primero que se hizo al tomar esa decisión, antes de abrir el servicio a nadie. La versión local no se eliminó justamente para que la promesa vieja siga estando disponible para quien la quiera.</p>
        </div>
      </details>

      <details>
        <summary>¿Se conecta a mi banco? ¿Le tengo que dar mi clave?</summary>
        <div class="answer">
          <p><strong>No, y no.</strong> El wallet nunca se conecta a tu banco y nunca te pide tu clave. Si alguna vez algo te pide la clave del banco, no es esto: cerrá todo y preguntá.</p>
          <p>Lo único que hace es leer los correos de aviso que el banco ya te manda a tu Gmail. Si mañana dejás de usarlo, tu banco ni se entera de que existió.</p>
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
        <summary>¿Mis correos se suben a la IA?</summary>
        <div class="answer">
          <p>Tu bandeja de entrada no. Tu historial de gastos tampoco.</p>
          <p>Lo que sí sale es el <strong>texto de cada correo bancario</strong>, que se le manda a Claude para que dé su segunda opinión sobre el monto. Y sale <strong>enmascarado</strong>: los números de cuenta se reemplazan por algo como <code>XXXXXX1234</code> <em>antes</em> de salir.</p>
          <p>Los correos que no son de tu banco nunca se tocan: la búsqueda está filtrada por los remitentes de tu banco. Y tus movimientos no se usan para entrenar ningún modelo.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué pasa si les hackean el servidor?</summary>
        <div class="answer">
          <p>Lo honesto es decir qué protege cada medida, en vez de decir "es seguro".</p>
          <p><strong>La llave de tu Gmail está cifrada</strong> y atada a tu cuenta, así que un archivo robado no le sirve a nadie para leer tu correo. Además tenemos una palanca de emergencia que <strong>invalida de golpe el acceso al Gmail de todos los usuarios</strong>, cifrado o no.</p>
          <p><strong>Tu historial de movimientos no está cifrado fila por fila.</strong> Si alguien se lleva el disco entero, hoy podría leerlo. Cifrar el disco y los backups es trabajo pendiente y está en el plan, no en la lista de deseos.</p>
          <p>Si pasara algo, te lo decimos: a quién afectó, qué se llevó y qué hacer. Y lo primero que hacemos es cortar el acceso a los correos, que es lo que se puede cortar en minutos.</p>
        </div>
      </details>

      <details>
        <summary>¿Puedo borrar todo?</summary>
        <div class="answer">
          <p>Sí. Nos escribís y borramos tu base de datos y tus credenciales guardadas, con confirmación de que se hizo. <strong>Hoy es a mano, no hay un botón</strong> — somos pocos usuarios y preferimos decirlo así en vez de fingir que está automatizado. Automatizarlo bien está en el plan.</p>
          <p>Aparte, y sin depender de nosotros: entrá a tu cuenta de Google, buscá las aplicaciones con acceso y quitale el permiso al wallet. Desde ese momento no podemos leer un correo más, hayamos borrado o no.</p>
          <p>Si corrés el wallet en tu computadora, borrar todo es borrar la carpeta.</p>
        </div>
      </details>

      <p class="faq-group">Antes de empezar</p>

      <details>
        <summary>¿Cómo entro? ¿Hay lista de espera?</summary>
        <div class="answer">
          <p>Hoy el piloto es <strong>cerrado y por invitación</strong>: no hay registro público ni lista de espera. Entra un grupo chico de personas para probar el flujo completo con datos reales antes de abrirlo.</p>
          <p>Mientras tanto, <a href="#acceso">podés correrlo en tu computadora</a>: no depende de nosotros ni de ninguna invitación.</p>
        </div>
      </details>

      <details>
        <summary>¿Cuánto cuesta?</summary>
        <div class="answer">
          <p><strong>Durante el piloto no se cobra nada.</strong> Lo que estamos haciendo es <em>medir</em> cuánto cuesta atender a un usuario, que es el paso que hay que dar antes de poner un precio. Cobrar sin haber medido es cómo se arruinan estos servicios.</p>
          <p>El código es y va a seguir siendo abierto. Si lo corrés vos, no nos pagás nada nunca: sólo necesitás una cuenta de Claude (Pro o Max alcanza) para la lectura de los correos y el chat.</p>
        </div>
      </details>

      <details>
        <summary>¿Funciona con mi banco?</summary>
        <div class="answer">
          <p>Depende de dos cosas. Primero: tu banco tiene que <strong>mandarte un correo por cada movimiento</strong>. Si sólo te avisa dentro de su app, no hay de dónde sacar los datos y esto no puede funcionar.</p>
          <p>Segundo: cada banco escribe sus correos distinto, así que hay que enseñarle a leer los del tuyo. Hoy está probado con <strong>Produbanco (Ecuador)</strong>. Si tu banco es otro, no es que "no funcione": es que <strong>todavía no está hecho</strong>. Es un trabajo acotado que puede hacer alguien técnico o un asistente de IA — <a href="{{ '/multibanco.html' | relative_url }}">acá está cómo</a>.</p>
        </div>
      </details>

      <details>
        <summary>¿Necesito saber programar?</summary>
        <div class="answer">
          <p><strong>No.</strong> En el servicio no instalás nada: entrás con tu cuenta de Google y listo.</p>
          <p>Si lo corrés en tu computadora, son tres dobles clics: <code>setup.bat</code>, <code>configurar.bat</code> e <code>iniciar.bat</code>. No hay que escribir ni un comando. Lo único que hacés vos es <em>contestar preguntas</em> — tu nombre, cada cuánto cobrás, a qué categoría va cada comercio — y darle el permiso a tu Gmail siguiendo <a href="{{ '/oauth-para-humanos.html' | relative_url }}">una guía con capturas de cada pantalla</a>.</p>
        </div>
      </details>

      <details>
        <summary>¿Funciona en Mac? ¿En Linux? ¿En el celular?</summary>
        <div class="answer">
          <p>El servicio se usa desde el navegador, así que funciona en cualquier sistema, incluido el celular: el tablero es responsive.</p>
          <p>Para correrlo en tu propia máquina, la instalación de doble clic es <strong>sólo para Windows 10 y 11</strong>. En Mac y Linux el wallet funciona igual, pero hay que instalarlo escribiendo comandos, así que hoy es un camino para alguien técnico.</p>
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
        <summary>¿El asistente puede cambiar cosas de mi wallet solo?</summary>
        <div class="answer">
          <p><strong>No sin que vos lo confirmes.</strong> El asistente puede <em>proponer</em> — "esta contraparte parece ser tu supermercado, ¿la marco como comida?" — pero cualquier cambio en tu configuración o en tu historial pasa por un botón que apretás vos.</p>
          <p>Y no es una cortesía de diseño: el asistente lee texto que escribió alguien más (el correo de tu banco), y ese texto podría contener instrucciones puestas ahí a propósito. Con la confirmación de por medio, lo peor que puede pasar es que te haga una propuesta rara. Sin ella, lo peor sería un cambio en tus números.</p>
        </div>
      </details>

      <details>
        <summary>¿Trae los movimientos nuevos solo?</summary>
        <div class="answer">
          <p>En el servicio, <strong>sí</strong>: la sincronización corre en nuestro servidor cada pocas horas. No tenés que dejar nada prendido ni acordarte de nada.</p>
          <p>Si lo corrés en tu computadora, lo pedís vos con el botón <strong>Sincronizar</strong>. En los dos casos, lo que ya se leyó no se repite ni se duplica.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué son los movimientos "en revisión"?</summary>
        <div class="answer">
          <p>Son los movimientos que el wallet <strong>no está 100% seguro de haber leído bien</strong>, y por eso prefiere avisarte antes que darte un número inventado.</p>
          <p>Cada correo lo leen dos: un lector automático (que siempre hace lo mismo) y la IA como segunda opinión. Si los dos coinciden en el monto, entra. Si no coinciden, el movimiento va a la bandeja <strong>"Necesitan revisión"</strong> y <strong>queda fuera de todos los totales</strong> hasta que vos lo mires. Por eso a veces el chat te dice "dejé fuera 3 movimientos que están en revisión": está siendo honesto con vos.</p>
          <p>Los resolvés de a uno desde el tablero: mirás el monto y decís si está bien (entra a los totales) o si hay que descartarlo. Podés dejarlos ahí todo el tiempo que quieras: no molestan, sólo no suman.</p>
        </div>
      </details>

      <details>
        <summary>Los números no me cuadran con lo que dice mi banco</summary>
        <div class="answer">
          <p>Lo más común es que haya movimientos <strong>en revisión</strong>, que a propósito no suman a ningún total. Fijate primero en esa bandeja del tablero.</p>
          <p>También puede ser que falten movimientos de los que tu banco no te mandó correo — algunos no avisan de ciertas operaciones.</p>
          <p>El wallet no adivina: sólo sabe lo que llegó por correo. Si un movimiento nunca te lo avisaron por mail, para el wallet no existe.</p>
        </div>
      </details>

      <details>
        <summary>¿Cómo hago una copia de respaldo?</summary>
        <div class="answer">
          <p>En el servicio, la copia la hacemos nosotros. Si querés tu propia copia del historial, pedila y te la damos.</p>
          <p>Si lo corrés en tu computadora, copiá la carpeta del wallet a un pendrive o a un disco externo: ahí adentro está tu historial y tu configuración. La contracara de que nadie más vea tus datos es que <strong>el respaldo lo hacés vos</strong>.</p>
        </div>
      </details>

      <p class="faq-group">Si algo no sale bien</p>

      <details>
        <summary>Google me dice que la app "no está verificada"</summary>
        <div class="answer">
          <p>Es esperable y no es un error. Leer el correo de alguien es uno de los permisos que Google trata con más cuidado, y para sacarle el cartel hay que pasar una verificación larga que todavía no terminamos.</p>
          <p>Para seguir, tocá <strong>Avanzado</strong> y después la opción de continuar igual. Si eso te incomoda —y es una incomodidad legítima— no sigas: <a href="#acceso">corré el wallet en tu computadora</a>, donde el permiso se lo das a un programa tuyo.</p>
        </div>
      </details>

      <details>
        <summary>Dejé de ver movimientos nuevos</summary>
        <div class="answer">
          <p>Lo más probable es que el permiso de tu Gmail se haya caído: puede pasar si lo revocaste, si cambiaste la contraseña de Google o si venció. El tablero te lo va a decir y te va a ofrecer volver a conectarlo — son los mismos dos clics de la primera vez.</p>
          <p>Si el tablero no dice nada y aun así falta algo, avisanos con la fecha del último movimiento que sí ves. Eso alcanza para encontrarlo.</p>
        </div>
      </details>

      <details>
        <summary>¿Qué hago si algo no funciona?</summary>
        <div class="answer">
          <p>Si estás en el servicio: escribinos contando qué esperabas ver y qué viste, con la fecha. No hace falta que mandes nada de tu historial.</p>
          <p>Si lo corrés vos, tres cosas en orden: <strong>1)</strong> volvé a intentar el mismo paso — los tres archivos se pueden ejecutar las veces que quieras, no rompen nada y retoman donde quedaron; <strong>2)</strong> buscá el mensaje en la tabla de problemas de <a href="{{ '/instalar-en-windows.html' | relative_url }}">Instalar el wallet en Windows</a>; <strong>3)</strong> pedí ayuda con el <strong>mensaje exacto</strong>. "No me anda" no se puede arreglar; el mensaje exacto casi siempre sí.</p>
        </div>
      </details>
    </div>
  </div>
</section>

<section class="closing">
  <div class="wrap">
    <h2>Tu historial financiero debería ser tuyo</h2>
    <p>Ya tenés los datos en tu correo. Esto sólo los ordena — y te dice, sin vueltas, por dónde pasan cuando lo hace.</p>
    <p class="cta-row">
      <a class="btn btn-primary" href="#acceso">Ver los dos caminos</a>
      <a class="btn btn-ghost" href="#privacidad">Leer qué vemos y qué no</a>
    </p>
  </div>
</section>
