import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  MessageRole,
  MessageWidget,
  ToolTraceEntry,
} from '@shopping-copilot/shared';

/**
 * Builds a transcript message without touching the conversation store. The
 * harness deliberately keeps no persistence, so a simulated run leaves nothing
 * behind and needs no conversation id.
 */
export function buildSimulatedMessage(
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
