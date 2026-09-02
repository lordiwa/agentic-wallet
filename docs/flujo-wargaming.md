# Flujo del panel — paths de caso de uso y wargaming adversario

**Qué es esto, en una línea:** Mato aprobó el flujo del panel y pidió dos cosas
— primero, **los caminos de uso dibujados de forma simple**; después, que se
**intente romperlos**. Este doc entrega las dos, en ese orden.

**La Parte 1 es para leer de un vistazo.** Cada caso de uso es una fila de
pasos: paso 1 ---> paso 2 ---> paso 3. Sin jerga, sin nombres de endpoint, sin
números de hueco. Si sólo vas a leer una parte, leé ésa.

**La Parte 2 es el ataque.** Cada camino de la Parte 1 se lleva a los estados
que nadie dibujó: sin datos, sin perfil, sin red, sesión caída, dos pestañas a
la vez, el celular, el error que el motor sí devuelve y el diseño no contempla.
Cada hallazgo trae **el escenario concreto**, **por qué se rompe** con
`archivo:línea` cuando aplica, y **el camino corregido** en el mismo formato de
la Parte 1.

**Método.** Nada se afirma de memoria. Se leyeron los cinco documentos del panel
(`panel-manejo-flujo.md`, `flujo-app-prototipo.md`, `panel-viabilidad.md`,
`panel-roadmap-implementacion.md`, `panel-prep-implementacion.md`) y se
verificó cada afirmación contra el código: `server/src/api/`,
`server/src/review/resolve.ts`, `server/src/strategy/`, `server/src/db/`,
`web/src/api/`, `web/src/demo/`. Este doc **no implementa nada**: no toca
código, no despliega, no configura.

**Alcance del MVP contra el que se ataca** (de `panel-prep-implementacion.md`
§5.1): **B0** puerta, **B1** P2+P3, **B2** P5+P4, **B3** P6. El chat (P7) va al
final y acá se ataca **en concepto**, no como entregable.

---

# PARTE 1 — Los caminos de uso, en diagramas simples

Doce caminos. Cada uno es lo que Mato hace, no lo que el software ejecuta.

## CU-1 · Entrar al panel

```
Abro el panel  --->  ¿ya entré antes?  --->  SÍ  --->  Veo el Resumen
                          |
                          NO
                          |
                          v
                  Pantalla de acceso  --->  Toco "Continuar con Google"
                          --->  Google me pregunta si autorizo
                          --->  Veo el Resumen
```

## CU-2 · Cargar mi perfil (sueldo, día de pago, colchón)

```
Veo el Resumen  --->  Una tarjeta dice "Sin leer"  --->  Toco "Completar perfil"
     --->  Pantalla de Alta  --->  Toco "Sugerir desde mi historial"
     --->  El agente propone valores (todavía NO guardados)
     --->  Acepto o edito cada uno  --->  Toco "Guardar"  --->  Vuelvo al Resumen
```

Salida alterna, siempre disponible:

```
Pantalla de Alta  --->  Toco "Saltar por ahora"  --->  Vuelvo al Resumen
```

## CU-3 · Ver cómo estoy hoy (el hogar)

```
Entro  --->  Resumen: saldo, cuánto puedo gastar hoy, tarjeta,
             próximo cobro, colchón, gasto del mes por categoría
     --->  Toco la tarjeta que me interesa  --->  Me lleva a su pantalla
```

A dónde lleva cada tarjeta:

```
Tarjeta "Saldo"          --->  Movimientos
Tarjeta "Tarjeta"        --->  Estrategia
Tarjeta "Colchón"        --->  Ahorro
Barra del gráfico        --->  Movimientos, ya filtrado por esa categoría
Chip de sincronización   --->  Sincronización
Contador "N pendientes"  --->  Revisión
```

## CU-4 · Traer los correos nuevos (sincronizar)

```
Resumen  --->  Toco el chip "última vez hace 3 días"
     --->  Pantalla de Sincronización  --->  Toco "Sincronizar"
     --->  Barra de avance: "1 240 de 3 800"
     --->  Terminó este lote, quedan 2 560  --->  Toco "Seguir"
     --->  ... hasta que no queda nada  --->  "Al día"
```

Con el resultado del lote:

```
Terminó  --->  ¿quedó algo que el agente no pudo afirmar?
                     |                              |
                    NO                             SÍ
                     |                              |
                     v                              v
        "Nada pendiente", chip verde     Aviso: "N movimientos necesitan
                                          tu confirmación"
                                                    |
                                          Toco "Revisarlos ahora"
                                                    |
                                                    v
                                              Revisión
```

## CU-5 · Confirmar lo que el agente no pudo leer (revisión)

```
Resumen  --->  Toco "3 pendientes"  --->  Revisión: 3 tarjetas
     --->  Leo la primera: comercio, monto, asunto del correo
     --->  Elijo una de tres:
              "Confirmar monto"   --->  la tarjeta se va, quedan 2
              "Corregir monto"    --->  escribo el monto  --->  quedan 2
              "Descartar"         --->  dejo una nota     --->  quedan 2
     --->  Resuelvo la última  --->  "Nada pendiente"
     --->  Vuelvo al Resumen  --->  el saldo cambió
```

## CU-6 · Buscar un movimiento

```
Resumen  --->  Toco la tarjeta "Saldo"  --->  Movimientos: la lista
     --->  Filtro por fecha, tipo, entrada/salida o comercio
     --->  Toco una fila  --->  Se abre el detalle
     --->  Desde el detalle elijo:
              "Crear regla para este comercio"  --->  Reglas
              "Preguntar sobre este movimiento" --->  Chat
              "Resolver" (si está en revisión)  --->  Revisión
```

## CU-7 · Enseñarle al agente a clasificar (reglas)

```
Movimientos  --->  Fila sin categoría  --->  "Crear regla para este comercio"
     --->  Reglas, con el patrón ya escrito
     --->  Veo en vivo: "matchea 7 movimientos"
     --->  Si escribo de más, el contador cae a 0 y me avisa
     --->  Elijo la categoría  --->  "Guardar"
     --->  "Aplicar al historial"  --->  Me muestra "se reclasificarían 7"
     --->  Toco "Aplicar"  --->  Vuelvo al Resumen  --->  el gráfico cambió
```

