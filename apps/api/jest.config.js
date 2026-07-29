/**
 * Node 22 can `require()` an ES module, but Jest's CommonJS runtime cannot, and
 * Mastra reaches for a handful of ESM-only packages — statically, and through a
 * dynamic `import()` inside its own bundle. Transforming Mastra along with those
 * packages turns both forms back into plain requires.
 */
const ESM_DEPENDENCIES = [
  '@mastra/[^/]+',
  '@sindresorhus/[^/]+',
  'escape-string-regexp',
  'tokenx',
  'p-map',
  'p-limit',
  'p-retry',
  'p-timeout',
  'p-queue',
  'is-network-error',
  'retry',
  'yocto-queue',
  'aggregate-error',
  'clean-stack',
  'indent-string',
  'nanoid',
];

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.[cm]?[tj]s$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_DEPENDENCIES.join('|')})/)`],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  testTimeout: 20000,
  // Caps how many `it.concurrent`/`test.concurrent` tests run at once — the
  // live scenario suite (test/scenarios/scenarios.spec.ts) uses this as its
  // concurrency limit instead of a hand-rolled semaphore. Only affects
  // concurrent tests; every other suite still runs sequentially.
  maxConcurrency: 4,
};
