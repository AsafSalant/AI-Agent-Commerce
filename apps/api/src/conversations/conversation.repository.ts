import type { Conversation } from '@shopping-copilot/shared';

/**
 * Storage contract for conversations. Swapping the implementation (JSON file,
 * in-memory for tests, a real database later) requires no changes elsewhere.
 */
export abstract class ConversationRepository {
  abstract findAll(): Promise<Conversation[]>;
  abstract findById(id: string): Promise<Conversation | null>;
  abstract save(conversation: Conversation): Promise<void>;
  abstract delete(id: string): Promise<boolean>;
}
