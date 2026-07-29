import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Conversation } from '@shopping-copilot/shared';
import { JsonFileConversationRepository } from './json-file-conversation.repository';

function conversation(id: string, title: string): Conversation {
  const now = new Date().toISOString();
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: `${id}-m1`, role: 'user', content: 'show me laptops', createdAt: now, widgets: [] },
    ],
  };
}

describe('JsonFileConversationRepository', () => {
  let dataDir: string;

  const buildRepository = () =>
    new JsonFileConversationRepository(new ConfigService({ DATA_DIR: dataDir }));

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'copilot-store-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists conversations to disk and reloads them in a fresh instance', async () => {
    const repository = buildRepository();
    await repository.save(conversation('c1', 'Laptops'));

    // A second instance stands in for an API restart.
    const reloaded = buildRepository();
    await reloaded.onModuleInit();

    const found = await reloaded.findById('c1');
    expect(found?.title).toBe('Laptops');
    expect(found?.messages).toHaveLength(1);
  });

  it('overwrites an existing conversation rather than duplicating it', async () => {
    const repository = buildRepository();
    const original = conversation('c1', 'Laptops');
    await repository.save(original);
    await repository.save({ ...original, title: 'Gaming laptops' });

    await expect(repository.findAll()).resolves.toHaveLength(1);
    const stored = JSON.parse(await readFile(join(dataDir, 'conversations.json'), 'utf8'));
    expect(stored.conversations[0].title).toBe('Gaming laptops');
  });

  it('returns copies so callers cannot mutate the store by accident', async () => {
    const repository = buildRepository();
    await repository.save(conversation('c1', 'Laptops'));

    const first = await repository.findById('c1');
    first!.title = 'Mutated';

    await expect(repository.findById('c1')).resolves.toMatchObject({ title: 'Laptops' });
  });

  it('deletes conversations and reports whether one existed', async () => {
    const repository = buildRepository();
    await repository.save(conversation('c1', 'Laptops'));

    await expect(repository.delete('c1')).resolves.toBe(true);
    await expect(repository.delete('c1')).resolves.toBe(false);
    await expect(repository.findById('c1')).resolves.toBeNull();
  });

  it('starts empty when the store file does not exist yet', async () => {
    const repository = buildRepository();
    await repository.onModuleInit();

    await expect(repository.findAll()).resolves.toEqual([]);
  });

  it('survives a corrupted store file instead of crashing the API', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dataDir, 'conversations.json'), '{not json', 'utf8');

    const repository = buildRepository();
    await repository.onModuleInit();

    await expect(repository.findAll()).resolves.toEqual([]);
  });
});
