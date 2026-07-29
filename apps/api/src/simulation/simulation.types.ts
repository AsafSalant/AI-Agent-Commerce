import type { ChatMessage, Product, ToolActivity, ToolTraceEntry } from '@shopping-copilot/shared';

/**
 * Who the simulated shopper is and how they behave over a whole conversation.
 *
 * A persona is deliberately more than a single prompt: multi-turn behaviour only
 * becomes interesting when the shopper withholds information, reacts to what was
 * shown and decides for itself when it is satisfied.
 */
export interface Persona {
  id: string;
  /** Display name used in reports. */
  name: string;
  /** Who they are, how they talk, how much they know about the domain. */
  profile: string;
  /** What they came to the store to accomplish. */
  goal: string;
  /**
   * Facts the shopper holds back until the agent asks for them. This is what
   * exercises the agent's clarifying questions instead of rewarding a single
   * lucky search.
   */
  hiddenConstraints?: string[];
  /** Verbatim first message. Pinning it keeps runs comparable across models. */
  opener?: string;
  /**
   * A fully scripted shopper. Bypasses the LLM entirely, which makes the
   * scenario deterministic and free — useful for CI smoke checks.
   */
  script?: string[];
  /** Extra persona-specific instructions appended to the simulator prompt. */
  extraInstructions?: string;
  /** Soft cap that keeps simulated shoppers from writing essays. */
  maxWordsPerMessage?: number;
}

/** One completed user/agent exchange. */
export interface SimulatedTurn {
  /** Zero-based index within the scenario run. */
  index: number;
  userMessage: ChatMessage;
  agentMessage: ChatMessage;
  /** Catalog calls the agent streamed while it worked, start and finish alike. */
  activities: ToolActivity[];
  toolTrace: ToolTraceEntry[];
  /** Wall-clock time the agent took to produce its reply. */
  latencyMs: number;
  /** Set when the agent threw instead of answering. */
  error?: string;
}

/**
 * The conversation as seen by simulators, completion checks and the evaluator.
 * `messages` is the same shape the production agent consumes, so anything that
 * reads a real conversation can read a simulated one.
 */
export interface SimulatedConversation {
  readonly messages: readonly ChatMessage[];
  readonly turns: readonly SimulatedTurn[];
}

export interface SimulatedUserMessage {
  content: string;
  /** The shopper considers its goal met (or has given up) and is ready to leave. */
  done: boolean;
}

/** A stand-in shopper that produces the next user message from the transcript. */
export interface UserSimulator {
  readonly persona: Persona;
  respond(conversation: SimulatedConversation): Promise<SimulatedUserMessage>;
}

/** The agent's reply to one user message, with everything worth asserting on. */
export interface AgentTurn {
  message: ChatMessage;
  activities: ToolActivity[];
  latencyMs: number;
  error?: string;
}

/**
 * Outcome of a deterministic rubric check. Returning a boolean is shorthand for
 * pass/fail; the object form lets a check explain itself in the report.
 */
export type CheckOutcome = boolean | { passed: boolean; reasoning?: string };

export type RubricCheck = (
  conversation: SimulatedConversation,
) => CheckOutcome | Promise<CheckOutcome>;

/**
 * One thing the conversation is judged on. Supply `check` for a deterministic
 * assertion (free, reproducible) and leave it off for an LLM-judged criterion
 * (subjective, costs a call). Rubrics normally mix both.
 *
 * `required` is the gate: a scenario passes only when every required criterion
 * passes. Non-required criteria are advisory — reported as pass/fail but they
 * cannot fail the run on their own. When a rubric declares no required
 * criteria, every criterion gates instead.
 */
