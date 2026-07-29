import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

export interface LlmRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: 'auto' | 'none' | 'required';
  maxOutputTokens?: number;
  /**
   * Ask the model for a single JSON object. Requires the word "json" somewhere
   * in the prompt, which the OpenAI API enforces.
   */
  responseFormat?: 'text' | 'json_object';
}
