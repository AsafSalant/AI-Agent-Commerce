/**
 * A durable fact the shopper asked the agent to remember about them — gender,
 * clothing size, brand preference, budget tendency, gift recipient, and so on.
 *
 * Facts are keyed by a short slug the model chooses (e.g. `gender`,
 * `shirt_size`), so re-stating a fact updates it instead of duplicating it.
 * They persist across conversations in the same store, separate from chat
 * history, and are replayed to the model ahead of every turn.
 */
export interface MemoryFact {
  /** Short slug identifying which kind of fact this is, e.g. `gender`, `shoe_size`. */
  key: string;
  /** The fact itself, as the shopper worded it, e.g. "male", "US 10". */
  value: string;
  /** ISO timestamp of the last update, for ordering and display. */
  updatedAt: string;
}
