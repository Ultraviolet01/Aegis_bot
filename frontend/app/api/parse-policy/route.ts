import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  DEFAULT_DEVIATION_BPS,
  DEFAULT_DRAWDOWN_BPS,
  DEFAULT_EXIT_BPS,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  MIN_DEVIATION_BPS,
  MIN_DRAWDOWN_BPS,
  MIN_SLIPPAGE_BPS,
  boundBps,
  buildFieldWarnings,
  parsePolicy,
  policyAdvisories,
  textDerivedDefaultedFields,
  type PolicyFieldKey,
} from '@/lib/policy';

const MODEL = 'claude-haiku-4-5';

/**
 * Fields the model proposes. Bounds are applied outside the schema so that a
 * value exceeding the envelope is *reported* as clamped rather than silently
 * coerced — the person signing has to see that their own wording was narrowed,
 * not merely receive a smaller number.
 *
 * The schema is deliberately tolerant of presentation: a model may return
 * `"conservative"`, `"800"`, or `"oracle_deviation_bps"` in place of the exact
 * spelling we asked for, and rejecting an otherwise correct reading over
 * capitalisation would drop us to the regex parser for no reason. Anything that
 * cannot be normalised is still rejected outright.
 */
const policyFieldKeys = [
  'drawdownThresholdBps',
  'oracleDeviationThresholdBps',
  'exitPercentBps',
  'maxSlippageBps',
  'targetAsset',
] as const;

/** Case/punctuation-insensitive match against a known field name. */
function normalizeFieldKey(raw: string): (typeof policyFieldKeys)[number] | null {
  const stripped = raw.toLowerCase().replace(/[\s_-]/g, '');
  // `oracle_deviation_bps` is how the agent's parser names the same field.
  const aliases: Record<string, (typeof policyFieldKeys)[number]> = {
    drawdownbps: 'drawdownThresholdBps',
    drawdownthresholdbps: 'drawdownThresholdBps',
    oracledeviationbps: 'oracleDeviationThresholdBps',
    oracledeviationthresholdbps: 'oracleDeviationThresholdBps',
    exitbps: 'exitPercentBps',
    exitpercentbps: 'exitPercentBps',
    maxslippagebps: 'maxSlippageBps',
    targetasset: 'targetAsset',
  };
  return aliases[stripped] ?? null;
}

const proposedPolicySchema = z.object({
  drawdownThresholdBps: z.coerce.number().int(),
  oracleDeviationThresholdBps: z.coerce.number().int(),
  exitPercentBps: z.coerce.number().int(),
  maxSlippageBps: z.coerce.number().int().default(DEFAULT_SLIPPAGE_BPS),
  targetAsset: z
    .string()
    .transform((raw) => raw.trim().toUpperCase())
    .pipe(z.enum(['USDC', 'SOL', 'USDT']))
    .default('USDC'),
  mode: z
    .string()
    .transform((raw) => {
      const trimmed = raw.trim().toLowerCase();
      return (trimmed.charAt(0).toUpperCase() + trimmed.slice(1)) as
        | 'Conservative'
        | 'Balanced'
        | 'Aggressive';
    })
    .pipe(z.enum(['Conservative', 'Balanced', 'Aggressive'])),
  interpretation: z.string().min(1),
  confidence: z.coerce.number().min(0).max(1),
  inferredFields: z.array(z.string()).default([]),
});

