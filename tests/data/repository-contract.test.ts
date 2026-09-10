import { describe } from 'vitest';
import { InMemoryRepository } from '../../src/data/index';
import { repositoryContract } from './repository-contract';

// Two arbitrary distinct owner ids for the isolation assertions.
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

describe('Repository contract — InMemoryRepository', () => {
  repositoryContract(async () => new InMemoryRepository(), USER_A, USER_B);
});
