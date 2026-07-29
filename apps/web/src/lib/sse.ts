/**
 * Minimal server-sent-events reader for `fetch` responses.
 *
 * `EventSource` cannot be used because a turn is sent with POST (the shopper's
 * message travels in the body), so frames are parsed off the response stream.
 */
export async function* readSseStream<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) {
    throw new Error('The server response contained no stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const payload = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');

        if (!payload) continue; // heartbeat or comment frame
        yield JSON.parse(payload) as T;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
