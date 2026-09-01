# Naming — candidatos de marca para el agente

Sesión de generación de nombres para el producto (hoy `agentic-wallet`).
Esto es material de decisión, no una decisión tomada.

## El brief

- Un **agente/robot del futuro** que ordena tus finanzas y te ayuda a ahorrar.
- Isotipo: un personaje robot dentro del cuadrado clásico de app.
- Tono: **amor efectivo** — te quiere pero te pone en orden. Afectivo y severo.
- **Nombre-personaje** tipo Shazam (lo llamás y aparece), no un concepto frío
  de banco.
- **Bisilábico**, sonoro, "de perrito". Bilingüe ES/EN.
- Descartados por Mato: Nexa, Robby, Amaru, Villullo.

## Cómo se verificó la disponibilidad

| TLD | Fuente | ¿Confiable? |
|---|---|---|
| `.com` | RDAP de Verisign (registro autoritativo) | Sí |
| `.app` `.dev` `.bot` | RDAP vía `rdap.org` | Sí — validado con controles |
| `.io` | — | **No.** `rdap.org` devuelve falso "libre" incluso para `github.io` y `google.io`. Todo resultado `.io` de esta sesión queda **no verificado**. |

Criterio: HTTP 404 en RDAP = no registrado; HTTP 200 = registrado. La
resolución DNS **no** se usó como criterio: de 90 dominios registrados, 6 no
resolvían (registrados sin nameservers), así que DNS solo habría dado falsos
positivos.

Total verificado: 90 `.com` cortos + 24 `.com` compuestos + 56 en `.app`/`.dev`/`.bot`.

## Los 20 candidatos

Agrupados por la palanca que tira cada uno.

**Sonido de dinero** (la caja registradora, la moneda que cae)

1. **Kachín** — cha-ching en español. El sonido de la venta cerrada.
2. **Chinchi** — del brindis chin-chin y el tintineo de monedas.
3. **Klinki** — de *clink*, la moneda que cae en la lata.

**Contar / número**

4. **Numi** — de número / *number*.
5. **Sumi** — de sumar / *sum*.
6. **Kento** — cuenta + *count*.
7. **Cento** — cent / centavo / ciento.
8. **Bako** — del ábaco, la primera calculadora.
9. **Bito** — el bit, unidad mínima de dato.

**Verbo en primera persona** (el agente hablándote)

10. **Guardo** — "yo guardo tu plata". Suena además a nombre propio.
11. **Rindo** — "me rinde la plata".

**Raíz andina de contabilidad** (alma hispanohablante, literal)

12. **Yupa** — de *yupana*, el ábaco inca, y *yupay*, "contar" en quechua.
13. **Kipu** — el *khipu*, el sistema contable inca de nudos: registro y memoria.
14. **Chaski** — el mensajero inca; el que te trae la noticia y no la endulza.

**Nombre de mascota puro**

15. **Tino** — "tener tino": criterio, sensatez, mano justa.
16. **Fido** — del latín *fido*, "confío"; y el nombre de perro por antonomasia.
17. **Guri** — "gurí", el pibe rioplatense.
18. **Tuki** — puro ritmo, sin semántica. Se pega.
19. **Moni** — money / "moni".
20. **Zeni** — *zeni* (dinero) + zen: la calma de tener las cuentas claras.

## Top 5

**1. Kachín** — El más fuerte. Es literalmente el "cha-ching" que Mato citó,
pero escrito en español y convertido en nombre propio. Onomatopeya universal:
un anglo lo lee y oye la caja registradora; un hispanohablante lo lee y lo
pronuncia bien a la primera. Dos sílabas, acento final, se grita. Y **es el
único finalista con el paquete de dominios entero disponible.**

**2. Tino** — El que mejor captura "amor efectivo". *Tener tino* es exactamente
la promesa del producto: criterio, mano justa, ni tacaño ni derrochón. Cariñoso
en español, y en inglés es un nombre propio corto y simpático. Su problema es
de inventario: todo lo bueno está tomado.

**3. Yupa** — El concepto más rico. *Yupana* es el ábaco inca y *yupay* es
"contar": tecnología, números y alma hispanohablante en cuatro letras. Suena a
mascota y no significa nada raro en inglés. Riesgo: casi nadie va a captar la
referencia sin que se la cuenten.