## CU-8 · Preguntarle al agente (chat — va al final del plan)

```
Cualquier pantalla  --->  Toco el ícono de chat
     --->  Se abre un cajón encima, arrastrando de dónde vengo
     --->  Escribo la pregunta  --->  La respuesta llega de a pedazos
     --->  Si el agente propone algo, NO lo hace solo:
              me lleva a la pantalla donde eso se confirma
     --->  Cierro el cajón  --->  Vuelvo exactamente a donde estaba
```

## CU-9 · Ver el plan (estrategia)

```
Resumen  --->  Toco la tarjeta "Tarjeta"  --->  Estrategia
     --->  Veo: saldo de corte, mínimo, fecha máxima, si voy a tiempo
     --->  Muevo la perilla "Abono"  --->  la proyección se redibuja
           (esto NO guarda nada)
     --->  "Marcar deuda pagada"  --->  me pide confirmar  --->  se recalcula
     --->  "Ver el colchón"  --->  Ahorro
```

## CU-10 · Ajustar el colchón (ahorro)

```
Resumen  --->  Toco la tarjeta "Colchón"  --->  Ahorro
     --->  Veo el anillo: objetivo 500, reservado 320, faltan 180
     --->  "Fijar objetivo"  --->  escribo 800  --->  Guardar
     --->  El anillo se redibuja: faltan 480
     --->  Vuelvo al Resumen  --->  la tarjeta del colchón ya cambió
```

## CU-11 · Revisar conexiones y llaves (configuración)

```
Cualquier pantalla  --->  Toco el engranaje  --->  Configuración
     --->  Veo qué está conectado y qué falta
     --->  "Probar conexión"  --->  me dice si el servidor responde
     --->  "Completar perfil"  --->  Alta
```

## CU-12 · Los tres retornos al hogar

El flujo aprobado promete que **cada vuelta al Resumen muestra el efecto de lo
que acabo de hacer**. Son tres:

```
Vacío la cola de revisión   --->  Resumen  --->  el saldo cambió
Aplico una regla nueva      --->  Resumen  --->  el gráfico de categorías cambió
Fijo un objetivo de colchón --->  Resumen  --->  la tarjeta del colchón cambió
```

## CU-13 · Los caminos alternos (lo que pasa cuando algo no sale)

**El sync falla porque falta conectar Gmail**

```
Sincronización  --->  "Sincronizar"  --->  "Falta conectar Gmail"
     --->  Toco "Ir a Configuración"  --->  Configuración
```

**El sync falla porque ya hay otro corriendo**

```
Sincronización  --->  "Sincronizar"  --->  Aviso ámbar (no rojo):
     "ya hay un sync en curso"  --->  espero  --->  vuelvo a intentar
```

**El sync falla de verdad**

```
Sincronización  --->  "Sincronizar"  --->  Rojo, con el mensaje del servidor
     --->  Toco "Reintentar"
```

**No hay nada en la cola de revisión**

```
Resumen  --->  Toco "Revisión"  --->  "Nada pendiente. El agente pudo
     afirmar todos los movimientos."  --->  Vuelvo al Resumen
```

**Todavía no hay ningún movimiento**

```
Entro  --->  Resumen: "Todavía no leí ningún correo"
     --->  Toco "Sincronizar por primera vez"  --->  Sincronización
```

**No hay sesión**

```
Abro el panel  --->  Pantalla de acceso  --->  "Continuar con Google"
```

**El servidor no responde**

```
Cualquier pantalla  --->  Cartel: "sin conexión con el servidor"
     --->  Los números se atenúan (para no leer datos viejos como actuales)
     --->  Vuelve la conexión  --->  se refresca solo
```

**Falta la credencial del agente**

```
Abro el chat  --->  "Falta configurar Claude"
     --->  Toco "Ir a Configuración"  --->  Configuración
```

---

# PARTE 2 — El wargaming: intentar romper cada camino

## Cómo leer los veredictos

- **ROMPE** — hay que corregirlo **antes** de la fase visual. O el camino
  termina en un lugar que no existe, o muestra algo que no es cierto.
- **LIMITACIÓN ACEPTABLE** — se rompe en un caso real pero infrecuente o
  barato de sobrellevar. Se documenta, se rotula en pantalla, y se sigue.
- **SÓLIDO** — se atacó y aguantó.

**Resultado del ataque: 13 ROMPE, 12 limitaciones aceptables y 5 caminos
sólidos.** El detalle, camino por camino.

---

## Ataque a CU-1 — Entrar al panel

### R1 · Un enlace puede repuntar el panel a un servidor ajeno, y llevarse la credencial · **ROMPE** · severidad **crítica**

**Escenario.** Mato recibe (correo, chat, cualquier lado) un enlace a su propio
panel publicado, con un parámetro de más:
`https://<su-panel>.web.app/?api=https://servidor-ajeno.example`. Lo abre. El
panel se ve idéntico. A partir de ese momento, **todas** las llamadas van a
`servidor-ajeno.example`, y **la elección queda guardada**: un F5 sin el
parámetro no la revierte.

**Por qué se rompe.** `web/src/api/base.ts:62-70` — `takeFromQuery()` lee
`?api=` y **escribe el valor en `localStorage` inmediatamente**, sin
confirmación ni lista blanca. `web/src/api/base.ts:105-108` — `apiFetch()` es
el único punto de salida a la red y usa esa base para **todas** las rutas,
incluido el chat. Hoy eso es "sólo" mostrar datos inventados por un tercero
como si fueran los de Mato. **Con B0 pasa a ser mucho peor:**
`panel-prep-implementacion.md:193` planifica portar `client.ts` "copiar + una
línea de cabecera `Authorization`" — o sea que el token de acceso (o el ID
token de Firebase) viajaría a ese host en la primera request.

**Corrección.** La credencial se ata al origen, no al cliente. Tres reglas:

1. La cabecera `Authorization` **sólo** se adjunta si la base activa está en una
   lista blanca del build (`VITE_ALLOWED_API_ORIGINS`). Fuera de la lista, el
   panel llama sin credencial — falla con 401 y se ve, en vez de filtrarla.
