/**
 * Deterministic plain-English policy parser (client-side).
 *
 * This mirrors the AGENT's fallback parser, not its LLM path. It runs in the
 * browser with no API key so the composer can show a live preview as the user
 * types; the agent's LLM parser handles phrasing this cannot.
 *
 * Being explicit matters for the pitch: what you see previewed here is regex
 * and arithmetic, not a model. The model's role is broader phrasing, and its
 * output is validated the same way before anyone signs it.
 *
 * Nothing here can act. It produces numbers the user reviews and signs into
 * the on-chain Policy PDA themselves — setPolicy is owner-only.
 */

export type PolicyMode = 'Conservative' | 'Balanced' | 'Aggressive';

export const POLICY_MODES: PolicyMode[] = ['Conservative', 'Balanced', 'Aggressive'];

export type PolicySource = 'llm' | 'deterministic';

export interface ParsedPolicy {
  drawdownThresholdBps: number;
  oracleDeviationThresholdBps: number;
  exitPercentBps: number;
  maxSlippageBps: number;
  targetAsset: 'USDC' | 'SOL' | 'USDT';
  mode: PolicyMode;
  warnings: string[];
  /** Fields the sentence never stated, where a default was applied. */
  defaultedFields: PolicyFieldKey[];
  /** Fields the sentence stated but that exceeded the program envelope. */
  clampedFields: PolicyFieldKey[];
  source?: PolicySource;
  model?: string;
}

export async function parsePolicyLlm(input: string): Promise<ParsedPolicy> {
  const fallback = parsePolicy(input);
  fallback.source = 'deterministic';

  try {
    const res = await fetch('/api/parse-policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policyText: input }),
    });

    if (!res.ok) {
      return fallback;
    }

    const data = await res.json();
    if (data.policy) {
      // The route tells us which numbers the model inferred rather than read.
      // Carry that through instead of dropping it: a default presented as an
      // extraction is the one failure mode this preview must not have.
      const defaultedFields: PolicyFieldKey[] = Array.isArray(data.policy.defaultedFields)
        ? data.policy.defaultedFields
        : [];
      const clampedFields: PolicyFieldKey[] = Array.isArray(data.policy.clampedFields)
        ? data.policy.clampedFields
        : [];
      const warnings: string[] = Array.isArray(data.policy.warnings)
        ? data.policy.warnings
        : buildFieldWarnings({ defaultedFields, clampedFields });

      return {
        drawdownThresholdBps: data.policy.drawdownThresholdBps,
        oracleDeviationThresholdBps: data.policy.oracleDeviationThresholdBps,
        exitPercentBps: data.policy.exitPercentBps,
        maxSlippageBps: data.policy.maxSlippageBps ?? fallback.maxSlippageBps,
        targetAsset: data.policy.targetAsset || fallback.targetAsset,
        mode: data.policy.mode as PolicyMode,
        warnings,
        defaultedFields,
        clampedFields,
        source: 'llm',
        model: data.model || 'claude-haiku-4-5',
      };
    }
  } catch (err) {
    // Silent fallback to local deterministic parser without cluttering the UI with API errors
  }

  return fallback;
}

/* ==========================================================================
   Program-aligned limits
   --------------------------------------------------------------------------
   These are the bounds a parsed policy is allowed to reach. They are exported
   so the API route enforces exactly the same envelope as this parser — a
   model-proposed number must never be trusted with more latitude than the
   regex path, and neither may exceed what a policy field can legally hold.
   ========================================================================== */

export const MAX_POLICY_BPS = 10_000; // 100% — no field may exceed this
export const MIN_DRAWDOWN_BPS = 100; // 1%
export const MIN_DEVIATION_BPS = 10; // 0.1%
export const MIN_SLIPPAGE_BPS = 1; // 0.01%
export const MAX_SLIPPAGE_BPS = 500; // 5% — matches the on-chain policy ceiling

export const DEFAULT_DRAWDOWN_BPS = 800; // 8%
export const DEFAULT_DEVIATION_BPS = 200; // 2%
export const DEFAULT_EXIT_BPS = 5_000; // 50%
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

/**
 * Property names as they appear in an API policy payload. Used to report which
 * fields were defaulted or clamped, so the UI can badge individual numbers
 * rather than printing an untethered list of warnings.
 */
export type PolicyFieldKey =
  | 'drawdownThresholdBps'
  | 'oracleDeviationThresholdBps'
  | 'exitPercentBps'
  | 'maxSlippageBps'
  | 'targetAsset';

