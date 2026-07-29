import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatMessage,
  MessageWidget,
  ToolActivity,
  ToolTraceEntry,
} from '@shopping-copilot/shared';
import { ShoppingAgentService } from '../agent/shopping-agent.service';
import { buildSimulatedMessage } from './message';
import type { AgentTurn } from './simulation.types';

/**
 * The system under test, reduced to one turn in and one message out.
 *
 * Mirrors the `LlmClient` seam: the harness depends on this single method, so a
 * different agent (a remote deployment, an older prompt, a competitor) can be
 * dropped in without touching the simulation loop.
 */
export abstract class AgentUnderTest {
  abstract generate(history: readonly ChatMessage[], userContent: string): Promise<AgentTurn>;
}

/**
 * Drives the real in-process agent. Deliberately bypasses `ChatService` so runs
 * need no conversation store and leave nothing persisted, while still exercising
 * the full tool-calling loop against the catalog.
 */
@Injectable()
export class ShoppingAgentUnderTest extends AgentUnderTest {
  private readonly logger = new Logger(ShoppingAgentUnderTest.name);

  constructor(private readonly agent: ShoppingAgentService) {
    super();
  }

  async generate(history: readonly ChatMessage[], userContent: string): Promise<AgentTurn> {
    const startedAt = Date.now();
    const activities: ToolActivity[] = [];
    let content = '';
    let widgets: MessageWidget[] = [];
    let toolTrace: ToolTraceEntry[] = [];

    try {
      for await (const event of this.agent.run([...history], userContent)) {
        switch (event.type) {
          case 'tool_activity':
            activities.push(event.activity);
            break;
          case 'result':
            content = event.content;
            widgets = event.widgets;
            toolTrace = event.toolTrace;
            break;
          // Deltas are re-derived from the final result, and widgets arrive with it.
          case 'text_delta':
          case 'widget':
            break;
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agent turn failed: ${reason}`);
      return {
        message: buildSimulatedMessage('assistant', `[agent error] ${reason}`),
        activities,
        latencyMs: Date.now() - startedAt,
        error: reason,
      };
    }

    return {
      message: buildSimulatedMessage('assistant', content, { widgets, toolTrace }),
      activities,
      latencyMs: Date.now() - startedAt,
    };
  }
}
