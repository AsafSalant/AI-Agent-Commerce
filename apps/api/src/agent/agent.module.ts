import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MastraModelConfig } from '@mastra/core/llm';
import { ProductsModule } from '../products/products.module';
import { LlmClient, OpenAiLlmClient } from './llm.client';
import {
  AGENT_MODEL,
  GUARD_MODEL,
  MASTRA_PLATFORM_ACCESS_TOKEN,
  MASTRA_PROJECT_ID,
  TITLE_MODEL,
} from './model.tokens';
import { ShoppingAgentService } from './shopping-agent.service';

/**
 * Mastra's model router takes `provider/model` strings and reads the provider key
 * from the environment, so the configured model names carry no provider prefix.
 */
function routed(model: string): MastraModelConfig {
  return `openai/${model}` as MastraModelConfig;
}

@Module({
  imports: [ProductsModule],
  providers: [
    // Retained for the simulation harness, whose shopper and judge talk to the
    // API directly rather than through the agent.
    { provide: LlmClient, useClass: OpenAiLlmClient },
    {
      provide: AGENT_MODEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        routed(config.get<string>('OPENAI_MODEL') ?? 'gpt-5.4-mini'),
    },
    {
      provide: TITLE_MODEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        routed(config.get<string>('OPENAI_TITLE_MODEL') ?? 'gpt-5.4-nano'),
    },
    {
      provide: GUARD_MODEL,
      inject: [ConfigService],
      // The injection classifier costs one small call per turn, so it is opt-out
      // for local runs and evaluation sweeps.
      useFactory: (config: ConfigService) =>
        config.get<string>('AGENT_GUARDRAILS') === 'off'
          ? null
          : routed(config.get<string>('OPENAI_GUARD_MODEL') ?? 'gpt-5.4-nano'),
    },
    {
      provide: MASTRA_PLATFORM_ACCESS_TOKEN,
      inject: [ConfigService],
      // Both this and the project id must be set to enable observability.
      useFactory: (config: ConfigService) =>
        config.get<string>('MASTRA_PLATFORM_ACCESS_TOKEN') ?? null,
    },
    {
      provide: MASTRA_PROJECT_ID,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get<string>('MASTRA_PROJECT_ID') ?? null,
    },
    ShoppingAgentService,
  ],
  exports: [ShoppingAgentService, LlmClient],
})
export class AgentModule {}
