import type { RubricCheck } from './simulation.types';
import { assistantMessages, shownProducts, toolTrace } from './simulation.types';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministic rubric criteria. Anything expressible as an assertion belongs
 * here rather than in a judged criterion: it costs nothing, never flakes, and
 * keeps the judge focused on the genuinely subjective questions.
 *
 * Every check returns a boolean pass/fail (optionally with reasoning for the
 * report). There is no partial credit — a criterion either holds or it does not.
 */
export const check = {
  /** A tool ran at least `minTimes`, ignoring failed calls. */
  calledTool(name: string, minTimes = 1): RubricCheck {
    return (conversation) => {
      const calls = toolTrace(conversation).filter((call) => call.name === name && !call.error);
      return {
        passed: calls.length >= minTimes,
        reasoning: `${name} ran ${calls.length} time(s) successfully; ${minTimes} required.`,
      };
    };
  },

  /**
   * Every listed item was retrieved by a call of its own. A single call that
   * mentions two of them fused separate requests into one query, where they have
   * to share the filters and the result slots.
   */
  searchedSeparatelyFor(name: string, items: string[]): RubricCheck {
    return (conversation) => {
      const searches = toolTrace(conversation)
        .filter((call) => call.name === name && !call.error)
        .map((call) => JSON.stringify(call.args).toLowerCase());

      const mentions = (search: string) =>
        items.filter((item) => search.includes(item.toLowerCase()));
      const alone = items.filter((item) =>
        searches.some((search) => {
          const found = mentions(search);
          return found.length === 1 && found[0] === item;
        }),
      );
      const merged = searches.filter((search) => mentions(search).length > 1);

      return {
        passed: alone.length === items.length,
        reasoning:
          merged.length > 0
            ? `${merged.length} search(es) covered several items at once: ${merged.join(' | ')}.`
            : `${alone.length} of ${items.length} item(s) were searched on their own across ${searches.length} search(es).`,
      };
    };
  },

  neverCalledTool(name: string): RubricCheck {
    return (conversation) => {
      const calls = toolTrace(conversation).filter((call) => call.name === name);
      return {
        passed: calls.length === 0,
        reasoning:
          calls.length === 0 ? `${name} was never called.` : `${name} ran ${calls.length} time(s).`,
      };
    };
  },

  /** The UI rendered at least `min` product cards over the conversation. */
  showedProducts(min = 1): RubricCheck {
    return (conversation) => {
      const count = shownProducts(conversation).length;
      return {
        passed: count >= min,
        reasoning: `${count} product card(s) shown; ${min} required.`,
      };
    };
  },

  /** The UI rendered no product cards at all over the conversation. */
  showedNoProducts(): RubricCheck {
    return (conversation) => {
      const count = shownProducts(conversation).length;
      return {
        passed: count === 0,
        reasoning:
          count === 0
            ? 'No product cards were shown.'
            : `${count} product card(s) were shown; none expected.`,
      };
    };
  },

  /** Every product card respected the shopper's budget. */
  shownProductsUnder(maxPrice: number): RubricCheck {
    return (conversation) => {
      const products = shownProducts(conversation);
      if (products.length === 0) {
        return { passed: false, reasoning: 'No product cards were shown at all.' };
      }
      const over = products.filter((product) => product.finalPrice > maxPrice);
      return {
        passed: over.length === 0,
        reasoning:
          over.length === 0
            ? `All ${products.length} product(s) were at or under $${maxPrice}.`
            : `${over.length} of ${products.length} product(s) were over $${maxPrice} (most expensive: $${Math.max(
                ...products.map((product) => product.finalPrice),
              )}).`,
      };
    };
  },

  /** No assistant reply exceeded `limit` words. */
  repliesUnderWords(limit: number): RubricCheck {
    return (conversation) => {
      const replies = assistantMessages(conversation);
      if (replies.length === 0) {
        return { passed: false, reasoning: 'The assistant never replied.' };
      }
      const longest = Math.max(...replies.map((reply) => countWords(reply.content)));
      const over = replies.filter((reply) => countWords(reply.content) > limit);
      return {
        passed: over.length === 0,
        reasoning: `${over.length} of ${replies.length} reply(ies) exceeded ${limit} words (longest: ${longest}).`,
      };
    };
  },

  /** The agent never threw and no tool call errored. */
  noErrors(): RubricCheck {
    return (conversation) => {
      const agentErrors = conversation.turns.filter((turn) => turn.error);
      const toolErrors = toolTrace(conversation).filter((call) => call.error);
      const total = agentErrors.length + toolErrors.length;
      return {
        passed: total === 0,
        reasoning:
          total === 0
            ? 'No agent or tool errors.'
            : `${agentErrors.length} agent error(s) and ${toolErrors.length} tool error(s).`,
      };
    };
  },

  /** Every agent reply came back within `ms`. */
  respondedWithin(ms: number): RubricCheck {
    return (conversation) => {
      if (conversation.turns.length === 0) {
        return { passed: false, reasoning: 'No turns were completed.' };
      }
      const slowest = Math.max(...conversation.turns.map((turn) => turn.latencyMs));
      return {
        passed: slowest <= ms,
        reasoning: `Slowest turn took ${slowest}ms; budget is ${ms}ms.`,
      };
    };
  },

  /** The conversation finished within `turns` exchanges. */
  resolvedWithin(turns: number): RubricCheck {
    return (conversation) => ({
      passed: conversation.turns.length <= turns,
      reasoning: `Took ${conversation.turns.length} turn(s); budget is ${turns}.`,
    });
  },

  /** Escape hatch for one-off assertions that do not deserve a named helper. */
  custom(predicate: RubricCheck): RubricCheck {
    return predicate;
  },
};
