/**
 * LLM evaluation suite.
 *
 * Runs real shopper intents through the real model and the real DummyJSON
 * catalog, then asserts observable properties of each turn: the right tool was
 * called, the returned products respect the stated constraints, and the spoken
 * answer stays grounded in what was retrieved.
 *
 *   npm run eval                                            # all scenarios
 *   npm run eval -w @shopping-copilot/api -- budget vague   # ids matching a filter
 *
 * (npm only forwards `--` arguments to the workspace script, hence the `-w`.)
 *
 * Requires OPENAI_API_KEY and network access to dummyjson.com.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Product } from '@shopping-copilot/shared';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/chat/chat.service';
import { ConversationsService } from '../src/conversations/conversations.service';
import type { CheckOutcome, TurnResult } from './checks';
import { SCENARIOS, type EvalScenario } from './scenarios';

const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 3);
const THRESHOLD = Number(process.env.EVAL_THRESHOLD ?? 1);

interface TurnReport {
  prompt: string;
  text: string;
  products: string[];
  toolCalls: string[];
  durationMs: number;
  checks: CheckOutcome[];
}

interface ScenarioReport {
  id: string;
  intent: string;
  passed: boolean;
  turns: TurnReport[];
  error?: string;
}

const colors = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  bold: '\u001b[1m',
};

async function runScenario(
  scenario: EvalScenario,
  chat: ChatService,
  conversations: ConversationsService,
): Promise<ScenarioReport> {
  const report: ScenarioReport = { id: scenario.id, intent: scenario.intent, passed: true, turns: [] };

  try {
    const conversation = await conversations.create();

    for (const turn of scenario.turns) {
      const startedAt = Date.now();
      let text = '';
      const products: Product[] = [];
      let widgetCount = 0;
      let toolTrace: TurnResult['toolTrace'] = [];

      for await (const event of chat.sendMessage(conversation.id, turn.prompt)) {
        if (event.type === 'widget') {
          widgetCount += 1;
          products.push(...event.widget.products);
        }
        if (event.type === 'message') {
          text = event.message.content;
          toolTrace = event.message.toolTrace ?? [];
        }
        if (event.type === 'error') {
          throw new Error(event.message);
        }
      }

      const result: TurnResult = { text, products, widgetCount, toolTrace };
      const checks = turn.checks.map((check) => check(result));
      if (checks.some((check) => !check.pass && !check.advisory)) report.passed = false;

      report.turns.push({
        prompt: turn.prompt,
        text,
        products: products.map((product) => `${product.title} ($${product.finalPrice})`),
        toolCalls: toolTrace.map((entry) => `${entry.name}(${JSON.stringify(entry.args)})`),
        durationMs: Date.now() - startedAt,
        checks,
      });
    }
  } catch (error) {
    report.passed = false;
    report.error = error instanceof Error ? error.message : String(error);
  }

  return report;
}

/** Runs scenarios with a small amount of parallelism to keep the suite quick. */
async function runAll(
  scenarios: EvalScenario[],
  chat: ChatService,
  conversations: ConversationsService,
): Promise<ScenarioReport[]> {
  const queue = [...scenarios];
  const reports: ScenarioReport[] = [];

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const scenario = queue.shift();
      if (!scenario) break;
      const report = await runScenario(scenario, chat, conversations);
      reports.push(report);
      process.stdout.write(
        `${report.passed ? `${colors.green}PASS` : `${colors.red}FAIL`}${colors.reset} ${scenario.id}\n`,
      );
    }
  });

  await Promise.all(workers);
  return scenarios.map((scenario) => reports.find((report) => report.id === scenario.id)!);
}

interface Tally {
  total: number;
  passed: number;
  advisoryTotal: number;
  advisoryPassed: number;
}

