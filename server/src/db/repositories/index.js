import { createCharactersRepo } from './characters.js';
import { createResourceDefinitionsRepo } from './resourceDefinitions.js';
import { createCharacterResourcesRepo } from './characterResources.js';
import { createPlaybooksRepo } from './playbooks.js';
import { createLootRepo } from './loot.js';
import { createCurrencyRepo } from './currency.js';

/** Bind all repositories to one db handle. Tests pass an in-memory db here. */
export function createRepositories(db) {
  return {
    characters: createCharactersRepo(db),
    resourceDefinitions: createResourceDefinitionsRepo(db),
    characterResources: createCharacterResourcesRepo(db),
    playbooks: createPlaybooksRepo(db),
    loot: createLootRepo(db),
    currency: createCurrencyRepo(db),
  };
}