2. `?api=` **no se guarda solo**: abre Configuración con el valor propuesto y
   pide confirmación.
3. El backend activo se muestra **siempre** (chip en la barra), no sólo dentro
   de Configuración.

```
Abro un enlace con ?api=  --->  Configuración: "querés apuntar el panel a X?"
     --->  Confirmo  --->  Resumen con datos de X
     --->  NO confirmo  --->  Resumen con mi backend de siempre
```

```
Origen fuera de la lista blanca  --->  el panel llama SIN credencial
     --->  401  --->  "ese servidor no está autorizado"
```

### R2 · El panel publicado no va a poder autenticarse: el CORS no acepta `Authorization` · **ROMPE** · severidad **alta**

**Escenario.** B0 termina: hay token, hay middleware, hay `tailscale serve`.
Mato abre el panel publicado en Firebase y no carga nada. No ve un 401: ve
"sin conexión con el servidor" — el mismo cartel que si el server estuviera
apagado.

**Por qué se rompe.** `server/src/api/cors.ts:51` declara
`Access-Control-Allow-Headers: Content-Type` y nada más. Una request
cross-origin con `Authorization` dispara un preflight que el navegador
**rechaza antes de mandarla**, y el error que ve el código es un fallo de red
genérico, indistinguible de una caída. Además `cors.ts:50` permite sólo
`GET, POST, OPTIONS`: el `DELETE /api/rules/:pattern` que B3 necesita para
borrar una regla (hueco H5) tampoco pasaría.

**Corrección.** En el mismo commit de B0, `cors.ts` suma `Authorization` a
`Allow-Headers` y `DELETE` a `Allow-Methods`, con su test. Y Configuración gana
un diagnóstico que distingue los tres fallos que hoy se ven iguales.

```
B0  --->  cors.ts acepta Authorization y DELETE  --->  el panel publicado carga
```

```
No carga  --->  "Probar conexión" (que va a /api/health, la única ruta sin llave)
     --->  responde: "el servidor está vivo pero rechaza tus credenciales"
     --->  no responde: "el servidor no contesta"
```

### R3 · La pantalla de acceso no puede saber si la puerta es real · **LIMITACIÓN ACEPTABLE**

`server/src/index.ts:84-86` — `GET /api/health` devuelve `{status:"ok"}` y nada
más. El hueco H1 propone que devuelva también `auth_required`, para que la
pantalla de acceso sepa si está protegiendo algo o si es decorativa. Sin eso,
P0 no puede rotularse sola: el rótulo "maqueta" queda escrito a mano.

**Se acepta** porque en B0-B3 P0 **no se construye** (el acceso es el token y,
si Firebase entra, el botón de Google). Cuando P0 exista, `auth_required` es un
campo más en una ruta que ya está.

---

## Ataque a CU-2 y CU-11 — Alta y Configuración

### R4 · Dos destinos obligatorios del flujo no existen en el MVP · **ROMPE** · severidad **alta**

**Escenario A.** Mato usa el panel de B1. Una tarjeta del Resumen dice "Sin
leer" y ofrece *Completar perfil*. Lo toca. **No pasa nada**: P1 no se
construye en B0-B3 (`panel-prep-implementacion.md:501-502` la deja
explícitamente para después).

**Escenario B.** Mato sincroniza y falta la credencial de Gmail. La pantalla
dice, correctamente, "falta conectar Gmail" y ofrece *Ir a Configuración*. Lo
toca. **No pasa nada**: P10 tampoco entra al MVP, y sin embargo el flujo
aprobado la declara "**el destino de todo error de configuración**"
(`flujo-app-prototipo.md:121-125`).

**Por qué se rompe.** Es una contradicción entre dos documentos aprobados, no
un bug de código: el flujo hace de P1 y P10 destinos obligatorios de caminos
que sí entran al MVP, y el plan preparatorio los difiere. El resultado es
exactamente lo que el propio ticket paraguas prohíbe: **un botón que no hace
nada es peor que un botón ausente.**

**Corrección.** Mientras P1 y P10 no existan, esos dos destinos son **texto,
no navegación**: un panel desplegable que explica qué comando lo resuelve. Es
media hora de trabajo y mantiene la promesa.

```
Tarjeta "Sin leer"  --->  "Completar perfil"
     --->  se despliega: "esto se configura con npm run onboard"  --->  cierro
```

```
Falta Gmail  --->  "Cómo conectar Gmail"
     --->  se despliega: "npm run gmail-auth, en la máquina del servidor"
```

### R5 · La única tarjeta que ofrece "Completar perfil" es "Próximo pago" · **LIMITACIÓN ACEPTABLE**

El flujo asigna el estado *sin leer → Completar perfil* a una `OverviewCard`
genérica. Contra el motor real, de los ocho campos del resumen sólo dos pueden
ser nulos: `card` y `next_payday` (`server/src/api/routes.ts:70,76`). Los
demás siempre traen número. O sea que, con un perfil vacío, **la única tarjeta
que va a estar en ese estado es Próximo pago**.

**Se acepta**, con la precisión escrita: el camino de vuelta al perfil cuelga
de Próximo pago, no de "cualquier tarjeta". (Con R9 corregido, Safe-to-spend
se le suma.)

---

## Ataque a CU-3 — El Resumen

### R6 · "Sin leer" no existe: el motor escribe 0 · **ROMPE** · severidad **alta**

**Escenario.** Llega un correo cuyo monto el parser no pudo leer. El flujo dice
que esa fila se dibuja "Sin leer". En pantalla va a decir **0,00** — y las
mismas fichas de diseño declaran que "0,00 se muestra como cifra" porque el
cero es un monto válido. Mato ve un movimiento de cero dólares.

**Por qué se rompe.** `server/src/db/schema.ts:13` — `amount REAL NOT NULL`.
`server/src/db/repository.ts:37,137` — lo desconocido se escribe como
`UNKNOWN_AMOUNT_PLACEHOLDER = 0`. **La API nunca devuelve `amount: null`.** El
flujo apoya la distinción `null` contra `0` en **cinco piezas**: P2
(`panel-manejo-flujo.md:186`), P4, P5, la OverviewCard y la
TransactionsTable. Ninguna se puede construir como está escrita.

