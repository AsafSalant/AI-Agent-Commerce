import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import {
  MastraPlatformExporter,
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { PromptInjectionDetector, UnicodeNormalizer } from '@mastra/core/processors';
import type { InputProcessorOrWorkflow } from '@mastra/core/processors';
import type { ShoppingAgentConfig } from './agent.types';
import { SYSTEM_PROMPT, TITLE_PROMPT } from './prompts';

/**
 * The shopping agent and its title sibling, both registered with a `Mastra`
 * instance so that observability, tracing and the input processors are wired
 * through Mastra's runtime. The agents themselves are stateless: history arrives
 * with each turn from our own conversation store.
 */
export function createShoppingMastra({
  model,
  tools,
  titleModel,
  guardModel,
  platformAccessToken,
  platformProjectId,
}: ShoppingAgentConfig): { mastra: Mastra; agent: Agent; titleAgent: Agent } {
  const inputProcessors: InputProcessorOrWorkflow[] = [
    // Folds lookalike characters and strips control characters inside Mastra too,
    // so history rehydrated from storage gets the same treatment as fresh input.
    new UnicodeNormalizer({ stripControlChars: true, collapseWhitespace: false, trim: false }),
  ];

  if (guardModel) {
    inputProcessors.push(
      new PromptInjectionDetector({
        model: guardModel,
        strategy: 'block',
        // One small classifier call per turn, on the new message only.
        lastMessageOnly: true,
        threshold: 0.8,
        detectionTypes: ['injection', 'jailbreak', 'system-override'],
      }),
    );
  }

  const agent = new Agent({
    id: 'shopping-copilot',
    name: 'Shopper',
    instructions: {
      role: 'system',
      content: SYSTEM_PROMPT,
      // Marks the end of the static prefix for providers with explicit cache
      // control. OpenAI caches implicitly instead, keyed by `promptCacheKey`.
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    model,
    tools,
    inputProcessors,
  });

  const titleAgent = new Agent({
    id: 'conversation-titler',
    name: 'Conversation titler',
    instructions: TITLE_PROMPT,
    model: titleModel,
  });

  // Observability is enabled only when both Platform credentials are present.
  // The `SensitiveDataFilter` is auto-applied by `Observability` to redact
  // secrets (API keys, tokens) before spans leave the process.
  const observability =
    platformAccessToken && platformProjectId
      ? new Observability({
          configs: {
            default: {
              serviceName: 'shopping-copilot',
              exporters: [
                // Local buffer for span lifecycle management.
                new MastraStorageExporter(),
                // Ships traces, metrics, logs and scores to the Mastra dashboard.
                new MastraPlatformExporter({
                  accessToken: platformAccessToken,
                  projectId: platformProjectId,
                }),
              ],
              // Redact secrets before they reach any exporter.
              spanOutputProcessors: [new SensitiveDataFilter()],
            },
          },
        })
      : undefined;

  const mastra = new Mastra({
    agents: { 'shopping-copilot': agent, 'conversation-titler': titleAgent },
    ...(observability ? { observability } : {}),
  });

  return { mastra, agent, titleAgent };
}
