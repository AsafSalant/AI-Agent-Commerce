import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatMessage,
  ChatStreamEvent,
  MessageWidget,
  SendMessageResponse,
  ToolTraceEntry,
} from '@shopping-copilot/shared';
import { ShoppingAgentService } from '../agent/shopping-agent.service';
import {
  ConversationsService,
  DEFAULT_CONVERSATION_TITLE,
} from '../conversations/conversations.service';

const GENERIC_FAILURE =
  'Sorry — I could not complete that request just now. Please try asking again.';

/**
 * Orchestrates a shopper turn: persist the question, stream the agent's answer,
 * persist the answer, and name the conversation on its first message.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly agent: ShoppingAgentService,
  ) {}

  async *sendMessage(
    conversationId: string,
    content: string,
    options: { timeZone?: string } = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const conversation = await this.conversations.get(conversationId);
    const history = [...conversation.messages];

    const userMessage = this.conversations.buildMessage('user', content);
    await this.conversations.appendMessage(conversationId, userMessage);
    yield { type: 'user_message', message: userMessage };

    const needsTitle =
      history.length === 0 &&
      (conversation.title === DEFAULT_CONVERSATION_TITLE || conversation.title.trim() === '');
    // Kicked off in parallel so naming never delays the answer.
    const titlePromise = needsTitle ? this.agent.generateTitle(content) : null;

    let assistantContent = '';
    let widgets: MessageWidget[] = [];
    let toolTrace: ToolTraceEntry[] = [];
    let failure: string | null = null;

    try {
      for await (const event of this.agent.run(history, content, {
        conversationId,
        ...(options.timeZone ? { timeZone: options.timeZone } : {}),
      })) {
        switch (event.type) {
          case 'tool_activity':
            yield { type: 'tool_activity', activity: event.activity };
            break;
          case 'text_delta':
            yield { type: 'text_delta', delta: event.delta };
            break;
          case 'widget':
            yield { type: 'widget', widget: event.widget };
            break;
          case 'result':
            assistantContent = event.content;
            widgets = event.widgets;
            toolTrace = event.toolTrace;
            break;
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agent run failed for conversation ${conversationId}: ${reason}`);
      failure = reason;
      assistantContent = `${GENERIC_FAILURE} (${reason})`;
    }

    const assistantMessage: ChatMessage = this.conversations.buildMessage(
      'assistant',
      assistantContent || GENERIC_FAILURE,
      { widgets, toolTrace },
    );
    await this.conversations.appendMessage(conversationId, assistantMessage);

    if (failure) {
      yield { type: 'error', message: failure };
    }
    yield { type: 'message', message: assistantMessage };

    if (titlePromise) {
      const title = await titlePromise;
      await this.conversations.rename(conversationId, title);
      yield { type: 'title', conversationId, title };
    }

    yield { type: 'done' };
  }

  /** Non-streaming variant, used by integration tests and simple clients. */
  async sendMessageSync(
    conversationId: string,
    content: string,
    options: { timeZone?: string } = {},
  ): Promise<SendMessageResponse> {
    let userMessage: ChatMessage | null = null;
    let assistantMessage: ChatMessage | null = null;
    let title: string | null = null;

    for await (const event of this.sendMessage(conversationId, content, options)) {
      if (event.type === 'user_message') userMessage = event.message;
      if (event.type === 'message') assistantMessage = event.message;
      if (event.type === 'title') title = event.title;
    }

    const conversation = await this.conversations.get(conversationId);
    return {
      conversationId,
      title: title ?? conversation.title,
      userMessage: userMessage ?? conversation.messages[conversation.messages.length - 2],
      assistantMessage: assistantMessage ?? conversation.messages[conversation.messages.length - 1],
    };
  }
}
