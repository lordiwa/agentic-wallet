/**
 * The exclusion clause every money aggregate in this package applies to
 * `transactions` (spec §9.9 + the F2-B review CONSTRAINTS this ticket
 * inherited): never an internal transfer, never a charge that was reversed,
 * never a row still pending human review, and never a reverso audit row
 * itself -- a paired reversal is persisted as an auditable `direction:'in'`
 * row (its matched consumo already carries `is_reversed=1`); counting the
 * reverso row too would double the correction into a phantom credit. This is
 * a single shared clause so every aggregate (balanceActual, tarjetaStatus's
 * new-charges sum, transferenciasMes, spending_by_category, the essential-
 * spend average behind safeToSpendHoy) excludes the same rows the same way.
 */
export const EXCLUDE_FROM_TOTALS_SQL = "is_internal = 0 AND is_reversed = 0 AND needs_review = 0 AND type != 'reverso'";
