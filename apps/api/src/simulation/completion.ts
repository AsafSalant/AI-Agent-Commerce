import type { CompletionCheck, SimulatedConversation } from './simulation.types';
import { assistantMessages, shownProducts, toolTrace } from './simulation.types';

/**
 * Stop conditions for scenarios. A scenario without one always burns its full
 * turn budget, which is slow and makes "the agent solved it in two turns" and
 * "the agent rambled for six" score the same.
 */
export const completeWhen = {
  /** The UI rendered at least `min` product cards. */
  productsShown(min = 1): CompletionCheck {
    return (conversation) => shownProducts(conversation).length >= min;
  },

  /** A specific catalog tool ran successfully at least once. */
  toolSucceeded(name: string): CompletionCheck {
    return (conversation) =>
      toolTrace(conversation).some((call) => call.name === name && !call.error);
  },

  /** Any assistant message matches `pattern`. */
  assistantSaid(pattern: RegExp): CompletionCheck {
    return (conversation) =>
      assistantMessages(conversation).some((message) => pattern.test(message.content));
  },

  /** The last assistant message matches `pattern`. */
  lastReplyMatches(pattern: RegExp): CompletionCheck {
    return (conversation) => {
      const replies = assistantMessages(conversation);
      const last = replies[replies.length - 1];
      return last ? pattern.test(last.content) : false;
    };
  },

  turnsReached(turns: number): CompletionCheck {
    return (conversation) => conversation.turns.length >= turns;
  },

  all(...checks: CompletionCheck[]): CompletionCheck {
    return async (conversation) => {
      for (const check of checks) {
        if (!(await check(conversation))) return false;
      }
      return true;
    };
  },

  any(...checks: CompletionCheck[]): CompletionCheck {
    return async (conversation) => {
      for (const check of checks) {
        if (await check(conversation)) return true;
      }
      return false;
    };
  },

  not(check: CompletionCheck): CompletionCheck {
    return async (conversation: SimulatedConversation) => !(await check(conversation));
  },
};
