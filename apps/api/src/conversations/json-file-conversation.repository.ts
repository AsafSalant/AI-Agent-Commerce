import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Conversation } from '@shopping-copilot/shared';
import { ConversationRepository } from './conversation.repository';

interface StoreFile {
  version: 1;
  conversations: Conversation[];
}

/**
 * Durable conversation store backed by a single JSON file.
 *
 * Chat history has to survive a page refresh *and* an API restart, and the
 * expected volume is tiny, so the whole store is kept in memory and flushed
 * atomically (write temp file, then rename) after each mutation. Writes are
 * chained onto a single promise so concurrent turns cannot interleave.
 */
@Injectable()
export class JsonFileConversationRepository extends ConversationRepository implements OnModuleInit {
  private readonly logger = new Logger(JsonFileConversationRepository.name);
  private readonly filePath: string;
  private readonly conversations = new Map<string, Conversation>();
  private writeQueue: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(config: ConfigService) {
    super();
    const dataDir = config.get<string>('DATA_DIR') ?? './data';
    const base = isAbsolute(dataDir) ? dataDir : resolve(process.cwd(), dataDir);
    this.filePath = join(base, 'conversations.json');
  }

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoreFile;
      for (const conversation of parsed.conversations ?? []) {
        this.conversations.set(conversation.id, conversation);
      }
      this.logger.log(
        `Loaded ${this.conversations.size} conversation(s) from ${this.filePath}`,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.logger.log(`No existing store at ${this.filePath}; starting empty`);
      } else {
        this.logger.error(
          `Could not read ${this.filePath}, starting empty: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async findAll(): Promise<Conversation[]> {
    await this.load();
    return [...this.conversations.values()].map((conversation) => structuredClone(conversation));
  }

  async findById(id: string): Promise<Conversation | null> {
    await this.load();
    const found = this.conversations.get(id);
    return found ? structuredClone(found) : null;
  }

  async save(conversation: Conversation): Promise<void> {
    await this.load();
    this.conversations.set(conversation.id, structuredClone(conversation));
    await this.flush();
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const existed = this.conversations.delete(id);
    if (existed) await this.flush();
    return existed;
  }

  private flush(): Promise<void> {
    const payload: StoreFile = { version: 1, conversations: [...this.conversations.values()] };
    const serialized = JSON.stringify(payload, null, 2);

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.${process.pid}.tmp`;
        await writeFile(tempPath, serialized, 'utf8');
        await rename(tempPath, this.filePath);
      } catch (error) {
        this.logger.error(
          `Failed to persist conversations: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });

    return this.writeQueue;
  }
}