/** Result of forcing a field into the program-aligned envelope. */
export interface BoundedField {
  value: number;
  defaulted: boolean;
  clamped: boolean;
}

const FIELD_LABELS: Record<PolicyFieldKey, string> = {
  drawdownThresholdBps: 'Drawdown threshold',
  oracleDeviationThresholdBps: 'Oracle deviation',
  exitPercentBps: 'Exit size',
  maxSlippageBps: 'Max slippage',
  targetAsset: 'Target asset',
};

const FIELD_DEFAULTS: Record<PolicyFieldKey, string> = {
  drawdownThresholdBps: `${DEFAULT_DRAWDOWN_BPS / 100}%`,
  oracleDeviationThresholdBps: `${DEFAULT_DEVIATION_BPS / 100}%`,
  exitPercentBps: `${DEFAULT_EXIT_BPS / 100}%`,
  maxSlippageBps: `${DEFAULT_SLIPPAGE_BPS / 100}%`,
  targetAsset: 'USDC',
};

/**
 * Turn defaulted/clamped field keys into sentences a person can act on.
 *
 * `values` carries what was actually applied, so a warning can never quote a
 * number the policy does not contain — conservative mode, for instance, applies
 * 30 bps slippage where the documented default is 50, and the message must say
 * the former. Without it the documented default is named instead.
 */
export function buildFieldWarnings(input: {
  defaultedFields: PolicyFieldKey[];
  clampedFields: PolicyFieldKey[];
  values?: Partial<Record<PolicyFieldKey, number | string>>;
}): string[] {
  const applied = (field: PolicyFieldKey): string => {
    const value = input.values?.[field];
    if (typeof value === 'number') return `${value / 100}%`;
    if (typeof value === 'string') return value;
    return FIELD_DEFAULTS[field];
  };

  return [
    ...input.defaultedFields.map(
      (field) => `${FIELD_LABELS[field]} not found in your sentence — defaulted to ${applied(field)}.`,
    ),
    ...input.clampedFields.map(
      (field) => `${FIELD_LABELS[field]} exceeded the allowed range — clamped to ${applied(field)}.`,
    ),
  ];
}

/**
 * Tensions the parsed numbers contain but the sentence did not intend.
 *
 * A conservative policy tightens slippage, which is the right instinct — but a
 * large exit under a tight slippage ceiling is precisely the combination that
 * fails to fill in a fast drop. The guard would be protecting the position from
 * its own exit, so we say so rather than letting the user discover it live.
 */
export function policyAdvisories(policy: {
  mode: PolicyMode;
  exitPercentBps: number;
  maxSlippageBps: number;
}): string[] {
  const advisories: string[] = [];
  if (policy.mode === 'Conservative' && policy.exitPercentBps >= 5_000) {
    advisories.push(
      `Conservative slippage (${policy.maxSlippageBps / 100}%) with a ${policy.exitPercentBps / 100}% exit: the swap may not fill in a fast drop, leaving the position unguarded.`,
    );
  }
  return advisories;
}