function printReport(reports: ScenarioReport[]): Tally {
  const tally: Tally = { total: 0, passed: 0, advisoryTotal: 0, advisoryPassed: 0 };

  for (const report of reports) {
    const header = report.passed
      ? `${colors.green}✓${colors.reset}`
      : `${colors.red}✗${colors.reset}`;
    console.log(`\n${header} ${colors.bold}${report.id}${colors.reset} — ${report.intent}`);

    if (report.error) {
      console.log(`  ${colors.red}error:${colors.reset} ${report.error}`);
    }

    for (const turn of report.turns) {
      console.log(`  ${colors.dim}shopper:${colors.reset} ${turn.prompt}`);
      console.log(`  ${colors.dim}agent  :${colors.reset} ${turn.text.replace(/\n/g, ' ')}`);
      console.log(`  ${colors.dim}tools  :${colors.reset} ${turn.toolCalls.join(' | ') || 'none'}`);
      console.log(
        `  ${colors.dim}cards  :${colors.reset} ${turn.products.slice(0, 4).join(' | ') || 'none'}${
          turn.products.length > 4 ? ` (+${turn.products.length - 4})` : ''
        }`,
      );
      for (const check of turn.checks) {
        if (check.advisory) {
          tally.advisoryTotal += 1;
          if (check.pass) tally.advisoryPassed += 1;
        } else {
          tally.total += 1;
          if (check.pass) tally.passed += 1;
        }

        const mark = check.pass
          ? `${colors.green}✓`
          : check.advisory
            ? `${colors.yellow}~`
            : `${colors.red}✗`;
        const label = check.advisory ? `${check.name} ${colors.dim}(advisory)` : check.name;
        const detail = check.detail ? ` ${colors.dim}${check.detail}${colors.reset}` : '';
        console.log(`    ${mark}${colors.reset} ${label}${colors.reset}${detail}`);
      }
      console.log(`  ${colors.dim}${turn.durationMs}ms${colors.reset}`);
    }
  }

  return tally;
}

async function main(): Promise<void> {
  const filters = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const scenarios = filters.length
    ? SCENARIOS.filter((scenario) => filters.some((filter) => scenario.id.includes(filter)))
    : SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`No scenarios matched ${filters.join(', ')}`);
    process.exit(1);
  }

  // Evaluations never touch the persisted conversation store.
  process.env.PERSISTENCE = 'memory';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const config = app.get(ConfigService);

  if (!config.get('OPENAI_API_KEY')) {
    console.error('OPENAI_API_KEY is required to run the evaluation suite.');
    await app.close();
    process.exit(1);
  }

  console.log(
    `${colors.bold}Shopping copilot evaluation${colors.reset} — model ${config.get(
      'OPENAI_MODEL',
    )}, ${scenarios.length} scenario(s)\n`,
  );

  const startedAt = Date.now();
  const reports = await runAll(scenarios, app.get(ChatService), app.get(ConversationsService));
  const tally = printReport(reports);
  const scenariosPassed = reports.filter((report) => report.passed).length;
  const rate = tally.total === 0 ? 0 : tally.passed / tally.total;
  const advisoryNote =
    tally.advisoryTotal === 0
      ? ''
      : `, ${tally.advisoryPassed}/${tally.advisoryTotal} advisory (tone, non-gating)`;

  console.log(
    `\n${colors.bold}Summary${colors.reset}: ${scenariosPassed}/${reports.length} scenarios, ` +
      `${tally.passed}/${tally.total} checks (${(rate * 100).toFixed(1)}%)${advisoryNote} in ${(
        (Date.now() - startedAt) /
        1000
      ).toFixed(1)}s`,
  );

  const reportPath = join(__dirname, 'report.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      { model: config.get('OPENAI_MODEL'), ranAt: new Date().toISOString(), rate, reports },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`${colors.dim}Full report written to ${reportPath}${colors.reset}`);

  await app.close();

  if (rate < THRESHOLD) {
    console.error(
      `${colors.yellow}Check pass rate ${(rate * 100).toFixed(1)}% is below the required ${(
        THRESHOLD * 100
      ).toFixed(1)}%${colors.reset}`,
    );
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
