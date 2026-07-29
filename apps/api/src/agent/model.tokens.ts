/**
 * Injection tokens for the models the agent runs on. Kept apart from the module
 * so tests can hand in a scripted model without importing Nest wiring.
 */
export const AGENT_MODEL = Symbol('AGENT_MODEL');
export const TITLE_MODEL = Symbol('TITLE_MODEL');
/** Model behind the prompt-injection classifier, or null to run without it. */
export const GUARD_MODEL = Symbol('GUARD_MODEL');
/** Mastra Platform access token, or null when observability is disabled. */
export const MASTRA_PLATFORM_ACCESS_TOKEN = Symbol('MASTRA_PLATFORM_ACCESS_TOKEN');
/** Mastra Platform project id, or null when observability is disabled. */
export const MASTRA_PROJECT_ID = Symbol('MASTRA_PROJECT_ID');