`panel-prep-implementacion.md:46` ya lo había detectado y reescribió el
criterio del ticket — pero **los cuatro documentos de flujo siguen diciendo
"Sin leer"**, y son los que va a leer quien implemente.

**Corrección, sin tocar el motor ni la invariante.** "No lo pude leer" no es
`amount === null`: es **`needs_review === 1`**, que sí viene en la fila. Se
renombra el estado a *Sin confirmar* para que no se confunda con un faltante de
perfil, y la fila ofrece la salida que corresponde.

```
Fila con needs_review = 1  --->  se dibuja "Sin confirmar" en vez del número
     --->  botón "Resolver"  --->  Revisión
```

```
Campo del resumen que SÍ puede ser nulo (próximo pago, tarjeta)
     --->  se dibuja "Sin leer"  --->  "Completar perfil"
```

### R7 · Un usuario sin perfil ve "podés gastar 0,00 hoy" como si fuera un dato · **ROMPE** · severidad **media**

**Escenario.** Mato instala, sincroniza, y todavía no cargó sueldo ni día de
pago. El Resumen muestra **Safe to spend hoy: 0,00**. Leído literalmente: "no
podés gastar nada". El dato real es "todavía no sé".

**Por qué se rompe.** `server/src/strategy/balance.ts:151-154` — sin próximo
día de pago, `safeToSpendHoy` **devuelve 0**. Y `balance.ts:168` cierra con
`Math.max(0, ...)`, así que un resultado negativo **también** sale 0. El campo
es `number` en el contrato (`api/routes.ts:72`): nunca es nulo. P2 está
declarada **VIABLE sin huecos** en los tres documentos, y su estado "sin
perfil" no se auditó contra el motor.

**Corrección.** La tarjeta deriva su estado de un campo que sí distingue: si
`next_payday` es nulo, no hay safe-to-spend que mostrar. Es cliente puro, se
hace hoy, no necesita ninguna ruta nueva.

```
Resumen  --->  no hay próximo pago conocido
     --->  Safe to spend: "Sin dato — falta tu día de pago"
     --->  "Completar perfil"
```

### R8 · El Resumen sin estado de cuenta manda a una pantalla vacía · **LIMITACIÓN ACEPTABLE**

`api/routes.ts:70,74` — `card` y `card_status` son nulos mientras no haya
entrado un estado de cuenta. La tarjeta "Tarjeta" del Resumen navega a
Estrategia, y las cuatro tarjetas de Estrategia salen justamente de
`card_status`: la pantalla queda vacía. El catálogo de estados vacíos
(`flujo-app-prototipo.md:366-377`) define "P8 sin deudas" pero **no** "P8 sin
tarjeta".

**Se acepta** porque P8 no entra al MVP. Cuando entre, es un estado vacío más:
"todavía no leí un estado de cuenta" ---> Sincronización.

---

## Ataque a CU-4 — Sincronizar

### R9 · El estado "Corriendo" no sobrevive a un F5, y el 409 se auto-reintenta contra un lote largo · **ROMPE** · severidad **alta**

**Escenario.** Mato dispara el primer sync sobre años de correo. El lote tarda
minutos. Recarga la pestaña (o abre el panel en el teléfono, que es
literalmente el entregable de B1). El panel **no puede saber que hay un sync
corriendo**: se rehidrata en *A medias* con *Seguir* habilitado. Mato lo pulsa
y recibe un 409. Y el prototipo especifica que ante un 409 **"se reintenta
solo"** (`flujo-app-prototipo.md:201`): el panel entra en una ráfaga de
requests contra un lote que va a tardar minutos.

**Por qué se rompe.** `server/src/api/sync-route.ts:38` — la guarda es
`let running = false`, un booleano **en memoria del proceso**, y no se expone
en ninguna ruta. `server/src/api/routes.ts:213-228` — `GET /api/sync/status`
devuelve `last_sync_ts` y `backlog`, nada más. El plan afirma que "recargar la
página en medio de un backlog muestra el backlog, no un estado limpio falso"
(`panel-manejo-flujo.md:557-560`): es cierto para el **backlog** y falso para
**corriendo**, que son estados distintos del mismo botón.

**Corrección.** Dos líneas de server, en el mismo bloque B1 donde ya se toca
esa ruta para `batch_size`: `GET /api/sync/status` devuelve `running`. Y el 409
deja de auto-reintentar: pasa a consultar el estado cada 3 segundos, que es lo
que el flujo ya define para "corriendo".

```
F5 durante un lote  --->  el panel pregunta el estado  --->  "corriendo"
     --->  botón bloqueado + barra  --->  termina  --->  se refresca solo
```

```
409 "ya hay uno corriendo"  --->  aviso ámbar, botón bloqueado
     --->  consulto el estado cada 3 s  --->  terminó  --->  botón libre
```

### R10 · "Detener" no detiene, y el registro de lotes se pierde · **SÓLIDO**

Se atacó y **aguantó**: los dos huecos (H17, H18) están rotulados con
honestidad en el propio prototipo — *"se detiene al terminar este lote"* y
*"registro de esta sesión — se pierde al recargar"*. El código dice exactamente
eso: `server/src/sync/run-sync.ts:163` escribe el progreso **una vez por lote,
al final**, y `:158-159` lo limpia al completar. La barra a saltos que el
prototipo dibuja es la barra que el motor puede alimentar. No hay nada que
corregir: hay que **no** dibujar una barra continua.

### R11 · Un backlog abandonado se queda "a medias" para siempre · **LIMITACIÓN ACEPTABLE**

`web/src/lib/freshness.ts:24` — un backlog pendiente gana sobre la fecha. Si
Mato pulsa *Detener* y no vuelve en dos semanas, el chip sigue diciendo "a
medias" y **nunca** dice "atrasado", que es la información que le serviría.

