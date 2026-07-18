/**
 * Test fixture = the production seed, run against ':memory:'.
 * Tests exercise exactly the party that `npm run seed` puts in party.db —
 * see src/db/seed.js for the character/resource breakdown.
 */
export { seedParty as seedTestParty } from '../../src/db/seed.js';
