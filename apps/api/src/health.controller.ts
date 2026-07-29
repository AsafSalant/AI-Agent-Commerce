import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AGENT_MODEL_NAME } from './config/models';

@Controller('api/health')
export class HealthController {
  constructor(private readonly config: ConfigService) { }

  @Get()
  health() {
    return {
      status: 'ok',
      model: AGENT_MODEL_NAME,
      llmConfigured: Boolean(this.config.get<string>('OPENAI_API_KEY')),
      catalog: 'https://dummyjson.com',
    };
  }
}