**Se acepta**: el rótulo del chip ya incluye el conteo pendiente, así que la
información no se pierde. Corrección barata cuando moleste: si el backlog no
avanzó en más de 24 h, el chip dice "a medias, sin avanzar desde hace X".

---

## Ataque a CU-5 — La cola de revisión

Este es el camino que más se rompió. Cuatro hallazgos, tres de ellos ROMPE.

### R12 · Descartar **no** mueve el saldo, y el flujo promete que sí · **ROMPE** · severidad **alta**

**Escenario.** La cola tiene 3 filas. Mato las descarta a las tres (es la
salida correcta para un correo que no era un movimiento). El contador llega a
cero, la pantalla celebra "nada pendiente", vuelve al Resumen — **y el saldo
es exactamente el mismo que antes**. El flujo le prometió que iba a cambiar:
*"el total de P2 tiene que verse cambiado, ése es el punto de la pantalla"*
(`panel-manejo-flujo.md:255-257`), y el prototipo dibuja el antes y el después
con dos cifras distintas (`flujo-app-prototipo.md:223-227`).

**Por qué se rompe.** `server/src/strategy/totals.ts:19-20` — la cláusula que
todo agregado de plata comparte excluye `needs_review = 1` **y también**
`is_discarded = 1`. Y `server/src/review/resolve.ts:177` — `discard` pone
`needs_review = 0` **y `is_discarded = 1`**. O sea: la fila sale de la cola
pero **sigue fuera de los totales**. De las tres acciones, sólo *Confirmar* y
*Corregir* mueven el número; *Descartar* no, por diseño y con razón.

**Corrección.** La pantalla dice, por acción, qué va a pasar con el total. Es
texto, no backend.

```
"Confirmar monto"  --->  "entra a tus totales"      --->  el saldo cambia
"Corregir monto"   --->  "entra con el monto que pongas"  --->  el saldo cambia
"Descartar"        --->  "no era un movimiento: queda fuera de los totales"
                                                     --->  el saldo NO cambia
```

```
Vacío la cola sólo con descartes  --->  Resumen
     --->  "3 movimientos descartados, el saldo no cambia"  --->  sin sorpresa
```

### R13 · Resolver la misma fila desde dos pestañas devuelve "éxito" y el rastro auditable queda mudo · **ROMPE** · severidad **alta**

**Escenario.** Mato resuelve una fila en el teléfono. La pestaña del escritorio
sigue abierta con la cola vieja (el reloj refresca cada 30 segundos). Pulsa
*Confirmar* sobre esa misma fila. **Recibe un 200 OK.** La tarjeta se colapsa
como resuelta, el contador baja — y en el motor no pasó nada.

**Por qué se rompe.** `server/src/review/resolve.ts:150` devuelve
`{ok: true, changed: false, reason: "already_resolved"}` para una fila ya
resuelta, y sale **antes** del `INSERT` en `review_resolutions`.
`server/src/api/routes.ts:184-188` — sólo `not_found` es 404; un resultado
`ok: true` se serializa con **200**. El flujo previó otra cosa: su camino de
error dice *"`not_found` → 404 → esta fila ya no está en la cola, refrescá"*
(`flujo-app-prototipo.md:230`). Ese 404 **nunca va a llegar** en el caso que la
propia frase describe. El resultado no es sólo un contador mal: es que la
segunda resolución **no deja rastro**, y el rastro auditable es la razón de ser
de la pantalla.

**Corrección.** El panel ramifica por `changed`, que ya viene en la respuesta.
`changed: false` **no es éxito**.

```
"Confirmar"  --->  respuesta con changed = false
     --->  "esta fila ya la resolviste en otro lado"
     --->  se refresca la cola  --->  Revisión con la cola real
```

### R14 · "Confirmar monto" está garantizado a fallar en una compra en otra moneda, y la pantalla no dice qué hacer · **ROMPE** · severidad **media**

**Escenario.** Entra una compra en otra moneda. El parser la manda a revisión a
propósito. Mato abre la cola, ve las tres acciones de siempre, pulsa la más
obvia — *Confirmar monto* — y recibe un error. Vuelve a intentar. Mismo error.
**No hay nada en la pantalla que le diga cuál es la salida.**

**Por qué se rompe.** `server/src/review/resolve.ts:161-163` rechaza `confirm`
cuando la moneda de la fila no es la del perfil, y devuelve `foreign_currency`
— un 400 (`api/routes.ts:185`). El motor tiene razón: los totales suman sin
convertir, y confirmar metería el número crudo. Pero el diseño dibuja las tres
acciones **iguales en toda tarjeta** (`flujo-app-prototipo.md:1167-1169`) y
traduce el error como un genérico *"el motor rechazó esto, y por qué"*. La
salida real —*Corregir* con el equivalente convertido, o *Descartar*— no está
escrita en ningún lado del flujo.

**Corrección.** Una variante más de la tarjeta de revisión. **No necesita
backend**: la moneda de la fila ya viene en la respuesta de la cola.

```
Fila en otra moneda  --->  "Confirmar" deshabilitado:
     "no se puede confirmar un monto en otra moneda"
     --->  "Corregir": "poné el equivalente en tu moneda"
     --->  o "Descartar"  --->  cola N−1
```

### R15 · La cola y el rastro se piden enteros, sin tope · **LIMITACIÓN ACEPTABLE**

`server/src/api/queries.ts:82-83` — la cola se pide sin `LIMIT`.
`server/src/api/routes.ts:193-196` — el rastro de resoluciones, tampoco. Hoy
son 4 filas y 50 resoluciones: irrelevante. En un primer sync de años de
correo, la cola puede traer cientos de filas en una sola respuesta, y el rastro
crece sin techo.

**Se acepta** para un usuario y este volumen, con dos condiciones escritas: el
rastro se corta en el cliente (mostrar las últimas 20, "ver más"), y el día que
la cola pase de ~200 filas se agrega paginación a esa ruta.

### R16 · En modo demostración, resolver no hace nada · **LIMITACIÓN ACEPTABLE**

