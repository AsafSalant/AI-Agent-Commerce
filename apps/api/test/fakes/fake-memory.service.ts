import type { MemoryFact } from '@shopping-copilot/shared';
import { MemoryService } from '../../src/memory/memory.service';
import { MemoryRepository } from '../../src/memory/memory.repository';

/**
 * In-memory stand-in for `MemoryService`. Tests use it so the agent has a
 * memory surface without touching the filesystem, and so a test can seed
 * facts (e.g. `gender: male`) to assert the agent personalises off them.
 *
 * Extends the real service with an in-memory repository so it is structurally
 * assignable everywhere `MemoryService` is expected, while `rememberCalls`
 * and `forgetCalls` let tests assert what the agent asked it to store.
 */
class InMemoryMemoryRepository extends MemoryRepository {
  private readonly facts = new Map<string, MemoryFact>();

  constructor(facts: MemoryFact[] = []) {
    super();
    for (const fact of facts) this.facts.set(fact.key, { ...fact });
  }

  async findAll(): Promise<MemoryFact[]> {
    return [...this.facts.values()].map((fact) => ({ ...fact }));
  }
  async findByKey(key: string): Promise<MemoryFact | null> {
    const found = this.facts.get(key);
    return found ? { ...found } : null;
  }
  async save(fact: MemoryFact): Promise<void> {
    this.facts.set(fact.key, { ...fact });
  }
  async delete(key: string): Promise<boolean> {
    return this.facts.delete(key);
  }
}

export class FakeMemoryService extends MemoryService {
  public readonly rememberCalls: Array<{ key: string; value: string }> = [];
  public readonly forgetCalls: string[] = [];

  constructor(facts: MemoryFact[] = []) {
    super(new InMemoryMemoryRepository(facts));
  }

  override async remember(key: string, value: string): Promise<MemoryFact | null> {
    this.rememberCalls.push({ key, value });
    return super.remember(key, value);
  }

  override async forget(key: string): Promise<boolean> {
    this.forgetCalls.push(key);
    return super.forget(key);
  }
}
