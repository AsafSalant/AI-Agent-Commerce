/**
 * Which model backs each role is a deliberate code choice, not something a
 * deployment should be able to flip via the environment. Pinned here so every
 * caller shares one source of truth.
 */
export const AGENT_MODEL_NAME = 'gpt-5.4-mini';
export const TITLE_MODEL_NAME = 'gpt-5.4-nano';
export const GUARD_MODEL_NAME = 'gpt-5.4-nano';
export const SIMULATION_USER_MODEL_NAME = 'gpt-5.4-mini';
export const SIMULATION_JUDGE_MODEL_NAME = 'gpt-5.4-mini';