`web/src/demo/demoFetch.ts:159-191` — el modo demo cubre **ocho** rutas.
`POST /api/review/:id/resolve`, `GET /api/review/resolutions` y `GET /api/brief`
caen en el 404 final. La fase 0 del plan promete que "Mato ve y **opera** la
interfaz completa" con datos inventados: hoy, en demo, el bucle entero de la
revisión y la narrativa del día del Resumen no funcionan.

**Se acepta** porque es agregar objetos literales a un archivo que existe —
pero hay que **decirlo en el plan de B1/B2 como trabajo**, no darlo por hecho.

---

## Ataque a CU-6 — Movimientos

### R17 · Paginar mientras corre un sync repite o saltea filas · **LIMITACIÓN ACEPTABLE**

`server/src/api/queries.ts:73-78` — la lista es `ORDER BY ts DESC LIMIT/OFFSET`.
Si un lote inserta filas mientras Mato está en la página 2, las filas se corren
y ve repetidos o se saltea alguno.

**Se acepta**: el sync es manual, es un usuario, y el flujo ya manda refrescar
al terminar un lote (lo que reinicia la paginación, que es el comportamiento
correcto). Corrección cuando moleste: paginar por cursor en vez de por
desplazamiento.

### R18 · Los huecos conocidos de la tabla siguen siendo ciertos · **SÓLIDO**

Se verificó y **aguanta lo que el diseño ya declara**: no hay total de
coincidencias (`api/routes.ts:148` devuelve `count: rows.length`, el tamaño de
la página) ni filtro por categoría (`api/schemas.ts:33-44` no lo acepta). El
prototipo los dibuja deshabilitados con su motivo, que es la decisión correcta.
El límite por defecto es 100 y el techo 500 (`schemas.ts:39`), coherente con lo
que el diseño paginaría.

---

## Ataque a CU-7 — Reglas

### R19 · El gráfico del Resumen es del **mes en curso**: aplicar una regla al historial puede no moverlo · **ROMPE** · severidad **alta**

**Escenario.** Es el flujo estrella de B3, el bloque que el plan preparatorio
subió de prioridad por las 206 filas sin categoría. Mato crea una regla, ve
"matchea 7 movimientos", aplica al historial, vuelve al Resumen — **y el
gráfico está igual**. El flujo le prometió lo contrario:
*"volver a P2 ---> el `SpendingChart` refleja la categoría nueva"*
(`flujo-app-prototipo.md:302`).

**Por qué se rompe.** `server/src/api/routes.ts:91,111` — el gasto por
categoría del resumen se calcula con `localMonthRange(now)`: **sólo el mes en
curso**. Las 206 filas sin categoría están repartidas en ocho meses. Si el
comercio de la regla no tuvo movimientos **este mes**, reclasificar el
historial entero no mueve una sola barra del gráfico. Y se suma la trampa que
la memoria del proyecto ya registró: la clasificación corta en las
transferencias, así que ni siquiera todas las filas del mes en curso se mueven.

**Corrección.** El efecto se muestra **donde ocurrió**, no en un gráfico que
mira otro rango.

```
"Aplicar al historial"  --->  "se reclasificaron 7 movimientos,
     1 de ellos de este mes"
     --->  "Ver los 7"  --->  Movimientos, filtrado, con la categoría nueva
     --->  Resumen (el gráfico cambia sólo si hubo filas de este mes, y se dice)
```

### R20 · La previsualización puede quedar vieja entre "ver" y "aplicar" · **LIMITACIÓN ACEPTABLE**

El flujo previsualiza ("se reclasificarían 7") y después escribe. Si entre las
dos cosas entra un lote de sync, el número escrito no es el previsualizado.

**Se acepta** con una regla de presentación: la pantalla muestra **el número
que devolvió el aplicar**, no el que mostró la previsualización. Si difieren,
lo dice.

### R21 · El contador en vivo, con rebote, contra una ruta sin llave · **LIMITACIÓN ACEPTABLE**

El contador de coincidencias consulta mientras se teclea, con rebote de 300 ms.
Es la defensa contra la trampa del patrón demasiado largo y **hay que
construirlo**. Con B0 ya montado, cada consulta lleva credencial y va al server
de Mato: el costo es despreciable. **Se acepta tal cual**, con la condición de
que el rebote esté y que una consulta en vuelo se cancele al teclear la
siguiente.

---

## Ataque a CU-8 — Chat (conceptual)

### R22 · El contexto de origen no cabe en el mensaje, y el flujo lo dibuja removible · **ROMPE** · severidad **media** (bloquea sólo la fase del chat)

**Escenario.** Mato abre el chat desde una fila y ve el chip "Sobre: Comercio A
· 12 sep · −45,00". El flujo dice que ese chip es **removible**
(`flujo-app-prototipo.md:239`). Lo remueve después de mandar el mensaje. No
pasa nada: el contexto ya viajó adentro del texto.

**Por qué se rompe.** `server/src/api/chat-route.ts:64` — el cuerpo aceptado es
`{message}` y nada más. La recomendación del roadmap (concatenar el contexto en
el texto) es correcta y barata, pero **vuelve el chip no removible después del
envío**: el contexto deja de ser un dato aparte y pasa a ser parte del mensaje.

**Corrección.** El chip es removible **antes** de enviar, no después. Y una vez
enviado, el mensaje que se muestra **incluye el contexto tal cual** — el
usuario ve exactamente lo que ve el agente, que es la propiedad que hace
honesta la solución.

```
Fila  --->  cajón con el chip  --->  quito el chip (antes de enviar)
     --->  escribo  --->  envío  --->  el mensaje muestra el contexto tal cual
```

### R23 · El agente propone y no ejecuta · **SÓLIDO**

Se atacó buscando un camino en el que el chat escriba algo, y **no existe**.
El mapa de enlaces completo (`flujo-app-prototipo.md` §4.4) no tiene ninguna
flecha del chat a una escritura: la propuesta navega a la pantalla que la
confirma, precargada. Y el server lo respalda: las herramientas del chat son de
lectura. Además, el riesgo obvio —que una propuesta lleve a una pantalla que
todavía no existe— **ya está previsto** por escrito
(`panel-roadmap-implementacion.md:182-188`: el patrón de propuesta no se
construye hasta que su destino exista). Es la pieza mejor razonada del flujo.

