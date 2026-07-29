/**
 * Best-effort JSON object extraction from a model reply. Even with
 * `response_format: json_object` a model can wrap output in a fence or add a
 * stray sentence, and a whole simulation run is too expensive to throw away
 * over punctuation.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  for (const candidate of candidates(raw)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function* candidates(raw: string): Generator<string> {
  const text = raw.trim();
  if (!text) return;

  yield text;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) yield fenced[1].trim();

  const balanced = firstBalancedObject(text);
  if (balanced) yield balanced;
}

/** Scans for the first `{...}` span, ignoring braces inside string literals. */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}
