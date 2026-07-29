import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('api/health')
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  health() {
    return {
      status: 'ok',
      model: this.config.get<string>('OPENAI_MODEL') ?? 'gpt-5.4-mini',
      llmConfigured: Boolean(this.config.get<string>('OPENAI_API_KEY')),
      catalog: this.config.get<string>('DUMMYJSON_BASE_URL') ?? 'https://dummyjson.com',
    };
  }
}