### R24 · Cerrar el cajón y volver al mismo scroll y filtros · **SÓLIDO**

Es estado de cliente puro. No depende de ninguna ruta, ningún dato y ningún
hueco. Aguanta cualquier ataque de backend porque no toca el backend.

---

## Ataque a CU-9 y CU-10 — Estrategia y Ahorro

### R25 · El anillo del colchón de un usuario nuevo dice "financiado" · **ROMPE** · severidad **media**

**Escenario.** Mato todavía no fijó un objetivo de colchón. La pantalla de
Ahorro muestra el anillo **completo, en verde, "financiado"**. El flujo pide
justo lo contrario para ese caso: *"P9 sin objetivo de colchón: anillo gris +
Fijar objetivo, sin cifra de ejemplo"* (`flujo-app-prototipo.md:376`).

**Por qué se rompe.** `server/src/strategy/balance.ts:66-83` — sin
configuración, el objetivo es 0, lo reservado es 0, y `financiado` se calcula
como `reservado >= objetivo`: **0 ≥ 0 es verdadero**. La respuesta de "no fijé
objetivo" es idéntica, campo por campo, a la de "cumplí mi objetivo".

**Corrección.** La pantalla trata el objetivo en cero como "sin fijar" e ignora
`financiado` en ese caso. Cliente puro. Y, mientras la ruta de perfil no exista
(no está en el MVP), *Fijar objetivo* se dibuja **deshabilitado con su motivo**
— hoy el prototipo lo dibuja **activo** (`flujo-app-prototipo.md:402`), contra
la regla de no dibujar botones sin respaldo.

```
Ahorro  --->  objetivo en cero  --->  anillo gris: "todavía no fijaste objetivo"
     --->  "Fijar objetivo" deshabilitado: "necesita la pantalla de perfil"
```

### R26 · La lista de deudas no tiene de dónde salir, y el botón que la usa sí existe · **LIMITACIÓN ACEPTABLE**

Es el hueco H11, ya documentado: se puede marcar una deuda pagada por
identificador y no hay ninguna forma de conocer los identificadores.

**Se acepta** porque Estrategia no entra al MVP. Cuando entre, la ruta de
listado es trabajo chico sobre funciones que ya existen. Lo que **no** puede
pasar es que P8 se construya con el botón dibujado y la lista inventada.

---

## Ataque a CU-12 — Los tres retornos al hogar

El flujo promete tres veces que **el efecto se ve al volver**. Atacados uno por
uno: **los tres fallan en al menos un caso**, y ya están cubiertos arriba.

```
Vacío la cola  --->  Resumen  --->  el saldo cambia ... salvo si descarté (R12)
Aplico regla   --->  Resumen  --->  el gráfico cambia ... salvo otro mes (R19)
Fijo objetivo  --->  Resumen  --->  el colchón cambia ... si existe la ruta (R25)
```

La corrección de fondo es la misma para los tres y vale escribirla como
principio: **si la pantalla promete un efecto, tiene que poder decir cuándo el
efecto es cero y por qué.** "No cambió nada" es un resultado legítimo; "no
cambió nada y la pantalla decía que iba a cambiar" es un error de producto.

---

## Ataque a CU-13 — Los caminos alternos

### R27 · Tres fallos distintos se ven exactamente iguales · **LIMITACIÓN ACEPTABLE**

Servidor caído, origen no permitido por CORS y credencial rechazada en el
preflight producen, los tres, el mismo error de red en el navegador. El panel
va a mostrar el cartel de desconexión y Mato va a buscar un problema de red
donde hay uno de configuración.

**Se acepta** porque el navegador no da más información, **con la mitigación
que sí es derivable**: `/api/health` es la única ruta sin llave. Si health
responde y el resto no, la causa es credencial u origen, no red. Eso es un
diagnóstico de dos líneas y ya tiene su lugar en el flujo (*Probar conexión*).

### R28 · La franja de revisión no cerrable, con 4 filas · **SÓLIDO** (ya corregido)

El flujo original pedía una franja **persistente y no cerrable** en toda
pantalla. El plan preparatorio lo atacó con datos (4 filas de 1.159, 0,35 %) y
lo bajó a aviso cerrable. **La corrección ya está tomada** y este ataque la
confirma: un cartel permanente por el 0,35 % del ledger entrena al usuario a
ignorar los avisos, que es el peor resultado posible para el aviso que sí
importe algún día.

### R29 · El foco y el teclado en el cajón de chat · **LIMITACIÓN ACEPTABLE**

El flujo define el foco al entrar a la cola de revisión y el cierre con Escape
en el cajón, pero no dice **a dónde vuelve el foco** al cerrar el cajón ni si
el cajón lo atrapa mientras está abierto. Sin eso, quien navega con teclado
sigue tabulando sobre la pantalla de atrás.

**Se acepta como pendiente de definición**, con la regla escrita para cuando se
construya: el cajón atrapa el foco, Escape lo cierra, y el foco vuelve al
elemento que lo abrió.

---

## Ataque transversal — El dispositivo

### R30 · El entregable de B1 es el teléfono y el diseño es de escritorio · **ROMPE** · severidad **media**

**Escenario.** B1 se declara terminado. Su entregable, textual, es *"Mato ve su
saldo real desde el teléfono y sincroniza"*
(`panel-prep-implementacion.md:453`). Abre el panel en el teléfono y la barra
de navegación —cinco ítems, chip de sincronización, ícono de chat y engranaje—
no entra en 375 píxeles.

**Por qué se rompe.** El flujo lo dice con todas las letras: *"El prototipo es
de escritorio. La adaptación a pantalla chica se documenta cuando se decida"*
(`flujo-app-prototipo.md:1298-1299`). Ninguna de las 19 tarjetas del design
system tiene variante chica. No es un bug: es que **el criterio de terminado de
B1 no se puede verificar** con lo que el diseño aprobado entrega.

**Corrección.** Una de las dos, y hay que elegir antes de empezar:

```
Opción A  --->  B1 incluye el diseño chico de Resumen y del chip de sync
          --->  el entregable "desde el teléfono" se puede verificar
```

