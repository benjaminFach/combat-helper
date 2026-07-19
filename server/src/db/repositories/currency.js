/**
 * Party currency: one singleton row holding the five D&D 5e coin
 * denominations, highest to lowest — platinum (pp), gold (gp), electrum (ep),
 * silver (sp), copper (cp). The schema script guarantees the row exists.
 */
export const DENOMINATIONS = ['platinum', 'gold', 'electrum', 'silver', 'copper'];

export function createCurrencyRepo(db) {
  const selectRow = db.prepare('SELECT * FROM party_currency WHERE id = 1');

  const strip = ({ id: _id, ...coins }) => coins;

  function assertDenomination(denomination) {
    if (!DENOMINATIONS.includes(denomination)) {
      throw new Error(
        `Unknown denomination: ${JSON.stringify(denomination)}. Expected one of ${DENOMINATIONS.join(', ')}.`
      );
    }
  }

  return {
    /** The party's purse: { platinum, gold, electrum, silver, copper }. */
    get() {
      return strip(selectRow.get());
    },

    /** Add coins of one denomination (e.g. sale proceeds). */
    add(denomination, amount) {
      assertDenomination(denomination);
      if (!Number.isInteger(amount) || amount < 0) {
        throw new Error(`amount must be a non-negative integer, got ${JSON.stringify(amount)}`);
      }
      db.prepare(`UPDATE party_currency SET ${denomination} = ${denomination} + ? WHERE id = 1`).run(
        amount
      );
      return strip(selectRow.get());
    },

    /**
     * Absolute set of any subset of denominations (seeding, DM corrections).
     * Values must be non-negative integers; unknown keys are rejected, not
     * ignored — a typoed denomination silently doing nothing would be worse.
     */
    set(values) {
      const entries = Object.entries(values ?? {});
      if (entries.length === 0) throw new Error('set expects at least one denomination');
      for (const [denomination, amount] of entries) {
        assertDenomination(denomination);
        if (!Number.isInteger(amount) || amount < 0) {
          throw new Error(
            `${denomination} must be a non-negative integer, got ${JSON.stringify(amount)}`
          );
        }
      }
      const setClause = entries.map(([d]) => `${d} = @${d}`).join(', ');
      db.prepare(`UPDATE party_currency SET ${setClause} WHERE id = 1`).run(
        Object.fromEntries(entries)
      );
      return strip(selectRow.get());
    },
  };
}
