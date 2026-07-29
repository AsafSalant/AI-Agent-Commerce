import { Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { SIMULATION_USER_MODEL_NAME } from '../config/models';
import { LlmClient } from '../agent/llm.client';
import { asBoolean, asString, parseJsonObject } from './json';
import type {
  Persona,
  SimulatedConversation,
  SimulatedUserMessage,
  UserSimulator,
} from './simulation.types';
import { describeCardsForShopper } from './transcript';

/** Turns of shopper/assistant exchange the simulator is allowed to look back on. */
const MAX_SIMULATOR_HISTORY = 20;

/**
 * A shopper played by a fixed list of messages. Deterministic and free, so
 * scenarios that only need to check plumbing (or that assert on an exact phrase)
 * can run on every commit without an API key.
 */
export class ScriptedUserSimulator implements UserSimulator {
  private readonly script: string[];

  constructor(readonly persona: Persona) {
    this.script = persona.script ?? [];
  }

  async respond(conversation: SimulatedConversation): Promise<SimulatedUserMessage> {
    const index = conversation.turns.length;
    const content = this.script[index];
    if (content === undefined) {
      return { content: 'Thanks, that is everything I needed.', done: true };
    }
    return { content, done: index >= this.script.length - 1 };
  }
}

/**
 * A shopper played by an LLM. It sees the conversation from the shopper's side —
 * its own messages in the assistant slot, the agent's in the user slot — which
 * is what lets it react to what was actually said instead of narrating a script.
 */
export class LlmUserSimulator implements UserSimulator {
  private readonly logger = new Logger(LlmUserSimulator.name);

  constructor(
    readonly persona: Persona,
    private readonly llm: LlmClient,
    private readonly model: string,
  ) {}

  async respond(conversation: SimulatedConversation): Promise<SimulatedUserMessage> {
    // A pinned opener keeps the entry point identical across runs and models.
    if (conversation.turns.length === 0 && this.persona.opener) {
      return { content: this.persona.opener, done: false };
    }

    const completion = await this.llm.complete({
      model: this.model,
      messages: this.buildMessages(conversation),
      maxOutputTokens: 300,
      responseFormat: 'json_object',
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const parsed = parseJsonObject(raw);
    const content = asString(parsed?.message) ?? asString(raw);

    if (!content) {
      throw new Error(`The user simulator returned no usable message (raw: ${raw.slice(0, 200)})`);
    }
    if (!parsed) {
      this.logger.warn('User simulator reply was not JSON; treating the whole reply as the message');
    }

    return { content, done: asBoolean(parsed?.done) };
  }

  private buildMessages(conversation: SimulatedConversation): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: this.systemPrompt() },
    ];

    const history = conversation.messages.slice(-MAX_SIMULATOR_HISTORY);
    for (const message of history) {
      if (message.role === 'user') {
        // The shopper's own past messages are this model's own past output.
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      const cards = describeCardsForShopper(message);
      messages.push({
        role: 'user',
        content: cards ? `${message.content}\n\n${cards}` : message.content,
      });
    }

    if (history.length === 0) {
      messages.push({
        role: 'user',
        content: '[The chat is empty. Type your opening message to the assistant.]',
      });
    }

    return messages;
  }

  private systemPrompt(): string {
    const { profile, goal, hiddenConstraints, extraInstructions, maxWordsPerMessage } = this.persona;
    const wordCap = maxWordsPerMessage ?? 35;

    const lines = [
      "You are role-playing a SHOPPER chatting with an online store's AI shopping assistant.",
      'You are the customer. Never act as the assistant, and never break character.',
      '',
      'WHO YOU ARE',
      profile,
      '',
      'WHAT YOU WANT',
      goal,
    ];

    if (hiddenConstraints?.length) {
      lines.push(
        '',
        'THINGS YOU HAVE NOT MENTIONED YET',
        ...hiddenConstraints.map((constraint) => `- ${constraint}`),
        'Bring these up only when the assistant asks or when the conversation naturally reaches them. Never list them all at once.',
      );
    }

    lines.push(
      '',
      'HOW TO BEHAVE',
      `- Write like a real person typing in a chat box: at most ${wordCap} words, no bullet points, no markdown.`,
      '- React to what the assistant actually said. If it showed product cards, refer to them the way a shopper would: "the second one", "the Apple one".',
      '- Never invent product names, prices or specifications the assistant did not show you.',
      '- Do not praise, coach or evaluate the assistant. Just shop.',
      '- Ask a follow-up when something you care about is still unclear.',
      '- If the assistant is unhelpful or off-track, push back the way an impatient shopper would.',
      '',
      'WHEN YOU ARE DONE',
      '- Set "done" to true once your goal is genuinely met, or once you have decided to give up.',
      '- Keep "done" false while you still have something to ask.',
      '',
      'Reply with a single JSON object: {"message": "<what you type next>", "done": <true or false>}',
    );

    if (extraInstructions) {
      lines.push('', 'ADDITIONAL DIRECTION', extraInstructions);
    }

    return lines.join('\n');
  }
}

/**
 * Creates the simulated shopper for a persona, picking the scripted or the
 * LLM-driven implementation based on whether the persona ships a script.
 */
@Injectable()
export class UserSimulatorFactory {
  private readonly model = SIMULATION_USER_MODEL_NAME;

  constructor(private readonly llm: LlmClient) {}

  create(persona: Persona): UserSimulator {
    return persona.script?.length
      ? new ScriptedUserSimulator(persona)
      : new LlmUserSimulator(persona, this.llm, this.model);
  }
}
