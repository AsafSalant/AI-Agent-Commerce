import { Module } from '@nestjs/common';
import { JsonFileMemoryRepository } from './json-file-memory.repository';
import { MemoryRepository } from './memory.repository';
import { MemoryService } from './memory.service';

@Module({
  providers: [MemoryService, { provide: MemoryRepository, useClass: JsonFileMemoryRepository }],
  exports: [MemoryService],
})
export class MemoryModule {}