const DRAWDOWN_PATTERNS: RegExp[] = [
  /([0-9]+(?:\.[0-9]+)?)\s*%[^0-9%]{0,20}draw\s?down/,
  /(?:drops?|falls?|declines?|loses?)[^0-9%]{0,20}([0-9]+(?:\.[0-9]+)?)\s*%/,
  /draw\s?down\s*(?:of|by|is|at|above|below|over|under|>|<|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/,
];

const DEVIATION_PATTERNS: RegExp[] = [
  /([0-9]+(?:\.[0-9]+)?)\s*%[^0-9%]{0,20}(?:oracle|price)?\s*deviat\w*/,
  /(?:oracle|price)\s*deviation\s*(?:of|by|is|at|above|below|over|under|>|<|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/,
  /deviat\w*\s*(?:of|by|is|at|above|below|over|under|>|<|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/,
];

const EXIT_PATTERNS: RegExp[] = [
  /exit\s*(?:of|by|is|at|above|below|over|under|>|<|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/,
  /(?:move|convert|sell|swap)[^0-9%]{0,20}([0-9]+(?:\.[0-9]+)?)\s*%/,
  /([0-9]+(?:\.[0-9]+)?)\s*%[^0-9%]{0,20}(?:to\s+(?:usdc|usdt|stable))/,
];

const CONSERVATIVE_PATTERN = /\b(conservative|cautiously|cautious|carefully|careful|safely|safe)\b/;
const AGGRESSIVE_PATTERN = /\b(aggressive(?:ly)?|fast|immediately|asap|urgent(?:ly)?)\b/;

function percentToBps(value: number): number {
  return Math.round(value * 100);
}

function firstPercent(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const captured = match?.[1];
    if (captured !== undefined) {
      const value = Number.parseFloat(captured);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

/**
 * Force a single basis-point field into the program-aligned envelope.
 *
 * A value the sentence never supplied is *defaulted*; a value the sentence did
 * supply but that sits outside the envelope is *clamped*. The two are reported
 * separately because they mean different things to the person signing: one is a
 * gap the model filled in, the other is a limit their own wording exceeded.
 */
export function boundBps(
  raw: number,
  options: { min: number; fallback: number },
): BoundedField {
  if (!Number.isFinite(raw) || raw <= 0) {
    return { value: options.fallback, defaulted: true, clamped: false };
  }
  if (raw < options.min) {
    return { value: options.min, defaulted: false, clamped: true };
  }
  if (raw > MAX_POLICY_BPS) {
    return { value: MAX_POLICY_BPS, defaulted: false, clamped: true };
  }
  return { value: raw, defaulted: false, clamped: false };
}

/**
 * Fields whose absence from a sentence is provable without a model.
 *
 * A percentage can only convey drawdown, deviation or exit size, so those are
 * left to the model: "halve the position" states an exit the regexes will never
 * find, and claiming it was defaulted would be a fresh lie in the other
 * direction. Slippage and target asset are different — slippage is only ever
 * stated by naming it, and an asset is only ever stated by naming it — so their
 * silence is a fact we can check and use to catch a model that under-reports
 * what it filled in.
 */
export function textDerivedDefaultedFields(input: string): PolicyFieldKey[] {
  const text = input.toLowerCase();
  const fields: PolicyFieldKey[] = [];
  if (!/\bslippage\b/i.test(text)) fields.push('maxSlippageBps');
  if (!/\b(?:usdc|usdt|sol|wsol)\b/i.test(text)) fields.push('targetAsset');
  return fields;
}

export function parsePolicy(input: string): ParsedPolicy {
  const text = input.toLowerCase();
  const defaulted = new Set<PolicyFieldKey>();
  const clamped = new Set<PolicyFieldKey>();

  const drawdown = firstPercent(text, DRAWDOWN_PATTERNS);
  const deviation = firstPercent(text, DEVIATION_PATTERNS);
  const exit = firstPercent(text, EXIT_PATTERNS);

  let mode: PolicyMode = 'Balanced';
  if (CONSERVATIVE_PATTERN.test(text)) mode = 'Conservative';
  else if (AGGRESSIVE_PATTERN.test(text)) mode = 'Aggressive';

  const drawdownBps = boundBps(drawdown === undefined ? 0 : percentToBps(drawdown), {
    min: MIN_DRAWDOWN_BPS,
    fallback: DEFAULT_DRAWDOWN_BPS,
  });
  const deviationBps = boundBps(deviation === undefined ? 0 : percentToBps(deviation), {
    min: MIN_DEVIATION_BPS,
    fallback: DEFAULT_DEVIATION_BPS,
  });
  const exitBps = boundBps(exit === undefined ? 0 : percentToBps(exit), {
    min: 1,
    fallback: DEFAULT_EXIT_BPS,
  });

  if (drawdownBps.defaulted) defaulted.add('drawdownThresholdBps');
  else if (drawdownBps.clamped) clamped.add('drawdownThresholdBps');

  if (deviationBps.defaulted) defaulted.add('oracleDeviationThresholdBps');
  else if (deviationBps.clamped) clamped.add('oracleDeviationThresholdBps');

  if (exitBps.defaulted) defaulted.add('exitPercentBps');
  else if (exitBps.clamped) clamped.add('exitPercentBps');

  let targetAsset: 'USDC' | 'SOL' | 'USDT' = 'USDC';
  if (/\b(?:to|into|in)\s+(?:sol|wsol)\b/i.test(text) || (/\bsol\b/i.test(text) && !/\busdc\b/i.test(text) && !/\busdt\b/i.test(text))) {
    targetAsset = 'SOL';
  } else if (/\b(?:to|into|in)\s+usdt\b/i.test(text) || /\busdt\b/i.test(text)) {
    targetAsset = 'USDT';
  }
  if (targetAsset === 'USDC' && !/\busdc\b/i.test(text)) {
    defaulted.add('targetAsset');
  }

  const maxSlippageBps = mode === 'Conservative' ? 30 : mode === 'Aggressive' ? 100 : DEFAULT_SLIPPAGE_BPS;
  if (!/\bslippage\b/i.test(text)) {
    defaulted.add('maxSlippageBps');
  }

  const defaultedFields = [...defaulted];
  const clampedFields = [...clamped];

  return {
    drawdownThresholdBps: drawdownBps.value,
    oracleDeviationThresholdBps: deviationBps.value,
    exitPercentBps: exitBps.value,
    maxSlippageBps,
    targetAsset,
    mode,
    // Derived from the same sets the caller badges on, so a field can never be
    // flagged in one place and silently unexplained in the other.
    warnings: buildFieldWarnings({
      defaultedFields,
      clampedFields,
      values: {
        drawdownThresholdBps: drawdownBps.value,
        oracleDeviationThresholdBps: deviationBps.value,
        exitPercentBps: exitBps.value,
        maxSlippageBps,
        targetAsset,
      },
    }),
    defaultedFields,
    clampedFields,
    source: 'deterministic',
  };
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

/* ==========================================================================
   Highlighting
   --------------------------------------------------------------------------
   Presentation-only. `parsePolicy` answers "what are the numbers"; this
   answers "which words did they come from", which is what makes the composer
   legible — the user can see their own sentence being read.
   ========================================================================== */

export type PolicyField = 'drawdown' | 'deviation' | 'exit' | 'mode';

export interface PolicySegment {
  text: string;
  /** undefined = ordinary prose the parser ignored. */
  field?: PolicyField;
}

interface Span {
  start: number;
  end: number;
  field: PolicyField;
}

/** First matching pattern in a list wins, mirroring `firstPercent`. */
function firstSpan(text: string, patterns: RegExp[], field: PolicyField): Span | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match.index >= 0 && match[0].length > 0) {
      return { start: match.index, end: match.index + match[0].length, field };
    }
  }
  return undefined;
}

/**
 * Split the raw sentence into highlighted and unhighlighted runs.
 *
 * Matching happens against the lowercased string — the same one `parsePolicy`
 * uses — but the returned text is sliced from the ORIGINAL so the user's
 * capitalisation survives. `toLowerCase` is length-preserving for the Latin
 * text these policies are written in, so the offsets line up.
 */
export function segmentPolicy(input: string): PolicySegment[] {
  if (!input) return [];
  const text = input.toLowerCase();

  const found: Span[] = [];
  const drawdown = firstSpan(text, DRAWDOWN_PATTERNS, 'drawdown');
  const deviation = firstSpan(text, DEVIATION_PATTERNS, 'deviation');
  const exit = firstSpan(text, EXIT_PATTERNS, 'exit');
  if (drawdown) found.push(drawdown);
  if (deviation) found.push(deviation);
  if (exit) found.push(exit);

  const modeMatch = CONSERVATIVE_PATTERN.exec(text) ?? AGGRESSIVE_PATTERN.exec(text);
  if (modeMatch) {
    found.push({
      start: modeMatch.index,
      end: modeMatch.index + modeMatch[0].length,
      field: 'mode',
    });
  }

  // The patterns are greedy enough to overlap ("...drops 12% ... exit 50%"
  // can both reach across the same words). Earliest start wins; a later span
  // that collides is dropped rather than clipped, because a half-highlighted
  // phrase reads like a rendering bug.
  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const segments: PolicySegment[] = [];
  let cursor = 0;

  for (const span of found) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      segments.push({ text: input.slice(cursor, span.start) });
    }
    segments.push({ text: input.slice(span.start, span.end), field: span.field });
    cursor = span.end;
  }

  if (cursor < input.length) segments.push({ text: input.slice(cursor) });
  return segments;
}

/** Which fields the sentence actually specified, for "defaulted" badges. */
export function detectedFields(input: string): Record<PolicyField, boolean> {
  const text = input.toLowerCase();
  return {
    drawdown: firstPercent(text, DRAWDOWN_PATTERNS) !== undefined,
    deviation: firstPercent(text, DEVIATION_PATTERNS) !== undefined,
    exit: firstPercent(text, EXIT_PATTERNS) !== undefined,
    mode: CONSERVATIVE_PATTERN.test(text) || AGGRESSIVE_PATTERN.test(text),
  };
}


