# Transferencias internas: el titular a sí mismo

**Decisión:** una transferencia donde el titular es **las dos partes** es un
movimiento **interno** (`is_internal = 1`). No es gasto y **no es ingreso**:
queda fuera de todos los totales, en los dos sentidos.

Implementado en `server/src/rules/reconcile.ts` (regla 3). Fijado por tests en
`reconcile.test.ts` y `strategy/balance.test.ts`.

---

## El agujero que cerró

La regla 3 existía desde el principio, pero miraba **un solo sentido**:

```ts
if (tx.type !== "transferencia" || !tx.counterparty) return false;
```

`type: 'transferencia'` es siempre `direction: 'out'` — la transferencia que el
usuario **envía**. Con eso alcanzaba mientras el único correo que el parser
sabía leer para un movimiento propio fuera el de salida.

La bandeja real mostró el otro lado. La variante **§4.4b** del formato
Produbanco (ver [`formato-correos-produbanco.md`](formato-correos-produbanco.md))
notifica el **mismo** movimiento desde el lado que recibe:

```
Transacción: Transferencia recibida desde Produbanco
Enviada por: <EL TITULAR>
Banco Contacto: <BANCO>
Cuenta Contacto: XXXXX54321      <- otra cuenta del propio titular
Monto: $7.50
```

El parser lo clasifica `type: 'recibido'`, `direction: 'in'` — y hace bien: el
correo es, literalmente, una transferencia recibida. Pero el hecho económico no
es un ingreso: es la misma plata cambiando de cuenta. Como `recibido` no estaba
en el gate de la regla 3, esas filas **sumaban al saldo** plata que nunca entró
desde afuera.

En la bandeja real son **24 correos** (contra 39 de la plantilla §4.4, que sí
son transferencias de terceros).

## La regla, hoy

```ts
const TRANSFER_LIKE_TYPES = new Set(["transferencia", "recibido"]);
```

Un movimiento es interno cuando se cumplen las tres:

1. `type` está en `TRANSFER_LIKE_TYPES`;
2. tiene `counterparty`;
3. esa contraparte **es el titular**, según `isSameHolder` — comparación por
   conjunto de tokens, tolerante a mayúsculas, tildes, orden de nombres y
   anotaciones entre paréntesis, con un umbral de 3 tokens compartidos.

El titular sale de `strategy_config.titular`, o sea de lo que el usuario
confirmó en el onboarding. **Sin titular configurado no se marca nada** — no hay
contra qué comparar, y marcar por parecido sería inventar.

## Qué quedó deliberadamente afuera

| Tipo | ¿Por qué no? |
|---|---|
| `sueldo` | También es `direction: 'in'`, pero lo paga un empleador, no una cuenta propia. Si el nombre del empleador llegara a parecerse al del titular, marcarlo borraría el ingreso más grande del ledger. |
| `debito`, `servicio`, `retiro`, `recarga` | La contraparte es un comercio. Un comercio homónimo del titular no convierte un gasto real en un movimiento interno. |
| `reverso` | Ya está excluido de los totales por `type != 'reverso'`. |

Y el umbral de 3 tokens se queda como estaba: el contraejemplo que lo fija es un
familiar que comparte los dos apellidos con el titular y cuyas transferencias
**sí** son gasto real.

## Por qué `is_internal` sólo se enciende

`category/reclassify.ts` nunca apaga la bandera (invariante 2 de ese módulo).
La regla ve nombres; no puede ver una etiqueta puesta a mano sobre un movimiento
entre cuentas propias que el banco no nombró. Apagarlas devolvería esos
movimientos a los totales como si fueran plata que salió del bolsillo.

Consecuencia práctica: un falso positivo de esta regla **no se corrige solo**.
Por eso el umbral es conservador y por eso `sueldo` no entra.

## El historial ya sincronizado

`insertTransaction` es insert-only, así que cambiar la regla no re-etiqueta lo
que ya está en la base. El camino es el que ya existe:

```bash
npm run onboard -- --reclassify        # o la tool MCP `apply_rules {reclassify: true}`
```

que recalcula `is_internal` sobre todas las filas con el titular del perfil.

Caso borde real de esta instalación: las filas §4.4b que entraron **antes** del
fix del parser (commit `1ba67a1`) quedaron con `counterparty = NULL`, y sin
contraparte ninguna comparación de nombres puede decidir nada. Para ésas el
orden es `heal_counterparties` (relee el correo original y recupera el nombre)
y **después** `apply_rules {reclassify: true}`. No hay backfill de datos: el
nombre lo vuelve a leer el parser del correo real.
