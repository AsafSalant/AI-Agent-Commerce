/**
 * Multi-turn conversation simulation suite.
 *
 * Where `eval/run-eval.ts` scores single shopper intents turn by turn, this
 * drives a simulated shopper through a whole conversation against the real agent
 * and the real catalog, then scores the transcript against a scenario rubric.
 *
 *   npm run simulate                                             # every scenario
 *   npm run simulate -w @shopping-copilot/api -- -s vague-gift   # one scenario
 *   npm run simulate -w @shopping-copilot/api -- --tag=scripted  # the cheap ones
 *
 * (From the repo root npm only forwards `--` arguments when `-w` is given.)
 *
 * Requires OPENAI_API_KEY and network access to dummyjson.com.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ENV_FILE_PATHS } from '../../src/config/env';
import {
  ConversationSimulatorService,
  SimulationModule,
  type Scenario,
  type SimulationEvent,
} from '../../src/simulation';
import { formatDuration, formatReport } from './report';
import { SCENARIOS } from './scenarios';

/**
 * The harness is deliberately not part of `AppModule`, so the runner bootstraps
 * a minimal context of its own: config plus the simulation module.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATHS }),
    SimulationModule,
  ],
})
class SimulationRunnerModule {}

interface Options {
  scenarioIds: string[];
  tags: string[];
  concurrency: number;
  repetitions: number;
  maxTurns?: number;
  jsonPath?: string;
  verbose: boolean;
  list: boolean;
  help: boolean;
}

const HELP = `
Multi-turn conversation simulation for the shopping agent.

Usage
  npm run simulate -- [options]

Options
  -s, --scenario=<id,...>   Only run these scenario ids
  -t, --tag=<tag,...>       Only run scenarios carrying these tags
  -c, --concurrency=<n>     Scenarios in flight at once (default 2)
  -r, --repetitions=<n>     Run each scenario n times to expose flakiness (default 1)
      --max-turns=<n>       Override every scenario's turn budget
      --json[=<path>]       Write the full report, transcripts included, as JSON
  -v, --verbose             Show all criteria and every transcript
      --list                List the available scenarios and exit
  -h, --help                Show this message

Exits non-zero when any scenario fails, so it can gate a pipeline.
`.trim();

function parseArgs(argv: string[]): Options {
  const options: Options = {
    scenarioIds: [],
    tags: [],
    concurrency: 2,
    repetitions: 1,
    verbose: false,
    list: false,
    help: false,
  };

  const split = (value: string): string[] =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  for (const arg of argv) {
    const [flag, value = ''] = arg.split('=');
    switch (flag) {
      case '--scenario':
      case '-s':
        options.scenarioIds.push(...split(value));
        break;
      case '--tag':
      case '-t':
        options.tags.push(...split(value));
        break;
      case '--concurrency':
      case '-c':
        options.concurrency = Number(value) || options.concurrency;
        break;
      case '--repetitions':
      case '-r':
        options.repetitions = Number(value) || options.repetitions;
        break;
      case '--max-turns':
        options.maxTurns = Number(value) || undefined;
        break;
      case '--json':
        options.jsonPath = value || 'simulation-report.json';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (flag.startsWith('-')) {
          throw new Error(`Unknown flag "${flag}". Run with --help to see the options.`);
        }
        // A bare word filters by scenario id, matching `npm run eval`'s style.
        options.scenarioIds.push(flag);
    }
  }

  return options;
}

function selectScenarios(options: Options): Scenario[] {
  let selected = SCENARIOS;

  if (options.scenarioIds.length > 0) {
    const missing = options.scenarioIds.filter(
      (id) => !SCENARIOS.some((scenario) => scenario.id === id),
    );
    if (missing.length > 0) {
      throw new Error(
        `Unknown scenario id(s): ${missing.join(', ')}. Run with --list to see them all.`,
      );
    }
    const wanted = new Set(options.scenarioIds);
    selected = selected.filter((scenario) => wanted.has(scenario.id));
  }

  if (options.tags.length > 0) {
    const wanted = new Set(options.tags);
    selected = selected.filter((scenario) => scenario.tags?.some((tag) => wanted.has(tag)));
  }

  if (selected.length === 0) {
    throw new Error('No scenarios matched the given filters.');
  }

  return selected;
}

function progressReporter(verbose: boolean): (event: SimulationEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'scenario_start':
        console.log(`▶ ${event.scenarioId}${event.repetition > 1 ? ` #${event.repetition}` : ''}`);
        break;
      case 'turn':
        if (verbose) {
          console.log(
            `    ${event.scenarioId} turn ${event.turn.index + 1} · ${formatDuration(
              event.turn.latencyMs,
            )}`,
          );
        }
        break;
      case 'scenario_end':
        console.log(
          `  ${event.result.evaluation.passed ? 'pass' : 'fail'} ${event.result.scenarioId}`,
        );
        break;
    }
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP);
    return;
  }

  if (options.list) {
    for (const scenario of SCENARIOS) {
      const tags = scenario.tags?.length ? ` [${scenario.tags.join(', ')}]` : '';
      console.log(`${scenario.id.padEnd(22)} ${scenario.title}${tags}`);
    }
    return;
  }

  const scenarios = selectScenarios(options);

  const context = await NestFactory.createApplicationContext(SimulationRunnerModule, {
    logger: options.verbose ? ['error', 'warn', 'log'] : ['error', 'warn'],
  });

  try {
    if (!context.get(ConfigService).get<string>('OPENAI_API_KEY')) {
      throw new Error(
        'OPENAI_API_KEY is not set. The simulated shopper and the judge both need it — copy .env.example to .env first.',
      );
    }

    const simulator = context.get(ConversationSimulatorService);
    const report = await simulator.run(scenarios, {
      concurrency: options.concurrency,
      repetitions: options.repetitions,
      ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
      onEvent: progressReporter(options.verbose),
    });

    console.log(formatReport(report, { verbose: options.verbose }));

    if (options.jsonPath) {
      const path = resolve(process.cwd(), options.jsonPath);
      await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
      console.log(`Full report written to ${path}`);
    }

    process.exitCode = report.failed > 0 ? 1 : 0;
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
