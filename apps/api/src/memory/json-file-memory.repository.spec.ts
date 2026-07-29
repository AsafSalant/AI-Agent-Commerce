import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryFact } from '@shopping-copilot/shared';
import { JsonFileMemoryRepository } from './json-file-memory.repository';

describe('JsonFileMemoryRepository', () => {
  let dataDir: string;

  const buildRepository = () =>
    new JsonFileMemoryRepository(new ConfigService({ DATA_DIR: dataDir }));

  const fact = (key: string, value: string): MemoryFact => ({
    key,
    value,
    updatedAt: '2026-07-29T12:00:00.000Z',
  });

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'copilot-memory-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists facts to disk and reloads them in a fresh instance', async () => {
    const repository = buildRepository();
    await repository.save(fact('gender', 'male'));

    const reloaded = buildRepository();
    await reloaded.onModuleInit();

    const found = await reloaded.findByKey('gender');
    expect(found?.value).toBe('male');
  });

  it('upserts by key instead of duplicating', async () => {
    const repository = buildRepository();
    await repository.save(fact('gender', 'male'));
    await repository.save(fact('gender', 'female'));

    await expect(repository.findAll()).resolves.toHaveLength(1);
    const stored = JSON.parse(await readFile(join(dataDir, 'memory.json'), 'utf8'));
    expect(stored.facts[0].value).toBe('female');
  });

  it('returns copies so callers cannot mutate the store by accident', async () => {
    const repository = buildRepository();
    await repository.save(fact('gender', 'male'));

    const first = await repository.findByKey('gender');
    first!.value = 'mutated';

    await expect(repository.findByKey('gender')).resolves.toMatchObject({ value: 'male' });
  });

  it('deletes facts and reports whether one existed', async () => {
    const repository = buildRepository();
    await repository.save(fact('gender', 'male'));

    await expect(repository.delete('gender')).resolves.toBe(true);
    await expect(repository.delete('gender')).resolves.toBe(false);
    await expect(repository.findByKey('gender')).resolves.toBeNull();
  });

  it('starts empty when the store file does not exist yet', async () => {
    const repository = buildRepository();
    await repository.onModuleInit();
    await expect(repository.findAll()).resolves.toEqual([]);
  });

  it('survives a corrupted store file instead of crashing the API', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dataDir, 'memory.json'), '{not json', 'utf8');

    const repository = buildRepository();
    await repository.onModuleInit();
    await expect(repository.findAll()).resolves.toEqual([]);
  });
});
