import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { LlmRequest } from './llm.types';

/**
 * Narrow seam over the OpenAI SDK, used by the simulation harness: its shopper
 * persona and its judge are single-shot callers with no tools and no loop, so
 * they need none of what the agent gets from Mastra.
 */
export abstract class LlmClient {
  abstract complete(request: LlmRequest): Promise<ChatCompletion>;
  abstract stream(request: LlmRequest): Promise<AsyncIterable<ChatCompletionChunk>>;
}

@Injectable()
export class OpenAiLlmClient extends LlmClient {
  private readonly logger = new Logger(OpenAiLlmClient.name);
  private readonly client: OpenAI | null;

  constructor(config: ConfigService) {
    super();
    const apiKey = config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY is not set — chat requests will fail until it is provided');
      this.client = null;
    } else {
      this.client = new OpenAI({
        apiKey,
        maxRetries: Number(config.get('OPENAI_MAX_RETRIES') ?? 2),
        timeout: Number(config.get('OPENAI_TIMEOUT_MS') ?? 60_000),
      });
    }
  }

  async complete(request: LlmRequest): Promise<ChatCompletion> {
    return this.sdk().chat.completions.create({ ...this.toParams(request), stream: false });
  }

  async stream(request: LlmRequest): Promise<AsyncIterable<ChatCompletionChunk>> {
    return this.sdk().chat.completions.create({ ...this.toParams(request), stream: true });
  }

  private sdk(): OpenAI {
    if (!this.client) {
      throw new HttpException('The assistant is not configured: OPENAI_API_KEY is missing.', 503);
    }
    return this.client;
  }

  private toParams(request: LlmRequest) {
    return {
      model: request.model,
      messages: request.messages,
      ...(request.tools?.length ? { tools: request.tools } : {}),
      ...(request.tools?.length ? { tool_choice: request.toolChoice ?? 'auto' } : {}),
      ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
      ...(request.responseFormat && request.responseFormat !== 'text'
        ? { response_format: { type: request.responseFormat } }
        : {}),
    } as const;
  }
}
