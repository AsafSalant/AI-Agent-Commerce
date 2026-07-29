import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  ChatStreamEvent,
  Conversation,
  ConversationSummary,
  SendMessageResponse,
} from '@shopping-copilot/shared';
import { ChatService } from '../chat/chat.service';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto, RenameConversationDto, SendMessageDto } from './dto/conversation.dto';

const HEARTBEAT_MS = 15_000;

@Controller('api/conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly chat: ChatService,
  ) {}

  @Get()
  list(): Promise<ConversationSummary[]> {
    return this.conversations.list();
  }

  @Post()
  create(@Body() dto: CreateConversationDto): Promise<Conversation> {
    return this.conversations.create(dto.title);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Conversation> {
    return this.conversations.get(id);
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() dto: RenameConversationDto): Promise<Conversation> {
    return this.conversations.rename(id, dto.title);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.conversations.remove(id);
  }

  @Post(':id/messages')
  send(@Param('id') id: string, @Body() dto: SendMessageDto): Promise<SendMessageResponse> {
    return this.chat.sendMessageSync(id, dto.content, { timeZone: dto.timeZone });
  }

  /**
   * Server-sent events for a single turn. POST is used (rather than
   * `EventSource`) so the shopper's message travels in the body; the client
   * reads the stream with `fetch`.
   */
  @Post(':id/messages/stream')
  async stream(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Validate before any bytes are written so a 404 is still a clean 404.
    await this.conversations.get(id);

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    let aborted = false;
    request.on('close', () => {
      aborted = true;
    });

    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(': ping\n\n');
    }, HEARTBEAT_MS);

    const write = (event: ChatStreamEvent) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.chat.sendMessage(id, dto.content, { timeZone: dto.timeZone })) {
        if (aborted) break;
        write(event);
      }
    } catch (error) {
      write({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unexpected error',
      });
      write({ type: 'done' });
    } finally {
      clearInterval(heartbeat);
      if (!response.writableEnded) response.end();
    }
  }
}
