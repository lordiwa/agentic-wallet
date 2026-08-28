/**
 * Cents-safe money helpers (spec §9.9: "cents-safe (Math.round(x*100), sin
 * float ==)"). Every aggregate in this package accumulates in integer cents
 * and converts back to a USD number only at the boundary, so repeated
 * addition/subtraction across many transactions never drifts the way plain
 * floating-point dollar arithmetic would.
 */

/** USD amount -> integer cents, rounded (never truncated) to absorb float noise. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Integer cents -> USD amount. */
export function fromCents(cents: number): number {
  return cents / 100;
}
