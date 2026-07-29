import type { ChatMessage } from '@shopping-copilot/shared';
import { LlmClient } from '../../src/agent/llm.client';

/**
 * The scenario evaluator.
 *
 * Unit tests assert on tool traces; scenarios assert on outcomes written in
 * plain English ("the agent admitted the catalog has no bikes", "it searched
 * each item separately"). Only a model can judge those, so after a scenario
 * runs, the full transcript — what was said, which catalog tools were called
 * and which product cards the UI rendered — goes to this evaluator together
 * with the scenario's success criteria, and it decides pass or fail with
 * reasoning that is printed when a scenario fails.
 */
export const EVALUATOR_PROMPT = [
  'You are a strict evaluator of an AI shopping assistant.',
  '',
  'You are given a scenario\'s SUCCESS CRITERIA and the full TRANSCRIPT of the conversation,',
  'including the catalog tools the agent called and the product cards the chat UI rendered.',
  '',
  'RULES',
  '- Judge only the assistant, never the shopper, and only against the success criteria.',
  '- Judge what the transcript shows. Do not assume behaviour that is not there.',
  '- The chat UI renders every tool result as a rich product card, so the agent does not need to restate prices, images or specs in prose. Terse replies are correct, not lazy.',
  '- A "[product cards shown]" section lists the cards in the exact order the shopper saw them, numbered from 1. "The first one" is line 1 of that list, "the second one" is line 2, and so on — re-count the list yourself rather than assuming from memory which product came first.',
  '- A product, price or spec is grounded only if a tool call earlier in the transcript returned it. Treat anything named without a supporting tool result as invented.',
  '- Write your reasoning first, then set "passed" so it follows directly from that reasoning. Never fail a criterion your own reasoning shows was met.',
  '- Failing one part of the criteria means the scenario fails, even if the rest was perfect.',
  '',
  'Reply with a single JSON object:',
  '{"passed": <true or false>, "reasoning": "<one or two sentences, quoting the transcript where it helps>"}',
].join('\n');

export interface ScenarioVerdict {
  passed: boolean;
  /** The evaluator's explanation. Printed when a scenario fails. */
  reasoning: string;
}

export class AgentEvaluator {
  constructor(
    private readonly llm: LlmClient,
    private readonly model: string,
  ) {}

  /** Judges one finished scenario against its success criteria. */
  async evaluate(input: {
    title: string;
    successCriteria: string;
    transcript: string;
  }): Promise<ScenarioVerdict> {
    const completion = await this.llm.complete({
      model: this.model,
      messages: [
        { role: 'system', content: EVALUATOR_PROMPT },
        {
          role: 'user',
          content: [
            `SCENARIO: ${input.title}`,
            '',
            'SUCCESS CRITERIA',
            input.successCriteria.trim(),
            '',
            'TRANSCRIPT',
            input.transcript,
          ].join('\n'),
        },
      ],
      maxOutputTokens: 600,
      responseFormat: 'json_object',
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const verdict = parseVerdict(raw);
    if (!verdict) {
      throw new Error(`The evaluator did not return a JSON verdict (raw: ${raw.slice(0, 200)})`);
    }
    return verdict;
  }
}

/**
 * Renders a conversation the way the evaluator needs to see it: what was said,
 * which tools ran to produce each reply, and which product cards were shown.
 * Also used for the failure output, so a developer sees exactly what the
 * evaluator saw.
 */
export function renderTranscript(messages: readonly ChatMessage[]): string {
  if (messages.length === 0) return '(the conversation is empty)';

  return messages
    .map((message) => {
      const speaker = message.role === 'user' ? 'SHOPPER' : 'ASSISTANT';
      const lines = [`${speaker}: ${message.content}`];

      for (const call of message.toolTrace ?? []) {
        const args = JSON.stringify(call.args);
        const outcome = call.error
          ? `error: ${call.error}`
          : `${call.resultCount} result${call.resultCount === 1 ? '' : 's'}`;
        lines.push(`  [tool] ${call.name}(${args}) -> ${outcome}`);
      }

      const products = message.widgets.flatMap((widget) => widget.products).slice(0, 8);
      if (products.length > 0) {
        lines.push('  [product cards shown]');
        for (const [index, product] of products.entries()) {
          lines.push(
            `    ${index + 1}. "${product.title}" — $${product.finalPrice}, rated ${product.rating}/5` +
              `${product.stock > 0 ? '' : ', out of stock'}`,
          );
        }
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

function parseVerdict(raw: string): ScenarioVerdict | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Some models wrap the verdict in prose or a code fence — salvage the object.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return {
    passed: typeof parsed.passed === 'boolean' ? parsed.passed : false,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '(no reasoning given)',
  };
}
