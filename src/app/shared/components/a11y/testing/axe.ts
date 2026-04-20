import axe, { type RunOptions, type AxeResults, type Result } from 'axe-core';

/**
 * Shared axe-core runner for component unit tests. Returns only `serious` and
 * `critical` violations — the §5 contract treats moderate/minor results as
 * nits and lets CodeRabbit / manual review triage them.
 *
 * Rule scoping:
 * - `color-contrast` requires computed styles from a real layout engine;
 *   jsdom returns defaults for Tailwind utility classes, so it produces
 *   false positives at the unit-test layer. We validate contrast separately
 *   (see connection-palette.spec.ts and status-chip.component.spec.ts).
 * - `region` and `landmark-one-main` check page-level structure and don't
 *   apply to an isolated component fragment.
 */
const DISABLED_RULES = ['color-contrast', 'region', 'landmark-one-main'] as const;

const BLOCKING_IMPACTS = new Set<Result['impact']>(['serious', 'critical']);

export interface AxeAssertOptions {
  /** Extra rule ids to disable for this specific call. */
  readonly disableRules?: readonly string[];
}

export async function assertNoA11yViolations(
  element: Element,
  options: AxeAssertOptions = {},
): Promise<void> {
  const runOptions: RunOptions = {
    rules: Object.fromEntries(
      [...DISABLED_RULES, ...(options.disableRules ?? [])].map((id) => [id, { enabled: false }]),
    ),
    resultTypes: ['violations'],
  };
  const results: AxeResults = await axe.run(element, runOptions);
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact));
  if (blocking.length === 0) return;
  const summary = blocking
    .map((v) => `  - [${v.impact}] ${v.id}: ${v.help}\n    nodes: ${v.nodes.length}\n    help: ${v.helpUrl}`)
    .join('\n');
  throw new Error(`axe-core reported ${blocking.length} blocking violation(s):\n${summary}`);
}
