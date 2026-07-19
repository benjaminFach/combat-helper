/**
 * Database schema, expressed as a single idempotent SQL script.
 *
 * Design notes:
 * - `resource_definitions` describes a *kind* of resource (Spell Slot,
 *   Lay on Hands, Channel Divinity...) and how it refreshes.
 * - `character_resources` is the junction/tracking table. One definition can
 *   map to many rows per character via `label` (e.g. Spell Slot -> "Level 1",
 *   "Level 2", "Level 3"), which is how mixed spell slots are modeled.
 * - `metadata` is a JSON TEXT column for mechanic-specific extras
 *   (slot_level, attuned item, dice size, etc.) without schema churn.
 * - `short_rest_gain` covers partial recovery: a long-rest resource that also
 *   regains N uses on a short rest (e.g. Tempest Cleric Channel Divinity).
 * - A `character_resources` row with max_value = 0 means "at-will/unlimited":
 *   nothing to track, the row exists so the feature shows on the dashboard.
 * - CHECK constraints make illegal states (current > max, negative pools)
 *   unrepresentable at the database level, not just the app level.
 * - `is_active` marks toggleable features (e.g. Twilight Sanctuary) that are
 *   currently switched on — orthogonal to uses remaining.
 * - Hit dice live on the character, not in character_resources: they are a
 *   per-character pool that several items/features draw from (Bloodshed
 *   Greatsword, Bloodsmelt Plate), not a resource owned by any one feature.
 * - Playbooks are curated decision-support content, one per character:
 *   a role line, a "default turn" script, an ordered decision ladder, and a
 *   signature-ability shortlist. Brevity limits are enforced here, not by
 *   convention: `priority BETWEEN 1 AND 4` + UNIQUE caps the ladder at 4
 *   rules, `slot BETWEEN 1 AND 3` + UNIQUE caps signatures at 3.
 * - `playbook_rules.resource_name` optionally names a resource_definitions
 *   row so the UI can dim/hide a rule when that resource is spent. It is a
 *   loose name reference (not an FK) because gating is advisory, and seed
 *   tests verify the names resolve for each owner.
 * - `loot.value_gp` is the UNIT price; a line item's total worth is
 *   value_gp * quantity, computed at read time, never stored.
 * - `party_currency` is a singleton row (id forced to 1) holding the five
 *   D&D 5e denominations (pp/gp/ep/sp/cp). The idempotent INSERT OR IGNORE
 *   guarantees the row exists after every migrate.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  class            TEXT    NOT NULL,
  subclass         TEXT,
  level            INTEGER NOT NULL CHECK (level BETWEEN 1 AND 20),
  max_hp           INTEGER NOT NULL CHECK (max_hp > 0),
  current_hp       INTEGER NOT NULL,
  temp_hp          INTEGER NOT NULL DEFAULT 0 CHECK (temp_hp >= 0),
  max_hit_dice     INTEGER NOT NULL DEFAULT 0 CHECK (max_hit_dice >= 0),
  current_hit_dice INTEGER NOT NULL DEFAULT 0,
  notes            TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (current_hp BETWEEN 0 AND max_hp),
  CHECK (current_hit_dice BETWEEN 0 AND max_hit_dice)
);

CREATE TABLE IF NOT EXISTS resource_definitions (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  category    TEXT    NOT NULL DEFAULT 'other'
              CHECK (category IN ('spell_slot', 'class_feature', 'pool', 'consumable', 'other')),
  refresh_on  TEXT    NOT NULL DEFAULT 'long_rest'
              CHECK (refresh_on IN ('short_rest', 'long_rest', 'dawn', 'manual')),
  description TEXT    NOT NULL DEFAULT '',
  short_rest_gain INTEGER NOT NULL DEFAULT 0 CHECK (short_rest_gain >= 0)
);

CREATE TABLE IF NOT EXISTS character_resources (
  id            INTEGER PRIMARY KEY,
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  definition_id INTEGER NOT NULL REFERENCES resource_definitions(id) ON DELETE CASCADE,
  label         TEXT,
  max_value     INTEGER NOT NULL CHECK (max_value >= 0),
  current_value INTEGER NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  metadata      TEXT    NOT NULL DEFAULT '{}',
  CHECK (current_value BETWEEN 0 AND max_value),
  UNIQUE (character_id, definition_id, label)
);

CREATE INDEX IF NOT EXISTS idx_character_resources_character
  ON character_resources (character_id);

CREATE TABLE IF NOT EXISTS character_playbooks (
  id             INTEGER PRIMARY KEY,
  character_id   INTEGER NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  role_name      TEXT    NOT NULL,
  role_text      TEXT    NOT NULL,
  default_action TEXT    NOT NULL,
  default_bonus  TEXT    NOT NULL DEFAULT '',
  default_move   TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS playbook_rules (
  id             INTEGER PRIMARY KEY,
  playbook_id    INTEGER NOT NULL REFERENCES character_playbooks(id) ON DELETE CASCADE,
  priority       INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),
  condition_text TEXT    NOT NULL,
  action_text    TEXT    NOT NULL,
  resource_name  TEXT,
  UNIQUE (playbook_id, priority)
);

CREATE TABLE IF NOT EXISTS playbook_signatures (
  id          INTEGER PRIMARY KEY,
  playbook_id INTEGER NOT NULL REFERENCES character_playbooks(id) ON DELETE CASCADE,
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  name        TEXT    NOT NULL,
  why_text    TEXT    NOT NULL,
  UNIQUE (playbook_id, slot)
);

CREATE TABLE IF NOT EXISTS loot (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  description  TEXT    NOT NULL CHECK (length(trim(description)) > 0),
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  value_gp     INTEGER NOT NULL DEFAULT 0 CHECK (value_gp >= 0),
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1)
);

CREATE INDEX IF NOT EXISTS idx_loot_character ON loot (character_id);

CREATE TABLE IF NOT EXISTS party_currency (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  platinum INTEGER NOT NULL DEFAULT 0 CHECK (platinum >= 0),
  gold     INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  electrum INTEGER NOT NULL DEFAULT 0 CHECK (electrum >= 0),
  silver   INTEGER NOT NULL DEFAULT 0 CHECK (silver >= 0),
  copper   INTEGER NOT NULL DEFAULT 0 CHECK (copper >= 0)
);

INSERT OR IGNORE INTO party_currency (id) VALUES (1);
`;