function applyBounds(proposed: z.infer<typeof proposedPolicySchema>, policyText: string) {
  const drawdown = boundBps(proposed.drawdownThresholdBps, {
    min: MIN_DRAWDOWN_BPS,
    fallback: DEFAULT_DRAWDOWN_BPS,
  });
  const deviation = boundBps(proposed.oracleDeviationThresholdBps, {
    min: MIN_DEVIATION_BPS,
    fallback: DEFAULT_DEVIATION_BPS,
  });
  const exit = boundBps(proposed.exitPercentBps, {
    min: 1,
    fallback: DEFAULT_EXIT_BPS,
  });
  const slippage = Math.min(
    Math.max(proposed.maxSlippageBps, MIN_SLIPPAGE_BPS),
    MAX_SLIPPAGE_BPS,
  );

  // The model declares what it inferred from defaults; a clamped value is also
  // an inference the user did not ask for, so it is reported the same way.
  // Unrecognised field names are dropped rather than trusted, and the two
  // provably-absent fields are added regardless — a model that under-reports
  // must not be able to present a default as an extraction.
  const defaultedFields = new Set<PolicyFieldKey>([
    ...proposed.inferredFields
      .map(normalizeFieldKey)
      .filter((field): field is PolicyFieldKey => field !== null),
    ...textDerivedDefaultedFields(policyText),
  ]);
  const clampedFields = new Set<PolicyFieldKey>();

  if (drawdown.defaulted) defaultedFields.add('drawdownThresholdBps');
  else if (drawdown.clamped) clampedFields.add('drawdownThresholdBps');

  if (deviation.defaulted) defaultedFields.add('oracleDeviationThresholdBps');
  else if (deviation.clamped) clampedFields.add('oracleDeviationThresholdBps');

  if (exit.defaulted) defaultedFields.add('exitPercentBps');
  else if (exit.clamped) clampedFields.add('exitPercentBps');

  if (proposed.maxSlippageBps < MIN_SLIPPAGE_BPS || proposed.maxSlippageBps > MAX_SLIPPAGE_BPS) {
    clampedFields.add('maxSlippageBps');
  }

  const defaulted = [...defaultedFields];
  const clamped = [...clampedFields];

  const policy = {
    drawdownThresholdBps: drawdown.value,
    oracleDeviationThresholdBps: deviation.value,
    exitPercentBps: exit.value,
    maxSlippageBps: slippage,
    targetAsset: proposed.targetAsset,
    mode: proposed.mode,
    interpretation: proposed.interpretation,
    confidence: proposed.confidence,
    // The warnings quote the values that survived the bounds, not the numbers
    // the model proposed, so the text and the policy above always agree.
    warnings: buildFieldWarnings({
      defaultedFields: defaulted,
      clampedFields: clamped,
      values: {
        drawdownThresholdBps: drawdown.value,
        oracleDeviationThresholdBps: deviation.value,
        exitPercentBps: exit.value,
        maxSlippageBps: slippage,
        targetAsset: proposed.targetAsset,
      },
    }),
    defaultedFields: defaulted,
    clampedFields: clamped,
  };

  return { policy, advisories: policyAdvisories(policy) };
}

/** The regex parser's answer, labelled as such rather than passed off as a model result. */
function deterministicResult(policyText: string, reason: string) {
  const fallback = parsePolicy(policyText);
  const policy = {
    drawdownThresholdBps: fallback.drawdownThresholdBps,
    oracleDeviationThresholdBps: fallback.oracleDeviationThresholdBps,
    exitPercentBps: fallback.exitPercentBps,
    maxSlippageBps: fallback.maxSlippageBps,
    targetAsset: fallback.targetAsset,
    mode: fallback.mode,
    interpretation: `Extracted ${fallback.drawdownThresholdBps / 100}% drawdown and ${fallback.exitPercentBps / 100}% exit to ${fallback.targetAsset}.`,
    confidence: 0.95,
    warnings: fallback.warnings,
    defaultedFields: fallback.defaultedFields,
    clampedFields: fallback.clampedFields,
  };

  return {
    policy,
    advisories: policyAdvisories(policy),
    source: 'deterministic' as const,
    model: 'regex-parser',
    llmSkipReason: reason,
  };
}

