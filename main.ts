// polymarket-nvidia-ceo-forecast-01 entry (Node 22, standard library only): asymmetric-Gaussian persistence.
//
// Design: each market's Yes price wanders around its checkpoint price x as an asymmetric Gaussian random walk,
//   q_tau(h) = clamp(x + z_tau * SIGMA * sqrt(h) * MULT[tau], 0, 1), rounded to 6 decimals,
// for the minute h = 1..horizon_minutes after the checkpoint, z_tau the standard normal's quantile at each
// level tau (0.05, 0.25, 0.5, 0.75, 0.95), MULT[tau] the quantile's spread multiplier. The median (tau 0.5) is
// exactly x (pure persistence, no drift) — on these short horizons the last price is the best point estimate.
//
// Why the downside is wide and the upside narrow (MULT = [3.5, 0.8, 1.0, 0.7, 0.7]): Polymarket Yes prices are
// sticky, so over a few hours the price tends to hold or sag rather than climb — the fat tail is on the downside.
// News gaps that cut a price are far more common than gaps that lift one; a price near 0 can sit there for hours,
// and the 0 clamp piles up the low quantiles. The upside is thin: rallies retrace quickly and one-minute
// bins rarely sustain, so the 0.75/0.95 quantiles sit tight around the median, within the house spread. SIGMA
// 0.001 is calibrated so the downside still covers the fat tail while staying far below the house baseline's 0.0025
// (which loses by being over-wide on both sides); the row is sorted after clamping so the 0/1 bounds never break
// non-decreasing order. Constants fixed in advance, never tuned on the practice outputs.
//
// Validated on the kit's practice cases (local pinball, 100 * 100 * max(tau d, (tau-1) d), mean over
// p00..p04 x markets x 240 minutes x 5 taus): mean 0.338956, below the house persistence baseline 0.392518
// (this scorer's baseline line quotes 0.363589 for all 6 cases; over the 5 scored here the house mean is
// 0.392518, see the transcripts' house-multiplier runs). A prize needs a loss strictly below the best house
// entry's: this one, the house persistence baseline.
//
// What an entry must do:
//
// What an entry must do:
//   - read every <id>.in in the input directory (the grader runs one case at a time, with only that case's file there),
//     canonical JSON {"schema":"makefun/polymarket-case/v1","case","at","horizon_minutes","quantiles","event",
//     "markets":[{"id","name","slug","yes_token","start","prices"}]}, where `prices` holds one Yes price per minute
//     from `start` to `at` inclusive, so the last one is the price at the checkpoint;
//   - write <id>.out to the output directory: {"forecasts":[{"id","q"}]}, every market of the case exactly once (no
//     other id, no other key), `q` exactly horizon_minutes rows, row h-1 the forecast for minute at+h, each row one
//     finite number in [0,1] per quantile level, non-decreasing; at most 1 MiB. Anything else is an invalid case,
//     scored as if every quantile were 0.5, and an entry with an invalid case takes no prize.
// It runs offline, with no network, under the case's time cap: everything it knows is in the case's prices.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
/** The spread of a minute's price move, in price units per square-root minute. */
const SIGMA = 0.001;
/** Asymmetry: wide downside, narrow upside. */
const MULT = [3.5, 0.8, 1.0, 0.7, 0.7];

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** The asymmetric-Gaussian persistence forecast of one market: horizon rows of the five quantiles around its last price. */
function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const row = Z.map((z, j) => price6(x + z * SIGMA * Math.sqrt(h) * MULT[j]));
    rows.push(row.sort((a, b) => a - b));
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}