```
Opción B  --->  el entregable de B1 se reescribe como escritorio
          --->  el teléfono pasa a ser un bloque propio, después del MVP
```

**Recomendación: A, y sólo para las dos piezas de B1.** El Resumen es
justamente la pantalla que se mira desde el teléfono; la tabla de movimientos
y el editor de reglas no.

---

# Veredicto final

## Lo que aguantó el ataque (no se toca)

1. **El agente propone y no ejecuta.** No existe ningún camino donde el chat
   escriba. La invariante del onboarding aplicada al chat es la mejor decisión
   del flujo, y el server la respalda.
2. **El ciclo "una llamada drena un lote".** El flujo dibuja exactamente lo que
   el motor puede hacer: barra a saltos, *Seguir*, *Detener* que dice la verdad
   más chica. No hay maquillaje.
3. **Cerrar el chat y volver al mismo scroll y filtros.** Cliente puro, sin
   superficie de ataque.
4. **No construir "rehacer el ledger" ni "mandar a revisión" a mano.** Se
   sostiene, y R1 la refuerza: mientras un enlace pueda repuntar el panel, un
   endpoint destructivo sería peor todavía.
5. **La franja de revisión bajada a aviso cerrable.** Corrección ya tomada, y
   este ataque la confirma con el mismo dato.
6. **Los huecos conocidos de la tabla de movimientos, dibujados
   deshabilitados.** Se verificaron contra el código y siguen siendo ciertos:
   el prototipo no promete lo que la API no da.

## Hay que corregir ANTES de la fase visual

Por severidad. Las tres primeras son **bloqueantes de bloque**: sin ellas, el
bloque que las contiene no puede darse por terminado.

| # | Qué | Bloque | Costo |
|---|---|---|---|
| **R1** | La credencial no puede viajar a un backend elegido por un enlace | **B0** | lista blanca de orígenes + confirmar `?api=` |
| **R2** | El CORS no acepta `Authorization` ni `DELETE`: el panel publicado no carga | **B0** | dos líneas en `cors.ts` + test |
| **R4** | *Completar perfil* e *Ir a Configuración* apuntan a pantallas que el MVP no construye | **B1** | texto desplegable en vez de navegación |
| **R6** | "Sin leer" no existe: el motor escribe 0, y cuatro pantallas lo dan por sentado | **B1, B2** | reescribir el criterio a `needs_review`, en los 4 docs |
| **R9** | El estado "corriendo" no sobrevive a un F5, y el 409 se auto-reintenta | **B1** | `running` en el estado del sync + no reintentar |
| **R12** | *Descartar* no mueve el saldo y la pantalla promete que sí | **B2** | texto por acción |
| **R13** | Resolver dos veces devuelve 200 y no deja rastro | **B2** | ramificar por `changed` |
| **R14** | *Confirmar* falla siempre en otra moneda y no hay salida escrita | **B2** | una variante de tarjeta, sin backend |
| **R19** | El gráfico del Resumen es del mes en curso: aplicar una regla puede no moverlo | **B3** | mostrar el efecto donde ocurrió |
| **R7** | "Podés gastar 0,00 hoy" cuando el dato es "todavía no sé" | **B1** | derivar de `next_payday` |
| **R25** | El colchón sin objetivo se dibuja "financiado" | (post-MVP) | tratar objetivo 0 como sin fijar |
| **R30** | B1 promete el teléfono y el diseño es de escritorio | **B1** | diseñar chico el Resumen y el chip |
| **R22** | El chip de contexto del chat no es removible después de enviar | (fase chat) | removible antes, visible después |

**Ninguna de estas correcciones necesita tocar el pipeline de ingesta.** Diez
de las trece son de diseño o de cliente y no tocan el server. Las dos
bloqueantes de B0 son dos líneas de CORS y una lista blanca en el cliente.

## Se aceptan como limitación conocida (documentadas, rotuladas en pantalla)

- **R5** — el retorno al perfil cuelga sólo de la tarjeta "Próximo pago".
- **R8** — el Resumen sin estado de cuenta manda a una Estrategia vacía.
- **R11** — un backlog abandonado se queda "a medias" y nunca dice "atrasado".
- **R15** — la cola y el rastro se piden enteros; se cortan en el cliente.
- **R16** — el modo demostración no cubre resolver ni el brief; es trabajo de
  B1/B2, no un hecho consumado.
- **R17** — paginar durante un sync repite o saltea filas.
- **R20** — la previsualización puede quedar vieja; se muestra el número
  aplicado, no el previsualizado.
- **R21** — el contador en vivo consulta al teclear; con rebote y cancelación.
- **R26** — no hay lista de deudas; Estrategia no entra al MVP.
- **R27** — tres fallos distintos se ven iguales; se distinguen con
  *Probar conexión*.
- **R29** — el foco del cajón de chat sin definir; se define al construirlo.

## El principio que resume todo el ataque

Los trece ROMPE caen en **tres familias**, y las tres se corrigen con la
misma disciplina:

1. **La pantalla promete un efecto que a veces es cero** (R12, R19, R25, R7).
   Corrección: si prometés un cambio, tenés que poder decir cuándo no lo hubo
   y por qué.
2. **El camino termina en algo que no existe** (R4, R2, R1). Corrección: un
   destino que no existe no es un enlace, es texto.
3. **El estado real del motor tiene más casos que el diseño** (R6, R9, R13,
   R14, R22). Corrección: los estados se derivan del dato que el motor sí
   devuelve —`needs_review`, `changed`, `currency`, `running`— y no de uno que
   sería cómodo que devolviera.

**R30 queda aparte**: no es una familia, es un criterio de terminado que hoy no
se puede verificar. Hay que elegir cuál de las dos opciones vale antes de
empezar B1, no después.

---

Ver también: `docs/flujo-app-prototipo.md` (el recorrido clickeable que este
doc ataca), `docs/panel-manejo-flujo.md` (el plan funcional),
`docs/panel-viabilidad.md` (los 26 huecos H1..H26),
`docs/panel-prep-implementacion.md` (el wargaming del roadmap y el plan
B0..B3), `docs/panel-roadmap-implementacion.md` (el roadmap de seis fases).
