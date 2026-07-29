import { Injectable } from '@nestjs/common';
import type { Conversation } from '@shopping-copilot/shared';
import { ConversationRepository } from './conversation.repository';

/** Used by tests and when `DATA_DIR` persistence is explicitly disabled. */
@Injectable()
export class InMemoryConversationRepository extends ConversationRepository {
  private readonly conversations = new Map<string, Conversation>();

  async findAll(): Promise<Conversation[]> {
    return [...this.conversations.values()].map((conversation) => structuredClone(conversation));
  }

  async findById(id: string): Promise<Conversation | null> {
    const found = this.conversations.get(id);
    return found ? structuredClone(found) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, structuredClone(conversation));
  }

  async delete(id: string): Promise<boolean> {
    return this.conversations.delete(id);
  }
}
