
## Setup and run instructions

```bash

# Running
npm install
cp .env.example .env      # then set OPENAI_API_KEY
npm run dev               # API on :3001, web on :5173

# Open http://localhost:5173 and try *"I need a laptop for work under $1500"*.


# Tests
npm run simulate          # Multi-turn conversation simulation test (real model, LLM-graded) — needs OPENAI_API_KEY
```

## Architecture & framework choice

I used Mastra for the agent core because of some key features, and also because I want to learn something new 🙂

The Vercal AI SDK and LangChain
both felt wrong for this assigment after reading some features in Mastra.

The AI SDK is solid but I'd build guardrails, tracing and the tool
loop myself. LangChain is overkill for simple agent and tooling with a guardrail.

Mastra has cool features out of the box:
- Guardrails as input processors
- Typed `fullStream` events (LOVE IT)
- zod tools with `toModelOutput` (also useful)
- It's newer, which is the real trade-off, but thought it will lead for faster and efficant development.

## Retrieval strategy

### Params usage example
The model turns user's language into tool filters — budget becomes `max_price`,
"best" becomes `min_rating`, "cheapest" becomes `sort_by=price`.

### Endpoints
The agent calls `/products/category/{slug}` or `/products/search?q=`,
and union that with a local scan of the cached full catalog.

### Filtering and ranking (local, because DummyJSON can't)
DummyJSON only gives you free-text search, category listings and pagination — no
price, rating, brand or relevance filtering. So after pulling candidates I do
all of that locally, in this order:

1. **Tokenize** the query: lowercase, strip punctuation, split on whitespace.
2. **Drop stopwords** — words like "cheap", "best", "something" that carry no
   product signal. Without this, "show me something nice" would match every
   product with "for" in its description.
3. **Score each product by field**, with title weighted highest, then
   category/tags/brand, then description (which is mostly noise). A keyword in
   the title means a lot more than one buried in the description.
4. **Weight by query coverage** — a product that matches half the query is worth
   far less than one that matches all of it. This stops one loud keyword from
   outranking a product that fits the whole request.
5. **Filter** by the numeric/string filters the model filled in (price, rating,
   brand, tags, stock), then **sort** by whatever `sort_by` asked for.

### Multi intent
"a laptop and a mouse" is really two separate shopping requests. One search
can't hold both: the budget filter applies to one item, not two, and the result
slots would just mix laptops and mice together. So the agent runs one search per
item. Backstop: if the model tries a single search anyway and the matched
keywords never all land on one product ("laptop" matches laptops, "mouse"
matches mice, nothing matches both), the tool result tells it to split the query.

- **Ambiguous** ("something cheap and cool") — filler words are stopwords, so it collapses into a browse. The agent searches its best guess, then asks one clarifying question.
- **Off-catalog** ("a flight to Tokyo") — I kept this as a prompt rule to stay on
  topic and redirect, not a retrieval check. Everything would score near zero
  anyway, so the agent just says nothing matched.

## Conversation & state

History lives in one JSON file on the server (`DATA_DIR/conversations.json`) —
not Mastra Memory or a database. Volume is small, agents stay stateless, and
history is replayed each turn. The browser only keeps the open conversation id in
`localStorage`; messages always come from the API, so a refresh restores from the
server.

- **Write fails** — logged, but the in-memory copy already has the message, so it
  keeps working until the next save. A restart before that loses the gap.
- **Corrupted file** — caught on startup, store starts empty instead of crashing.
  Quietly loses history.
- **Cleared mid-conversation** — clearing `localStorage` only drops the pointer;
  the thread still lives in the server file. Server-side delete is the only real
  loss, and it's permanent.

## Evaluation

`npm test` runs offline: unit tests on retrieval ranking, tool schemas, guardrail
wiring, prompt caching, sanitization and persistence — all against fakes.
A live scenario suite runs the real agent through ~8 named scenarios, graded by an
LLM judge; it skips itself without an API key, so CI stays offline. There's also
a `simulate` CLI for multi-turn runs with a persona shopper and a mixed rubric.

- **Would catch:** broken tool schema, ranking regression, forgotten budget across
  turns, unsplit multi-intent, made-up out-of-catalog answers, broken refresh
  restore.
- **Would slip through:** anything off-script, tone-only drift (advisory, not
  gating), judge/human disagreement, and real-model flakiness — `--repetitions`
  surfaces it, doesn't remove it.

## Known limitations
- **Keyword search over ~200 products, not real search.** English-only, no
  synonyms, embeddings or personalization. Works because DummyJSON is small; I'd
  put a real search/vector index behind the same tool interface.
- **The JSON file doesn't scale.** It rewrites the whole file on every save, holds
  everything in memory, and only one process can write safely. The fix is a real
  database, not a bigger file.