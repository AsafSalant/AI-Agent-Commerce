import { Injectable, Logger } from '@nestjs/common';
import { SIMULATION_JUDGE_MODEL_NAME } from '../config/models';
import { LlmClient } from '../agent/llm.client';
import { asBoolean, asString, parseJsonObject } from './json';
import type {
  CheckOutcome,
  ConversationEvaluation,
  CriterionResult,
  Rubric,
  RubricCriterion,
  SimulatedConversation,
} from './simulation.types';
import { renderTranscriptForJudge } from './transcript';

const JUDGE_PROMPT = [
  'You are a strict evaluator of an AI shopping assistant.',
  'You are given the transcript of a conversation between a simulated shopper and the shopping agent, including the catalog tools the agent called and the product cards the UI rendered.',
  '',
  'For every criterion you are given, decide pass or fail:',
  '- pass — the criterion was fully met across the conversation.',
  '- fail — it was not met, or met so inconsistently that a shopper would notice.',
  '',
  'Rules:',
  '- Judge only what the transcript shows. Do not assume behaviour that is not there.',
  '- The chat UI renders every tool result as a rich product card, so the agent does not need to restate prices, images or specs in prose. Terse replies are correct, not lazy.',
  '- A recommendation is grounded only if a tool call earlier in the transcript returned that product. Treat any product named without a supporting tool result as invented. Before calling a product "invented" or "unsupported", check whether its name appears verbatim (or as an obvious partial match) in that turn\'s "[The assistant showed you these product cards]" list or an earlier tool result — if it does, it is grounded, full stop.',
  '- When product cards are split into labelled groups ("Group \"X\":"), an ordinal like "the second laptop" counts within the group whose label matches, starting at 1 in that group — not the position in the whole message.',
  '- For criteria about carrying a stated preference or constraint forward across turns, pass as long as the agent never contradicted or dropped it in a way the shopper would notice — restating it in different words each turn is not a failure, and neither is spending one turn on a question the shopper just asked before returning to it.',
  '- Write your reasoning first, then set "passed" so it follows directly from that reasoning. Never fail a criterion whose reasoning describes the behaviour it asks for; never pass one whose reasoning describes a violation.',
  '- Judge the assistant, never the shopper.',
  '- Be specific in your reasoning and quote the transcript where it helps.',
  '',
  'Reply with a single JSON object:',
  '{"criteria":[{"id":"<criterion id>","passed":<true or false>,"reasoning":"<one or two sentences>"}],"summary":"<two sentence overall assessment>"}',
].join('\n');

interface JudgeVerdict {
  passed: boolean;
  reasoning: string;
}

/**
 * Evaluates a finished conversation against a rubric.
 *
 * Deterministic criteria (those with a `check`) run locally and cost nothing;
 * everything else goes to an LLM judge in a single batched call. Mixing the two
 * matters: hard guarantees like "called the search tool" should never depend on
 * a model's mood, while "asked a sensible clarifying question" cannot be
 * expressed as an assertion.
 *
 * Required criteria are the gate: the scenario passes only when every required
 * criterion passes. Non-required criteria are advisory.
 */
@Injectable()
export class ConversationEvaluatorService {
  private readonly logger = new Logger(ConversationEvaluatorService.name);
  private readonly model = SIMULATION_JUDGE_MODEL_NAME;

  constructor(private readonly llm: LlmClient) {}

