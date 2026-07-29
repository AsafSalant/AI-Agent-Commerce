import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ChatService } from '../chat/chat.service';
import { ConversationRepository } from './conversation.repository';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { JsonFileConversationRepository } from './json-file-conversation.repository';

@Module({
  imports: [AgentModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ChatService,
    { provide: ConversationRepository, useClass: JsonFileConversationRepository },
  ],
  exports: [ConversationsService, ChatService],
})
export class ConversationsModule {}