**4. Guardo** — El único que es una frase. El agente se presenta hablando en
primera persona: *yo guardo*. Ahorro, custodia y cuidado en una palabra, y
suena a nombre propio germánico. Tres sílabas al límite del brief, y en inglés
se pronuncia bien pero pierde el significado.

**5. Chaski** — El mensajero inca que corría a llevar la noticia. Encaja con un
agente que te avisa: te trae el dato, te guste o no. Sonoro, dos sílabas,
bilingüe. Menos "finanzas" que los demás — es mensajería, no contabilidad.

## Tabla final

| Nombre | Concepto | `.com` exacto | Mejor dominio libre | Por qué encaja |
|---|---|---|---|---|
| **Kachín** | El cha-ching de la caja registradora, en español | Tomado | **`kachin.app`** y **`kachin.bot`** libres; `kachinapp.com`, `kachinai.com`, `holakachin.com`, `soykachin.com`, `kachinbot.com` libres | Onomatopeya que funciona igual en los dos idiomas; se grita como se llama a un perro |
| **Tino** | "Tener tino": criterio y mano justa con la plata | Tomado | `holatino.com` libre (`.app`/`.dev`/`.bot` tomados) | Es el amor efectivo hecho palabra: te quiere y te ordena |
| **Yupa** | *Yupana*, el ábaco inca; *yupay*, contar en quechua | Tomado | **`yupa.bot`** libre; `holayupa.com`, `yupaai.com`, `yupabot.com` libres | Números y tecnología con raíz hispanoamericana, y suena a mascota |
| **Guardo** | "Yo guardo tu plata" — el agente en primera persona | Tomado | **`guardo.bot`** libre; `holaguardo.com`, `guardoapp.com` libres | Ahorro y custodia en una palabra que además es nombre propio |
| **Chaski** | El mensajero inca que corre a traerte la noticia | Tomado | **`chaski.bot`** libre; `holachaski.com` libre | Un agente que te avisa, sin endulzar el dato |
| Numi | Número / *number* | Tomado | `holanumi.com` libre (`.app`/`.dev`/`.bot` tomados) | Directo al grano, cariñoso y corto |
| Kipu | El *khipu*, contabilidad inca de nudos | Tomado | `holakipu.com` libre (`.app`/`.dev`/`.bot` tomados) | Registro y memoria — pero ver riesgo de marca |
| Zeni | *Zeni* (dinero) + zen | Tomado | `zeni.bot` libre | La calma de tener las cuentas claras |
| Bito | El bit, unidad mínima de dato | Tomado | `bito.bot` libre | Lo más chico que se puede contar |
| Chinchi | Chin-chin: brindis y monedas | Tomado | `chinchi.bot` libre | Celebratorio, sonoro, muy pegadizo |

## Riesgos de marca a chequear antes de decidir

No verificados en esta sesión — requieren búsqueda en INPI/USPTO, no una
consulta DNS:

- **Kipu / Khipu** — hay una fintech chilena llamada Khipu. Colisión directa de
  rubro. Es la razón principal para no subirlo al top 5.
- **Moni** — fintech argentina con ese nombre.
- **Fido** — operadora de telecomunicaciones canadiense.
- **Zeni** — hay software de contabilidad con ese nombre.
- **Numi** — marca de té.

## Nota sobre el `.com`

Se verificaron 90 `.com` cortos y pronunciables: **los 90 están registrados.**
El inventario de `.com` de 4 a 7 letras está agotado hace años; hasta invenciones
como `kachiro`, `turibo` o `blipo` están tomadas. Exigir el `.com` exacto no
filtra nombres malos, filtra *todos* los nombres.

El nombre no muere porque el `.com` exacto esté tomado — es lo normal hoy:
Cash App vive en `cash.app`, Linear en `linear.app`, Notion arrancó en
`notion.so`. Para un agente que se invoca por nombre, `.app` o `.bot` incluso
comunican mejor que `.com`.

Si el `.com` es innegociable, el camino es `holaX.com` / `soyX.com` / `Xapp.com`,
todos libres para los finalistas.
