import { createCharactersRepo } from './characters.js';
import { createResourceDefinitionsRepo } from './resourceDefinitions.js';
import { createCharacterResourcesRepo } from './characterResources.js';

/** Bind all repositories to one db handle. Tests pass an in-memory db here. */
export function createRepositories(db) {
  return {
    characters: createCharactersRepo(db),
    resourceDefinitions: createResourceDefinitionsRepo(db),
    characterResources: createCharacterResourcesRepo(db),
  };
}