export async function POST(req: Request) {
  let policyText = '';
  let llmSkipReason = 'Claude unavailable — deterministic parser used';

  // A body we cannot read is the caller's mistake, not a reason to invent a
  // policy: it gets a 400 rather than a 200 carrying defaults nobody asked for.
  let body: { policyText?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  try {
    policyText = body.policyText as string;
    if (!policyText || typeof policyText !== 'string') {
      return NextResponse.json({ error: 'policyText string is required' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      llmSkipReason = 'ANTHROPIC_API_KEY is not set';
    } else {
      const tools = [
        {
          name: 'extract_policy_parameters',
          description:
            'Extract structured risk policy parameters from plain English text. Report every field you filled with a documented default instead of reading it from the text. All threshold fields must be positive integers (min 1 BPS).',
          input_schema: {
            type: 'object',
            properties: {
              drawdownThresholdBps: {
                type: 'integer',
                description: 'Basis points of drawdown that trigger action (1% = 100 bps, 8% = 800 bps). If unspecified in policy, default to 800 bps (8%). MUST BE > 0.'
              },
              oracleDeviationThresholdBps: {
                type: 'integer',
                description: 'Basis points of oracle/reference deviation (10 = 0.1%, 50 = 0.5%, 200 = 2%). If unspecified in policy, default to 200 bps (2%). MUST BE > 0.'
              },
              exitPercentBps: {
                type: 'integer',
                description: 'Portion of position to move to safety in basis points (1% = 100 bps, 50% = 5000 bps). If unspecified, default to 5000 bps (50%). MUST BE > 0.'
              },
              maxSlippageBps: {
                type: 'integer',
                description: 'Maximum swap slippage in basis points (0.5% = 50 bps). Use 30 bps for cautiously or conservatively, 100 bps for aggressively, and 50 bps otherwise. MUST be 1-500.'
              },
              targetAsset: {
                type: 'string',
                enum: ['USDC', 'SOL', 'USDT'],
                description: 'Target asset to swap into on Solana (USDC, SOL, or USDT). Defaults to USDC.'
              },
              mode: {
                type: 'string',
                enum: ['Conservative', 'Balanced', 'Aggressive'],
                description: 'Execution mode specified or inferred.'
              },
              interpretation: {
                type: 'string',
                description: 'One sentence restating the parsed policy in plain English. If the text named the guarded instrument or a time window, repeat them here — they are context, not policy fields, and would otherwise be lost.'
              },
              confidence: {
                type: 'number',
                description: 'Confidence score from 0.0 to 1.0.'
              },
              inferredFields: {
                type: 'array',
                description: 'Every field above whose value you supplied from a documented default because the policy text did not state it. List the property names exactly. Empty array if the text stated everything.',
                items: {
                  type: 'string',
                  enum: [
                    'drawdownThresholdBps',
                    'oracleDeviationThresholdBps',
                    'exitPercentBps',
                    'maxSlippageBps',
                    'targetAsset'
                  ]
                }
              }
            },
            required: [
              'drawdownThresholdBps',
              'oracleDeviationThresholdBps',
              'exitPercentBps',
              'maxSlippageBps',
              'mode',
              'interpretation',
              'confidence',
              'inferredFields'
            ]
          }
        }
      ];

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          tools,
          tool_choice: { type: 'tool', name: 'extract_policy_parameters' },
          messages: [
            {
              role: 'user',
              content: `Convert this plain-English risk policy into structured parameters: "${policyText}"`
            }
          ]
        })
      });

      if (!response.ok) {
        llmSkipReason = `Claude request failed with HTTP ${response.status}`;
      } else {
        const data = await response.json();
        const toolUseBlock = data.content?.find((block: { type: string }) => block.type === 'tool_use');
        if (!toolUseBlock?.input) {
          llmSkipReason = 'Claude returned no tool_use payload';
        } else {
          const validated = proposedPolicySchema.safeParse(toolUseBlock.input);
          if (!validated.success) {
            // Worth logging rather than swallowing: a model that keeps missing the
            // schema silently degrades every parse to the regex fallback.
            console.error(
              '[parse-policy] Claude output failed schema validation:',
              JSON.stringify(validated.error.issues),
              'raw:',
              JSON.stringify(toolUseBlock.input),
            );
            llmSkipReason = 'Claude output failed schema validation';
          } else {
            const { policy, advisories } = applyBounds(validated.data, policyText);
            return NextResponse.json({
              policy,
              advisories,
              source: 'llm',
              model: MODEL,
              rawUsage: data.usage,
            });
          }
        }
      }
    }
  } catch (err: unknown) {
    // A failure reaching or reading Claude is a real reason to fall back, and is
    // reported rather than hidden so a regex result is never mistaken for a model one.
    llmSkipReason =
      err instanceof Error ? `Parse request failed: ${err.message}` : 'Parse request failed';
  }

  return NextResponse.json(deterministicResult(policyText, llmSkipReason));
}
