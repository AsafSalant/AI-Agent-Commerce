import { Injectable } from '@nestjs/common';
import type { MemoryFact } from '@shopping-copilot/shared';
import { MemoryRepository } from './memory.repository';

/** Longest value we will store, to keep a wall of text out of the prompt. */
const MAX_VALUE_LENGTH = 200;
/** Longest key we will store; keys are short slugs. */
const MAX_KEY_LENGTH = 40;
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Long-term memory about the shopper: durable facts they asked the agent to
 * remember (gender, sizes, brand preferences, budget tendencies, gift
 * recipients, and so on). Facts are keyed by a short slug, so re-stating a
 * fact updates it rather than duplicating it. The store is independent of any
 * conversation, so a fact saved in one thread is available in every thread.
 */
@Injectable()
export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  async list(): Promise<MemoryFact[]> {
    return this.repository.findAll();
  }

  /**
   * Upserts a fact by key. Returns the stored fact, or `null` when the key or
   * value is rejected — the caller (a tool) reports the failure back to the
   * model rather than throwing, so the turn still ends cleanly.
   */
  async remember(key: string, value: string): Promise<MemoryFact | null> {
    const normalizedKey = key.trim().toLowerCase().slice(0, MAX_KEY_LENGTH);
    const normalizedValue = value.trim().slice(0, MAX_VALUE_LENGTH);
    if (!KEY_PATTERN.test(normalizedKey) || !normalizedValue) return null;

    const fact: MemoryFact = {
      key: normalizedKey,
      value: normalizedValue,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(fact);
    return fact;
  }

  async forget(key: string): Promise<boolean> {
    const normalizedKey = key.trim().toLowerCase();
    if (!KEY_PATTERN.test(normalizedKey)) return false;
    return this.repository.delete(normalizedKey);
  }

  /**
   * Renders the stored facts as a `<memory>` block for the per-turn context, or
   * `null` when nothing is stored. Values are neutralised so a stored string
   * can never forge the closing tag — the facts originate from shopper input,
   * so they are treated as data even though we trust the store itself.
   */
  async describeFacts(): Promise<string | null> {
    const facts = await this.list();
    if (facts.length === 0) return null;

    const lines = facts
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((fact) => `- ${fact.key}: ${neutralizeMarkup(fact.value)}`);
    return `<memory>\n${lines.join('\n')}\n</memory>`;
  }
}

/** Escapes the angle brackets untrusted text would need to close its block. */
function neutralizeMarkup(value: string): string {
  return value.replace(/[<>]/g, (bracket) => (bracket === '<' ? '&lt;' : '&gt;'));
}
