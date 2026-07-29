import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { MemoryFact } from '@shopping-copilot/shared';
import { MemoryRepository } from './memory.repository';

interface StoreFile {
  version: 1;
  facts: MemoryFact[];
}

/**
 * Durable memory store backed by a single JSON file.
 *
 * Facts must survive an API restart and the expected volume is tiny, so the
 * whole store is kept in memory and flushed atomically (write temp file, then
 * rename) after each mutation. Writes are chained onto a single promise so
 * concurrent turns cannot interleave — the same pattern the conversation
 * store uses.
 */
@Injectable()
export class JsonFileMemoryRepository extends MemoryRepository implements OnModuleInit {
  private readonly logger = new Logger(JsonFileMemoryRepository.name);
  private readonly filePath: string;
  private readonly facts = new Map<string, MemoryFact>();
  private writeQueue: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(config: ConfigService) {
    super();
    const dataDir = config.get<string>('DATA_DIR') ?? './data';
    const base = isAbsolute(dataDir) ? dataDir : resolve(process.cwd(), dataDir);
    this.filePath = join(base, 'memory.json');
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
      for (const fact of parsed.facts ?? []) {
        this.facts.set(fact.key, fact);
      }
      this.logger.log(`Loaded ${this.facts.size} memory fact(s) from ${this.filePath}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.logger.log(`No existing memory store at ${this.filePath}; starting empty`);
      } else {
        this.logger.error(
          `Could not read ${this.filePath}, starting empty: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async findAll(): Promise<MemoryFact[]> {
    await this.load();
    return [...this.facts.values()].map((fact) => structuredClone(fact));
  }

  async findByKey(key: string): Promise<MemoryFact | null> {
    await this.load();
    const found = this.facts.get(key);
    return found ? structuredClone(found) : null;
  }

  async save(fact: MemoryFact): Promise<void> {
    await this.load();
    this.facts.set(fact.key, structuredClone(fact));
    await this.flush();
  }

  async delete(key: string): Promise<boolean> {
    await this.load();
    const existed = this.facts.delete(key);
    if (existed) await this.flush();
    return existed;
  }

  private flush(): Promise<void> {
    const payload: StoreFile = { version: 1, facts: [...this.facts.values()] };
    const serialized = JSON.stringify(payload, null, 2);

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.${process.pid}.tmp`;
        await writeFile(tempPath, serialized, 'utf8');
        await rename(tempPath, this.filePath);
      } catch (error) {
        this.logger.error(
          `Failed to persist memory: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });

    return this.writeQueue;
  }
}