export interface RubricCriterion {
  id: string;
  /** What "fully met" looks like. Sent verbatim to the judge. */
  description: string;
  /**
   * Gate flag. When true, failing this criterion fails the scenario. When false
   * (or unset), the criterion is advisory: it appears in the report but cannot
   * fail the run. Reserve `required` for guardrails and the behaviours the
   * scenario exists to check; leave soft checks (e.g. "every card under budget
   * across the whole conversation") as advisory, since they can be too blunt
   * when a constraint was only stated partway through.
   */
  required?: boolean;
  check?: RubricCheck;
}

export interface Rubric {
  criteria: RubricCriterion[];
}

export interface CriterionResult {
  id: string;
  description: string;
  required: boolean;
  passed: boolean;
  reasoning: string;
  /** Whether a deterministic check or the LLM judge produced this result. */
  source: 'check' | 'judge';
}

export interface ConversationEvaluation {
  passed: boolean;
  criteria: CriterionResult[];
  summary: string;
  /** Set when the judge could not be reached, so a fail is not the agent's fault. */
  judgeError?: string;
}

export type CompletionCheck = (
  conversation: SimulatedConversation,
) => boolean | Promise<boolean>;

export interface Scenario {
  id: string;
  title: string;
  persona: Persona;
  /** Hard cap on user/agent exchanges. */
  maxTurns: number;
  rubric: Rubric;
  /**
   * Ends the conversation early once the scenario's goal is observably met.
   * Without it a scenario always burns `maxTurns`.
   */
  isComplete?: CompletionCheck;
  /** Prior history the conversation resumes from. */
  seed?: ChatMessage[];
  /** Free-form labels for filtering runs, e.g. "guardrail", "retrieval". */
  tags?: string[];
}

export type StopReason =
  | 'scenario_complete'
  | 'user_satisfied'
  | 'max_turns'
  | 'agent_error'
  | 'simulator_error'
  | 'aborted';

export interface ScenarioRunResult {
  scenarioId: string;
  title: string;
  persona: string;
  /** 1-based attempt number when a scenario is repeated to measure flakiness. */
  repetition: number;
  conversation: SimulatedConversation;
  stopReason: StopReason;
  evaluation: ConversationEvaluation;
  durationMs: number;
  /** Infrastructure failure that cut the run short. */
  error?: string;
}

export interface ScenarioAggregate {
  scenarioId: string;
  title: string;
  runs: number;
  passed: number;
}

export interface SimulationReport {
  startedAt: string;
  durationMs: number;
  results: ScenarioRunResult[];
  total: number;
  passed: number;
  failed: number;
  byScenario: ScenarioAggregate[];
}

/** Progress events, so a CLI or CI job can report while a suite is running. */
export type SimulationEvent =
  | { type: 'scenario_start'; scenarioId: string; title: string; repetition: number }
  | { type: 'turn'; scenarioId: string; repetition: number; turn: SimulatedTurn }
  | { type: 'scenario_end'; result: ScenarioRunResult };

export interface ScenarioRunOptions {
  /** Overrides `scenario.maxTurns`, e.g. to shorten a debugging run. */
  maxTurns?: number;
  /** 1-based attempt number, recorded on the result. Set by the suite runner. */
  repetition?: number;
  onEvent?: (event: SimulationEvent) => void;
  signal?: AbortSignal;
}

export interface SimulationRunOptions extends ScenarioRunOptions {
  /** Scenarios run in parallel. Defaults to 2 to stay under rate limits. */
  concurrency?: number;
  /** Times to run each scenario. >1 surfaces non-determinism. Defaults to 1. */
  repetitions?: number;
}

/** Products the UI rendered as cards during a conversation, in order. */
export function shownProducts(conversation: SimulatedConversation): Product[] {
  return conversation.messages.flatMap((message) =>
    message.widgets.flatMap((widget) => widget.products),
  );
}

export function toolTrace(conversation: SimulatedConversation): ToolTraceEntry[] {
  return conversation.messages.flatMap((message) => message.toolTrace ?? []);
}

export function assistantMessages(conversation: SimulatedConversation): ChatMessage[] {
  return conversation.messages.filter((message) => message.role === 'assistant');
}
