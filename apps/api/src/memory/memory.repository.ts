import type { MemoryFact } from '@shopping-copilot/shared';

/**
 * Storage contract for long-term shopper memory. Mirrors
 * `ConversationRepository`: swapping the implementation (JSON file, in-memory
 * for tests, a real database later) requires no changes elsewhere.
 */
export abstract class MemoryRepository {
  abstract findAll(): Promise<MemoryFact[]>;
  abstract findByKey(key: string): Promise<MemoryFact | null>;
  abstract save(fact: MemoryFact): Promise<void>;
  abstract delete(key: string): Promise<boolean>;
}
