import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  toConversationSummary,
  type ChatMessage,
  type Conversation,
  type ConversationSummary,
  type MessageRole,
  type MessageWidget,
  type ToolTraceEntry,
} from '@shopping-copilot/shared';
import { ConversationRepository } from './conversation.repository';

export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

@Injectable()
export class ConversationsService {
  constructor(private readonly repository: ConversationRepository) {}

  async create(title = DEFAULT_CONVERSATION_TITLE): Promise<Conversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.repository.save(conversation);
    return conversation;
  }

  /** Most recently active conversation first, which is what the sidebar shows. */
  async list(): Promise<ConversationSummary[]> {
    const conversations = await this.repository.findAll();
    return conversations
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toConversationSummary);
  }

  async get(id: string): Promise<Conversation> {
    const conversation = await this.repository.findById(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return conversation;
  }

  async rename(id: string, title: string): Promise<Conversation> {
    const conversation = await this.get(id);
    conversation.title = title.trim().slice(0, 120) || DEFAULT_CONVERSATION_TITLE;
    conversation.updatedAt = new Date().toISOString();
    await this.repository.save(conversation);
    return conversation;
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
  }

  async appendMessage(id: string, message: ChatMessage): Promise<Conversation> {
    const conversation = await this.get(id);
    conversation.messages.push(message);
    conversation.updatedAt = message.createdAt;
    await this.repository.save(conversation);
    return conversation;
  }

  buildMessage(
    role: MessageRole,
    content: string,
    options: { widgets?: MessageWidget[]; toolTrace?: ToolTraceEntry[] } = {},
  ): ChatMessage {
    return {
      id: randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
      widgets: options.widgets ?? [],
      ...(options.toolTrace?.length ? { toolTrace: options.toolTrace } : {}),
    };
  }
}