  async evaluate(
    conversation: SimulatedConversation,
    rubric: Rubric,
  ): Promise<ConversationEvaluation> {
    const checked = rubric.criteria.filter((criterion) => criterion.check);
    const judged = rubric.criteria.filter((criterion) => !criterion.check);

    const checkResults = await Promise.all(
      checked.map((criterion) => this.runCheck(criterion, conversation)),
    );

    let judgeError: string | undefined;
    let summary = 'No LLM-judged criteria in this rubric.';
    let judgeResults: CriterionResult[] = [];

    if (judged.length > 0) {
      const outcome = await this.runJudge(conversation, judged);
      judgeResults = outcome.results;
      summary = outcome.summary;
      judgeError = outcome.error;
    }

    // Report criteria in the order the rubric declared them.
    const byId = new Map([...checkResults, ...judgeResults].map((result) => [result.id, result]));
    const criteria = rubric.criteria
      .map((criterion) => byId.get(criterion.id))
      .filter((result): result is CriterionResult => result !== undefined);

    // Required criteria are the gate: failing one fails the scenario no matter
    // what else passed. Non-required criteria are advisory — they are reported
    // as pass/fail but cannot fail the run on their own, because deterministic
    // checks like "every card was under budget" are too blunt when a constraint
    // was only stated partway through the conversation. When a rubric declares
    // no required criteria at all, every criterion gates instead.
    const required = criteria.filter((result) => result.required);
    const passed = required.length > 0
      ? required.every((result) => result.passed)
      : criteria.length > 0 && criteria.every((result) => result.passed);

    return {
      passed,
      criteria,
      summary,
      ...(judgeError ? { judgeError } : {}),
    };
  }

  private async runCheck(
    criterion: RubricCriterion,
    conversation: SimulatedConversation,
  ): Promise<CriterionResult> {
    let outcome: CheckOutcome;
    try {
      outcome = await criterion.check!(conversation);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rubric check "${criterion.id}" threw: ${reason}`);
      outcome = { passed: false, reasoning: `The check threw: ${reason}` };
    }

    const normalized =
      typeof outcome === 'boolean'
        ? { passed: outcome, reasoning: outcome ? 'Check passed.' : 'Check failed.' }
        : { passed: outcome.passed, reasoning: outcome.reasoning ?? '' };

    return this.toResult(criterion, normalized, 'check');
  }

  private async runJudge(
    conversation: SimulatedConversation,
    criteria: RubricCriterion[],
  ): Promise<{ results: CriterionResult[]; summary: string; error?: string }> {
    const userPrompt = [
      'CRITERIA',
      ...criteria.map((criterion) => `- ${criterion.id}: ${criterion.description}`),
      '',
      'TRANSCRIPT',
      renderTranscriptForJudge(conversation),
    ].join('\n');

    try {
      const completion = await this.llm.complete({
        model: this.model,
        messages: [
          { role: 'system', content: JUDGE_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: 1200,
        responseFormat: 'json_object',
      });

      const raw = completion.choices?.[0]?.message?.content ?? '';
      const parsed = parseJsonObject(raw);
      if (!parsed) {
        throw new Error(`the judge did not return JSON (raw: ${raw.slice(0, 200)})`);
      }

      const verdicts = this.toVerdicts(parsed.criteria);
      const results = criteria.map((criterion) => {
        const verdict = verdicts.get(criterion.id) ?? {
          passed: false,
          reasoning: 'The judge did not score this criterion.',
        };
        return this.toResult(criterion, verdict, 'judge');
      });

      return {
        results,
        summary: asString(parsed.summary) ?? 'The judge returned no summary.',
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Judge call failed: ${reason}`);
      return {
        // Marked failed so a broken run never silently passes, but flagged via
        // `judgeError` so the report does not blame the agent for it.
        results: criteria.map((criterion) =>
          this.toResult(
            criterion,
            { passed: false, reasoning: `Not scored — the judge failed: ${reason}` },
            'judge',
          ),
        ),
        summary: 'The conversation could not be judged.',
        error: reason,
      };
    }
  }

  private toVerdicts(value: unknown): Map<string, JudgeVerdict> {
    const verdicts = new Map<string, JudgeVerdict>();
    if (!Array.isArray(value)) return verdicts;

    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const id = asString(record.id);
      if (!id) continue;
      verdicts.set(id, {
        passed: asBoolean(record.passed),
        reasoning: asString(record.reasoning) ?? '',
      });
    }

    return verdicts;
  }

  private toResult(
    criterion: RubricCriterion,
    verdict: JudgeVerdict,
    source: 'check' | 'judge',
  ): CriterionResult {
    return {
      id: criterion.id,
      description: criterion.description,
      required: criterion.required ?? false,
      passed: verdict.passed,
      reasoning: verdict.reasoning,
      source,
    };
  }
}
