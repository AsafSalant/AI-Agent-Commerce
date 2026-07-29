import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage } from '@shopping-copilot/shared';
import { AgentUnderTest } from './agent-under-test';
import { ConversationEvaluatorService } from './conversation-evaluator.service';
import { buildSimulatedMessage } from './message';
import type {
  ConversationEvaluation,
  Persona,
  Scenario,
  ScenarioAggregate,
  ScenarioRunOptions,
  ScenarioRunResult,
  SimulatedConversation,
  SimulatedTurn,
  SimulatedUserMessage,
  SimulationReport,
  SimulationRunOptions,
  StopReason,
  UserSimulator,
} from './simulation.types';
import { UserSimulatorFactory } from './user-simulator';

const DEFAULT_CONCURRENCY = 2;

/**
 * Multi-turn simulation harness.
 *
 * A single-turn eval can only ask "was this one answer good?". Most of what
 * breaks in a shopping assistant is multi-turn: it forgets a stated budget,
 * loses track of which cards it showed, or never asks the one question that
 * would narrow the search. This service drives a simulated shopper through a
 * whole conversation against the real agent, decides when the conversation is
 * over, and scores the transcript as a whole.
 */
@Injectable()
export class ConversationSimulatorService {
  private readonly logger = new Logger(ConversationSimulatorService.name);

  constructor(
    private readonly simulators: UserSimulatorFactory,
    private readonly agent: AgentUnderTest,
    private readonly evaluator: ConversationEvaluatorService,
  ) {}

  /** Exposed so a caller can drive turns manually instead of using a scenario. */
  createUserSimulator(persona: Persona): UserSimulator {
    return this.simulators.create(persona);
  }

  /** Runs one scenario to completion and scores the resulting conversation. */
  async runScenario(
    scenario: Scenario,
    options: ScenarioRunOptions = {},
  ): Promise<ScenarioRunResult> {
    const startedAt = Date.now();
    const repetition = options.repetition ?? 1;
    const maxTurns = Math.max(1, options.maxTurns ?? scenario.maxTurns);
    const simulator = this.simulators.create(scenario.persona);

    const messages: ChatMessage[] = [...(scenario.seed ?? [])];
    const turns: SimulatedTurn[] = [];
    // Snapshotted per read so a check cannot mutate the run it is inspecting.
    const snapshot = (): SimulatedConversation => ({
      messages: [...messages],
      turns: [...turns],
    });

    options.onEvent?.({
      type: 'scenario_start',
      scenarioId: scenario.id,
      title: scenario.title,
      repetition,
    });

    let stopReason: StopReason = 'max_turns';
    let error: string | undefined;

    for (let index = 0; index < maxTurns; index += 1) {
      if (options.signal?.aborted) {
        stopReason = 'aborted';
        break;
      }

      let userTurn: SimulatedUserMessage;
      try {
        userTurn = await simulator.respond(snapshot());
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        this.logger.error(`Simulated shopper failed in "${scenario.id}": ${error}`);
        stopReason = 'simulator_error';
        break;
      }

      // The agent takes history *excluding* the message it is answering.
      const history = [...messages];
      const userMessage = buildSimulatedMessage('user', userTurn.content);
      messages.push(userMessage);

      const agentTurn = await this.agent.generate(history, userTurn.content);
      messages.push(agentTurn.message);

      const turn: SimulatedTurn = {
        index,
        userMessage,
        agentMessage: agentTurn.message,
        activities: agentTurn.activities,
        toolTrace: agentTurn.message.toolTrace ?? [],
        latencyMs: agentTurn.latencyMs,
        ...(agentTurn.error ? { error: agentTurn.error } : {}),
      };
      turns.push(turn);
      options.onEvent?.({ type: 'turn', scenarioId: scenario.id, repetition, turn });

      if (agentTurn.error) {
        error = agentTurn.error;
        stopReason = 'agent_error';
        break;
      }

      // The shopper still gets its closing message delivered, so rubrics can
      // judge how the agent wraps up.
      if (userTurn.done) {
        stopReason = 'user_satisfied';
        break;
      }

      if (scenario.isComplete && (await scenario.isComplete(snapshot()))) {
        stopReason = 'scenario_complete';
        break;
      }
    }

    const conversation = snapshot();
    const evaluation = await this.evaluateSafely(conversation, scenario);

    const result: ScenarioRunResult = {
      scenarioId: scenario.id,
      title: scenario.title,
      persona: scenario.persona.name,
      repetition,
      conversation,
      stopReason,
      evaluation,
      durationMs: Date.now() - startedAt,
      ...(error ? { error } : {}),
    };

    options.onEvent?.({ type: 'scenario_end', result });
    return result;
  }

  /**
   * Runs a suite. Scenarios are independent, so they run with a small
   * concurrency limit — enough to keep a suite quick, low enough to stay under
   * provider rate limits when every turn is several LLM calls.
   */
  async run(
    scenarios: Scenario[],
    options: SimulationRunOptions = {},
  ): Promise<SimulationReport> {
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    const repetitions = Math.max(1, options.repetitions ?? 1);

    const jobs = scenarios.flatMap((scenario) =>
      Array.from({ length: repetitions }, (_, attempt) => ({
        scenario,
        repetition: attempt + 1,
      })),
    );

    const results: ScenarioRunResult[] = new Array(jobs.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= jobs.length) return;

        const job = jobs[index];
        results[index] = await this.runScenario(job.scenario, {
          ...options,
          repetition: job.repetition,
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
    );

    const passed = results.filter((result) => result.evaluation.passed).length;

    return {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAtMs,
      results,
      total: results.length,
      passed,
      failed: results.length - passed,
      byScenario: this.aggregate(results),
    };
  }

  private async evaluateSafely(
    conversation: SimulatedConversation,
    scenario: Scenario,
  ): Promise<ConversationEvaluation> {
    try {
      return await this.evaluator.evaluate(conversation, scenario.rubric);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`Evaluation failed for "${scenario.id}": ${reason}`);
    return {
      passed: false,
      criteria: [],
      summary: 'The conversation could not be evaluated.',
      judgeError: reason,
    };
    }
  }

  private aggregate(results: ScenarioRunResult[]): ScenarioAggregate[] {
    const grouped = new Map<string, ScenarioRunResult[]>();
    for (const result of results) {
      const bucket = grouped.get(result.scenarioId);
      if (bucket) bucket.push(result);
      else grouped.set(result.scenarioId, [result]);
    }

    return [...grouped.entries()].map(([scenarioId, runs]) => ({
      scenarioId,
      title: runs[0].title,
      runs: runs.length,
      passed: runs.filter((run) => run.evaluation.passed).length,
    }));
  }
}
