/**
 * The scenario suite.
 *
 * Every scenario in `scenarios.ts` runs end to end against the real agent
 * (real model, real tool loop, fixture catalog) and is then judged by the
 * evaluator against the scenario's free-text success criteria. A failure
 * prints the evaluator's reasoning and the full transcript it judged.
 *
 * Scenarios run concurrently, capped at 4 at a time (`maxConcurrency` in
 * `jest.config.js`), so a whole file of several-turn conversations does not
 * run one after another. The harness (`scenario-runner.ts`) is synchronous up
 * to its first await, so the shared agent/mock-shopper/evaluator singleton
 * builds exactly once even when several scenarios start at the same tick.
 *
 * These are live-LLM tests: they need OPENAI_API_KEY (the repo-root .env is
 * loaded automatically) and make a handful of paid API calls per scenario.
 * Without a key the suite skips itself, so `npm test` stays offline.
 *
 * Run a single scenario by id:
 *   npx jest scenarios -t laptop-search
 */
import { runScenario } from './scenario-runner';
import { SCENARIOS } from './scenarios';

const describeLive = process.env.OPENAI_API_KEY ? describe : describe.skip;

describeLive('shopping agent scenarios (live)', () => {
  // A scenario is several sequential live calls: one per agent turn, maybe one
  // mock-shopper call, and one evaluation. Concurrent tests still respect this
  // per-test timeout; only the "wait for a free slot" part is shared.
  jest.setTimeout(180_000);

  for (const scenario of SCENARIOS) {
    // `test.concurrent` starts the test body immediately instead of waiting for
    // the previous test to finish; Jest still caps how many run at once via
    // `--maxConcurrency` (set to 4 in jest.config.js), acting as the semaphore.
    // Each scenario still reports pass/fail on its own line.
    it.concurrent(`${scenario.id} — ${scenario.title}`, async () => {
      const result = await runScenario(scenario);

      if (!result.verdict.passed) {
        throw new Error(
          [
            `The evaluator failed "${scenario.id}".`,
            `Reasoning: ${result.verdict.reasoning}`,
            '',
            result.transcript,
          ].join('\n'),
        );
      }
    });
  }
});
