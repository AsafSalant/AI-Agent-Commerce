import type { ChatMessage } from '@shopping-copilot/shared';
import type { SimulatedConversation } from './simulation.types';

const MAX_CARDS_DESCRIBED = 8;

/**
 * Renders the product cards attached to an assistant message the way a shopper
 * sees them: titles, prices and ratings, but no catalog ids.
 *
 * Numbering restarts per card group and groups get a heading when there is more
 * than one, mirroring `describeShownProducts` (the agent's own history replay)
 * and the shopper's actual UI: a multi-intent turn renders one list per item.
 * Without this, "the second laptop" and "the second card overall" are
 * indistinguishable to the mock shopper and to the judge scoring whether a
 * reference was resolved within the right group.
 *
 * The agent's own history replay (`describeShownProducts`) includes ids so the
 * model can call `get_product_details`. Handing those ids to the simulated
 * shopper would let it say "show me product 42", which no real user would type
 * and which would quietly make reference-resolution scenarios pass for the
 * wrong reason.
 */
export function describeCardsForShopper(message: ChatMessage): string | null {
  const groups = message.widgets.filter((widget) => widget.products.length > 0);
  if (groups.length === 0) return null;

  const blocks = groups.map((widget) => {
    const lines = widget.products
      .slice(0, MAX_CARDS_DESCRIBED)
      .map(
        (product, index) =>
          `${index + 1}. "${product.title}" — $${product.finalPrice}, rated ${product.rating}/5${
            product.brand ? `, ${product.brand}` : ''
          }`,
      );
    const body = lines.join('\n');
    return groups.length > 1 ? `Group "${widget.heading}":\n${body}` : body;
  });

  return `[The assistant showed you these product cards:\n${blocks.join('\n')}]`;
}

/**
 * Full transcript for the judge, including which tools ran and which cards the
 * UI rendered. Without the tool trace a judge cannot tell a grounded
 * recommendation from a hallucinated one.
 */
export function renderTranscriptForJudge(conversation: SimulatedConversation): string {
  if (conversation.turns.length === 0) {
    return '(the conversation is empty)';
  }

  const sections = conversation.turns.map((turn) => {
    const lines = [`--- Turn ${turn.index + 1} ---`, `SHOPPER: ${turn.userMessage.content}`];

    for (const call of turn.toolTrace) {
      const args = JSON.stringify(call.args);
      const outcome = call.error
        ? `error: ${call.error}`
        : `${call.resultCount} result${call.resultCount === 1 ? '' : 's'}`;
      lines.push(`  [tool] ${call.name}(${args}) -> ${outcome}`);
    }

    lines.push(`ASSISTANT: ${turn.agentMessage.content}`);

    const cards = describeCardsForShopper(turn.agentMessage);
    if (cards) lines.push(`  ${cards.replace(/\n/g, '\n  ')}`);
    if (turn.error) lines.push(`  [the assistant failed: ${turn.error}]`);

    return lines.join('\n');
  });

  return sections.join('\n\n');
}

/** Plain shopper/assistant transcript for CLI output. */
export function renderTranscript(conversation: SimulatedConversation): string {
  return conversation.messages
    .map((message) => {
      const speaker = message.role === 'user' ? 'shopper' : 'agent';
      const cards = message.widgets.flatMap((widget) => widget.products);
      const suffix =
        cards.length > 0
          ? ` (+${cards.length} product card${cards.length === 1 ? '' : 's'})`
          : '';
      return `${speaker}: ${message.content}${suffix}`;
    })
    .join('\n');
}
