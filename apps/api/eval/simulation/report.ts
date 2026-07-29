import {
  renderTranscript,
  type CriterionResult,
  type ScenarioRunResult,
  type SimulationReport,
} from '../../src/simulation';

const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const paint = (code: number) => (text: string) =>
  USE_COLOR ? `\u001B[${code}m${text}\u001B[0m` : text;

const color = {
  green: paint(32),
  red: paint(31),
  yellow: paint(33),
  dim: paint(90),
  bold: paint(1),
};

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCriterion(criterion: CriterionResult): string {
  const mark = criterion.passed ? color.green('✓') : color.red('✗');
  const flags = [criterion.source, criterion.required ? 'required' : null]
    .filter(Boolean)
    .join(', ');
  const head = `    ${mark} ${criterion.id.padEnd(28)} ${color.dim(`(${flags})`)}`;
  return criterion.reasoning ? `${head}\n      ${color.dim(criterion.reasoning)}` : head;
}

export function formatResult(result: ScenarioRunResult, options: { verbose?: boolean } = {}): string {
  const { evaluation, conversation } = result;
  const verdict = evaluation.passed ? color.green('PASS') : color.red('FAIL');
  const attempt = result.repetition > 1 ? ` #${result.repetition}` : '';

  const lines = [
    `${verdict}  ${result.scenarioId}${attempt}  ${color.dim(
      `${conversation.turns.length} turn(s) · ${formatDuration(result.durationMs)} · ${
        result.stopReason
      }`,
    )}`,
  ];

  if (result.error) {
    lines.push(`    ${color.red(`run error: ${result.error}`)}`);
  }
  if (evaluation.judgeError) {
    lines.push(`    ${color.yellow(`judge unavailable: ${evaluation.judgeError}`)}`);
  }

  // Passing scenarios only show their failed criteria; verbose shows everything.
  const shown = options.verbose
    ? evaluation.criteria
    : evaluation.criteria.filter((criterion) => !criterion.passed);
  lines.push(...shown.map(formatCriterion));

  if (evaluation.summary && (options.verbose || !evaluation.passed)) {
    lines.push(`    ${color.dim(evaluation.summary)}`);
  }

  if (options.verbose || !evaluation.passed) {
    const transcript = renderTranscript(conversation)
      .split('\n')
      .map((line) => `      ${color.dim(line)}`)
      .join('\n');
    lines.push(`    ${color.dim('transcript:')}`, transcript);
  }

  return lines.join('\n');
}

export function formatReport(
  report: SimulationReport,
  options: { verbose?: boolean } = {},
): string {
  const lines = [
    '',
    color.bold('Shopping copilot — multi-turn simulation'),
    '',
    ...report.results.map((result) => `${formatResult(result, options)}\n`),
  ];

  if (report.byScenario.some((entry) => entry.runs > 1)) {
    lines.push(color.bold('Per scenario'));
    for (const entry of report.byScenario) {
      const rate = `${entry.passed}/${entry.runs}`;
      const mark = entry.passed === entry.runs ? color.green(rate) : color.red(rate);
      lines.push(`  ${entry.scenarioId.padEnd(24)} ${mark}`);
    }
    lines.push('');
  }

  const verdict =
    report.failed === 0
      ? color.green(`${report.passed}/${report.total} passed`)
      : color.red(`${report.passed}/${report.total} passed`);

  lines.push(`${color.bold('Summary')}  ${verdict} · ${formatDuration(report.durationMs)}`, '');

  return lines.join('\n');
}
