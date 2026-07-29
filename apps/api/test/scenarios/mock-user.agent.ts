import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ChatMessage } from '@shopping-copilot/shared';
import { LlmClient } from '../../src/agent/llm.client';
import { describeCardsForShopper } from '../../src/simulation';

/**
 * The mock shopper.
 *
 * Most scenario turns pin the user's message verbatim (see `scenarios.ts`), but
 * some messages can only be written once the agent has answered: "ask about the
 * second one" means nothing until the cards are actually on screen. For those
 * turns this agent plays the shopper — it reads the conversation from the
 * shopper's side and writes the next message from a short director's note in
 * the scenario (`{ mockUser: 'ask about the warranty of the first laptop' }`).
 *
 * It sees product cards the way a real shopper would (titles, prices, ratings,
 * no catalog ids) so it can only refer to products the way a person can:
 * "the first one", "the apple one".
 */
export const MOCK_USER_PROMPT = [
  'You are playing the SHOPPER in a test conversation with an AI shopping assistant.',
  'You are a real customer typing in a chat box. Never act as the assistant, never break character, never narrate what you are doing.',
  '',
  'HOW TO WRITE',
  '- At most 25 words. Casual, quick, lower case is fine. No bullet points, no markdown.',
  '- React to what the assistant actually said. When it showed product cards, refer to them the way a shopper would: "the second one", "the apple one". Never use product ids or full catalog titles.',
  '- Never invent product names, prices or specs that the assistant did not show you.',
  '',
  'WHAT YOU WILL SEE',
  '- The conversation so far, from your side: your own past messages are in the assistant slot, the assistant\'s replies are in the user slot.',
  '- A final bracketed line telling you what your next message should accomplish. Follow it, but phrase it as a shopper, not as an instruction.',
  '',
  'Reply with a single JSON object: {"message": "<what you type next>"}',
].join('\n');

export class MockUserAgent {
  constructor(
    private readonly llm: LlmClient,
    private readonly model: string,
  ) {}

  /**
   * Writes the shopper's next message.
   *
   * @param history   The conversation so far (context plus turns already run).
   * @param direction The scenario's director's note for this message.
   */
  async compose(input: { history: readonly ChatMessage[]; direction: string }): Promise<string> {
    const completion = await this.llm.complete({
      model: this.model,
      messages: [
        { role: 'system', content: MOCK_USER_PROMPT },
        ...historySeenByTheShopper(input.history),
        {
          role: 'user',
          content: `[What your next message should accomplish: ${input.direction}]`,
        },
      ],
      maxOutputTokens: 120,
      responseFormat: 'json_object',
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const message = parseMessage(raw);
    if (!message) {
      throw new Error(`The mock shopper produced no usable message (raw: ${raw.slice(0, 200)})`);
    }
    return message;
  }
}

/**
 * Flips the transcript into the shopper's point of view: the shopper's own past
 * messages are this model's own past output (assistant slot), the assistant's
 * replies are the incoming chat (user slot), with the shown cards described alongside.
 */
function historySeenByTheShopper(history: readonly ChatMessage[]): ChatCompletionMessageParam[] {
  return history.map((message): ChatCompletionMessageParam => {
    if (message.role === 'user') {
      return { role: 'assistant', content: message.content };
    }
    const cards = describeCardsForShopper(message);
    return {
      role: 'user',
      content: cards ? `${message.content}\n\n${cards}` : message.content,
    };
  });
}

/** Accepts the requested JSON shape, tolerating a model that answered in prose. */
function parseMessage(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const { message } = parsed as { message: unknown };
      if (typeof message === 'string' && message.trim()) return message.trim();
    }
  } catch {
    // Not JSON — fall through and treat the whole reply as the message.
  }
  const fallback = raw.trim();
  return fallback || null;
}
