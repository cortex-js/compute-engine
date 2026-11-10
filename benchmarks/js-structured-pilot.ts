/**
 * The structured scalar emitter pilot against the existing JavaScript
 * compiler: step 4 of `docs/plans/2026-11-09-js-compiler-status-and-plan.md`.
 * The report is `docs/plans/2026-11-09-js-structured-pilot-measure.md`.
 *
 * Configurations, compiled on the same engine and the same boxed expression:
 *
 *   A   `JavaScriptTarget`, default options (the cost a host pays today)
 *   A2  the same as A: the calibration of the harness (A2/A)
 *   B   `JavaScriptTarget`, `cse: false, constantFold: false`
 *   C   `ScalarFragmentJavaScriptTarget()` (the existing emitter behind the
 *       annotation), options of B; only for the programs that it admits
 *   D   `ScalarFragmentJavaScriptTarget('structured')`, options of B
 *   Dp  D with an `onPhase` observer: the six phases of D. It reads the
 *       clock twelve times per compilation, so its total is not the total
 *       of D.
 *
 * The fixtures: the step 3 fixtures (`heatwall`, `heatcell`, `complex-if`);
 * three where the common-subexpression pass and the constant folding of A
 * matter (`cse-repeat`, `fold`, `local-reads`); the fixtures of step 5
 * (`sqrt-repeat`, `helper-chain`, `capture`, `local-writes`); two
 * generated trees of about 200 operations; and the corpus programs.
 *
 * The ordinary target is called as `new JavaScriptTarget().compile()`, the
 * method that the fragment target extends, and not through the public
 * `compile()`, which adds its own option checks. MODE=check verifies that
 * both give the same code.
 *
 * Modes (environment variable MODE):
 *
 *   check    value agreement of A, A2, B, C and D on every input, emitted
 *            bytes, admission of C, and the counts of the corpus. No time.
 *   time     check, then the timings: cold compilation on a fresh engine
 *            (in this process), warm compilation, the phases of D and warm
 *            execution of `run()`. JSON on stdout. COLD_PROCESS=n also
 *            times the first compilation in n fresh processes per
 *            configuration for the named and deep fixtures.
 *   lines    the line counts of the pilot and of the existing handlers.
 *   deps     the functions of the existing compiler that the structured
 *            route calls (V8 precise coverage, function granularity).
 *   extract  write `js-structured-pilot-corpus.json` from the Tycho codegen
 *            audit artifacts (CORPUS_DIR, CORPUS_FILES).
 *   cold-child  internal: one first compilation in this process.
 *
 * Other variables: ONLY (comma-separated fixture ids, or `corpus`,
 * `named` or `deep`), CORPUS (`all` for the 546 corpus programs; otherwise
 * the first program of each row, at most CORPUS programs, default 40), GC
 * (`batch`: a full collection before each timed batch; default: before each
 * round), RUNS (rounds, default 9), ITERATIONS (compilations per warm
 * batch, default 10), TRIALS (fresh-engine trials, default 9; 3 for the
 * corpus), EXEC_MS (target milliseconds per execution batch, default 2).
 *
 *   node --expose-gc --import tsx benchmarks/js-structured-pilot.ts
 *   CORPUS=all COLD_PROCESS=5 node --expose-gc --import tsx benchmarks/js-structured-pilot.ts
 *   MODE=check node --import tsx benchmarks/js-structured-pilot.ts
 *   MODE=lines node --import tsx benchmarks/js-structured-pilot.ts
 *
 * Hold the box lock for MODE=time. Setup, boxing and value checks are
 * outside the timers. A full garbage collection runs before each timed
 * batch (before each round for a corpus program). The configurations of each round run in a new random order (fixed
 * seed); a ratio X/B is computed per round and reported as the median and
 * the range of those ratios.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Session } from 'node:inspector';
// The rule against bare package imports is written for `src/`, whose
// published code may import only its runtime dependencies. This script is
// not published; it needs the TypeScript parser for the line counts.
// oxlint-disable-next-line no-restricted-imports
import ts from 'typescript';

import { ComputeEngine, compile } from '../src/compute-engine';
import { JavaScriptTarget } from '../src/compute-engine/compilation/javascript-target';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
} from '../src/compute-engine/compilation/javascript-fragment-target';
import type { Expression } from '../src/compute-engine/global-types';
import type { MathJsonExpression } from '../src/math-json/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CORPUS_FILE = resolve(HERE, 'js-structured-pilot-corpus.json');
const MODE = process.env.MODE ?? 'time';
const RUNS = Number(process.env.RUNS ?? 9);
const ITERATIONS = Number(process.env.ITERATIONS ?? 10);
const EXEC_MS = Number(process.env.EXEC_MS ?? 2);

const gc: () => void =
  (globalThis as { gc?: () => void }).gc ??
  (() => {
    if (MODE === 'time') throw new Error('MODE=time needs node --expose-gc');
  });

//
// Fixtures
//

type Value = number | boolean | { re: number; im: number };
/** The inputs of one call: positional arguments of a `Function` literal,
 *  or the vars object of an expression. */
type Inputs = Value[] | Record<string, Value>;

type Fixture = {
  id: string;
  kind: 'named' | 'deep' | 'corpus';
  json: MathJsonExpression;
  /** The declared type of each free symbol. */
  declare: Record<string, string>;
  /** Assign the helper `heatwall` in the engine. */
  heatwall?: boolean;
  /** Declare and assign the helpers and the captured bindings of the
   *  fixture, after the free symbols. */
  setup?: (ce: ComputeEngine) => void;
  inputs: Inputs[];
  /** Provenance of a corpus program. */
  source?: { doc: string; row: string; input: string };
};

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

// The fixtures of test/compute-engine/compile-javascript-structured-emit.test.ts.
const HEATWALL_BODY: MathJsonExpression = [
  'And',
  ['Greater', 'obstacle', 0.5],
  ['Equal', 'c', 16],
  ['Or', ['Less', 'r', 13], ['Greater', 'r', 18]],
];

const HEATCELL: MathJsonExpression = [
  'Function',
  [
    'Block',
    ['Declare', 'a', "'real'", ['Min', 0.25, ['Max', 0, 'd']]],
    [
      'If',
      ['heatwall', 'c', 'r', 'obstacle'],
      'v',
      ['Add', 'v', ['Multiply', 'a', ['Subtract', 's', ['Multiply', 4, 'v']]]],
    ],
  ],
  typed('v', 'real'),
  typed('s', 'real'),
  typed('d', 'real'),
  typed('c', 'integer'),
  typed('r', 'integer'),
  typed('obstacle', 'real'),
];

function product<T>(...lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])),
    [[]]
  );
}

/** A deterministic generator of numbers in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REAL_LEAVES = ['x', 'y', 's', 't'];

/**
 * A tree of about `budget` operations over the real inputs x, y, s, t and
 * the boolean inputs C, D. `full`: every operator of the pilot vocabulary
 * (Add, Negate, Multiply, Min, Max, If, Less, Equal, And, Or). Otherwise
 * Add, Negate and If on a boolean input only: the operators that the
 * existing fragment route (C) admits. A child never has the operator of
 * its parent, so that the canonical form does not flatten the tree.
 */
function deepTree(seed: number, budget: number, full: boolean): MathJsonExpression {
  const r = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const leaf = (): MathJsonExpression => pick(REAL_LEAVES);
  const condition = (b: number, parent: string): MathJsonExpression => {
    if (!full || b <= 0) return pick(['C', 'D']);
    const op = pick(['Less', 'Equal', 'And', 'Or'].filter((o) => o !== parent));
    const left = Math.floor((b - 1) / 2);
    if (op === 'Less' || op === 'Equal')
      return [op, real(left, op), real(b - 1 - left, op)];
    return [op, condition(left, op), condition(b - 1 - left, op)];
  };
  const real = (b: number, parent: string): MathJsonExpression => {
    if (b <= 0) return leaf();
    const ops = (full
      ? ['Add', 'Multiply', 'Negate', 'Min', 'Max', 'If']
      : ['Add', 'Negate', 'If']
    ).filter((o) => o !== parent);
    const op = pick(ops);
    if (op === 'Negate') return ['Negate', real(b - 1, 'Negate')];
    if (op === 'Multiply')
      // One factor is a symbol or a literal in [0.5, 1): the values stay
      // finite on the inputs.
      return [
        'Multiply',
        r() < 0.5 ? leaf() : 0.5 + Math.floor(r() * 8) / 16,
        real(b - 1, 'Multiply'),
      ];
    if (op === 'If') {
      const c = full ? Math.min(3, Math.floor((b - 1) / 3)) : 0;
      const rest = b - 1 - c;
      const left = Math.floor(rest / 2);
      return ['If', condition(c, 'If'), real(left, 'If'), real(rest - left, 'If')];
    }
    const left = Math.floor((b - 1) * (0.3 + 0.4 * r()));
    return [op, real(left, op), real(b - 1 - left, op)];
  };
  return real(budget, '');
}

function deepInputs(n: number): Inputs[] {
  const r = random(7);
  const v = () => Math.round((r() * 3 - 1.5) * 64) / 64;
  return Array.from({ length: n }, (_, i) => ({
    x: v(),
    y: v(),
    s: v(),
    t: v(),
    C: i % 2 === 0,
    D: i % 3 === 0,
  }));
}

const DEEP_DECLARE = { x: 'real', y: 'real', s: 'real', t: 'real', C: 'boolean', D: 'boolean' };

function namedFixtures(): Fixture[] {
  return [
    {
      id: 'heatwall',
      kind: 'named',
      json: HEATWALL_BODY,
      declare: { c: 'integer', r: 'integer', obstacle: 'real' },
      inputs: product<number>([0, 0.5, 1], [15, 16], [12, 13, 15, 18, 19]).map(
        ([obstacle, c, r]) => ({ obstacle, c, r })
      ),
    },
    {
      id: 'heatcell',
      kind: 'named',
      json: HEATCELL,
      declare: {},
      heatwall: true,
      inputs: [
        [1, 2, 0.1, 3, 15, 0],
        [1, 2, 0.1, 16, 13, 1],
        [1, 2, 0.1, 16, 18, 1],
        [1, 2, 0.1, 16, 12, 1],
        [1, 2, 0.1, 16, 19, 1],
        [1, 2, 0.1, 16, 19, 0.5],
        [1, 2, -1, 3, 15, 0],
        [1, 2, 1, 3, 15, 0],
        [-3, 0.5, 0.25, 16, 15, 1],
      ],
    },
    {
      id: 'complex-if',
      kind: 'named',
      json: ['Add', ['If', 'C', 'x', 'z'], 'y'],
      declare: { C: 'boolean', x: 'real', y: 'real', z: 'complex' },
      inputs: [true, false].map((C) => ({ C, x: 1, y: 2, z: { re: 3, im: 4 } })),
    },
    // The fixtures where the common-subexpression pass and the constant
    // folding of A matter: D (and B) do neither.
    {
      // `x·y + max(s, t)` four times, in four different operators, so that
      // the canonical form does not merge the occurrences. A computes it
      // once (`_cse1`); B and D four times.
      id: 'cse-repeat',
      kind: 'named',
      json: [
        'Add',
        ['Max', REPEATED, 's'],
        ['Min', REPEATED, 't'],
        ['Multiply', 'y', REPEATED],
        ['Negate', REPEATED],
      ],
      declare: REAL_DECLARE,
      inputs: deepInputs(16),
    },
    {
      // `min(0.25, max(0, 0.5))` is a constant subtree that the canonical
      // form keeps: A writes `0.25`, B and D the two calls.
      id: 'fold',
      kind: 'named',
      json: ['Add', 'x', ['Multiply', ['Min', 0.25, ['Max', 0, 0.5]], 'y']],
      declare: REAL_DECLARE,
      inputs: deepInputs(16),
    },
    {
      // A local read four times: every configuration computes it once.
      id: 'local-reads',
      kind: 'named',
      json: [
        'Function',
        [
          'Block',
          ['Declare', 'a', "'real'", ['Max', 0, ['Add', 'x', 'y']]],
          [
            'Add',
            ['Multiply', 'a', 'x'],
            ['Multiply', 'a', 'y'],
            ['Max', 'a', 's'],
            ['Min', 'a', 't'],
          ],
        ],
        typed('x', 'real'),
        typed('y', 'real'),
        typed('s', 'real'),
        typed('t', 'real'),
      ],
      declare: {},
      inputs: deepInputs(16).map((v) => {
        const r = v as Record<string, Value>;
        return [r.x, r.y, r.s, r.t];
      }),
    },
  ];
}

/** Assign the helper `name` of the signature `signature`. */
function install(
  ce: ComputeEngine,
  name: string,
  signature: string,
  body: MathJsonExpression,
  parameters: MathJsonExpression[]
): void {
  ce.declare(name, signature);
  ce.assign(name, ce.expr(['Function', body, ...parameters]));
}

/** The fixtures of step 5: a costly operation repeated, a chain of helpers,
 *  a captured binding, and writes of a local merged after an `If`. */
function step5Fixtures(): Fixture[] {
  return [
    {
      // `√(max(0, x) + y·s + 1)` four times, in four different operators,
      // so that the canonical form does not merge the occurrences. A
      // computes it once (`_cse1`); B and D four times.
      id: 'sqrt-repeat',
      kind: 'named',
      json: [
        'Add',
        ['Max', SQRT_REPEATED, 's'],
        ['Min', SQRT_REPEATED, 't'],
        ['Multiply', 'y', SQRT_REPEATED],
        ['Negate', SQRT_REPEATED],
      ],
      declare: REAL_DECLARE,
      inputs: deepInputs(16),
    },
    {
      // `h1(x) + h1(y)`, where `h1` calls `h2` and `h2` calls `h3`.
      id: 'helper-chain',
      kind: 'named',
      json: ['Add', ['h1', 'x'], ['h1', 'y']],
      declare: REAL_DECLARE,
      setup: (ce) => {
        install(ce, 'h3', '(real) -> real', ['Add', ['Max', 0, 'w'], 1], [typed('w', 'real')]);
        install(ce, 'h2', '(real) -> real', ['Multiply', 2, ['h3', 'v']], [typed('v', 'real')]);
        install(ce, 'h1', '(real) -> real', ['Add', ['h2', 'u'], ['Negate', 'u']], [typed('u', 'real')]);
      },
      inputs: deepInputs(16),
    },
    {
      // `offset` read in the root and in the helper `g`.
      id: 'capture',
      kind: 'named',
      json: ['Add', ['g', 'x'], ['Multiply', 'offset', 'y']],
      declare: REAL_DECLARE,
      setup: (ce) => {
        ce.declare('offset', 'real');
        ce.assign('offset', 2.5);
        install(ce, 'g', '(real) -> real', ['Add', 'u', 'offset'], [typed('u', 'real')]);
      },
      inputs: deepInputs(16),
    },
    {
      // A local written in both branches of an `If` statement and after
      // it: the structured route merges the two values after the `If`.
      id: 'local-writes',
      kind: 'named',
      json: [
        'Function',
        [
          'Block',
          ['Declare', 'a', "'real'", 'x'],
          ['If', ['Less', 'x', 'y'], ['Assign', 'a', ['Add', 'a', 'y']], ['Assign', 'a', ['Multiply', 'a', 2]]],
          ['Assign', 'a', ['Max', 'a', 's']],
          ['Add', 'a', 't'],
        ],
        typed('x', 'real'),
        typed('y', 'real'),
        typed('s', 'real'),
        typed('t', 'real'),
      ],
      declare: {},
      inputs: deepInputs(16).map((v) => {
        const r = v as Record<string, Value>;
        return [r.x, r.y, r.s, r.t];
      }),
    },
  ];
}

/** The square root that `sqrt-repeat` repeats. */
const SQRT_REPEATED: MathJsonExpression = [
  'Sqrt',
  ['Add', ['Max', 0, 'x'], ['Multiply', 'y', 's'], 1],
];

/** The subexpression that `cse-repeat` repeats. */
const REPEATED: MathJsonExpression = ['Add', ['Multiply', 'x', 'y'], ['Max', 's', 't']];

const REAL_DECLARE = { x: 'real', y: 'real', s: 'real', t: 'real' };

/** The deep trees: the seed and the budget give about 200 operations
 *  after canonicalization (the count is measured and reported). */
function deepFixtures(): Fixture[] {
  return [
    {
      id: 'deep-full',
      kind: 'deep',
      json: deepTree(11, 200, true),
      declare: DEEP_DECLARE,
      inputs: deepInputs(16),
    },
    {
      id: 'deep-add-if',
      kind: 'deep',
      json: deepTree(5, 200, false),
      declare: DEEP_DECLARE,
      inputs: deepInputs(16),
    },
  ];
}

type CorpusFile = {
  provenance: Record<string, unknown>;
  programs: {
    id: string;
    doc: string;
    row: string;
    input: string;
    json: MathJsonExpression;
    declare: Record<string, string>;
  }[];
};

/** Values of a free symbol of the declared `type`, from `r`. */
function sampleOf(type: string, r: () => number): Value {
  if (type.includes('boolean')) return r() < 0.5;
  if (type.includes('complex'))
    return { re: Math.round((r() * 4 - 2) * 64) / 64, im: Math.round((r() * 4 - 2) * 64) / 64 };
  const range = /<(.*)\.\.(.*)>/.exec(type);
  let lo = range && range[1] !== '' ? Number(range[1]) : -10;
  let hi = range && range[2] !== '' ? Number(range[2]) : 10;
  lo = Math.max(lo, -10);
  hi = Math.min(hi, 10);
  if (!(hi >= lo)) [lo, hi] = [-10, 10];
  if (type.includes('integer')) return Math.ceil(lo) + Math.floor(r() * (Math.floor(hi) - Math.ceil(lo) + 1));
  return Math.round((lo + r() * (hi - lo)) * 256) / 256;
}

function corpusFixtures(): Fixture[] {
  if (!existsSync(CORPUS_FILE)) return [];
  const corpus = JSON.parse(readFileSync(CORPUS_FILE, 'utf8')) as CorpusFile;
  // CORPUS=all: every program. Otherwise a sample: the first program of
  // each row (document and row), in file order, at most CORPUS (default
  // 40) programs.
  const rows = new Set<string>();
  const limit = process.env.CORPUS === 'all' ? Infinity : Number(process.env.CORPUS ?? 40);
  const selected = corpus.programs.filter((p) => {
    if (process.env.CORPUS === 'all') return true;
    const key = `${p.doc}\u0000${p.row}`;
    if (rows.has(key) || rows.size >= limit) return false;
    rows.add(key);
    return true;
  });
  return selected.map((p) => {
    const i = corpus.programs.indexOf(p);
    const r = random(1000 + i);
    return {
      id: p.id,
      kind: 'corpus',
      json: p.json,
      declare: p.declare,
      inputs: Array.from({ length: 16 }, () =>
        Object.fromEntries(Object.entries(p.declare).map(([n, t]) => [n, sampleOf(t, r)]))
      ),
      source: { doc: p.doc, row: p.row, input: p.input },
    };
  });
}

function allFixtures(): Fixture[] {
  const all = [
    ...namedFixtures(),
    ...step5Fixtures(),
    ...deepFixtures(),
    ...corpusFixtures(),
  ];
  const only = process.env.ONLY?.split(',').filter((o) => o !== '');
  if (!only) return all;
  const selected = all.filter(
    (f) => only.includes(f.id) || only.includes(f.kind)
  );
  for (const o of only)
    if (!all.some((f) => f.id === o || f.kind === o))
      throw new Error(`Unknown fixture ${o}`);
  return selected;
}

//
// Engines and configurations
//

function engineFor(fixture: Fixture): ComputeEngine {
  const ce = new ComputeEngine();
  if (fixture.heatwall) {
    for (const [name, type] of [
      ['c', 'integer'],
      ['r', 'integer'],
      ['obstacle', 'real'],
    ])
      ce.declare(name, type);
    ce.declare('heatwall', '(integer, integer, real) -> boolean');
    ce.assign(
      'heatwall',
      ce.expr([
        'Function',
        HEATWALL_BODY,
        typed('c', 'integer'),
        typed('r', 'integer'),
        typed('obstacle', 'real'),
      ])
    );
  }
  for (const [name, type] of Object.entries(fixture.declare)) ce.declare(name, type);
  fixture.setup?.(ce);
  return ce;
}

type Config = 'A' | 'A2' | 'B' | 'C' | 'D' | 'Dp';
const PILOT_OPTIONS = { cse: false, constantFold: false, fallback: false } as const;

type Phases = Record<StructuredPhase, number>;
const PHASES: StructuredPhase[] = [
  'preparation',
  'annotation',
  'lowering',
  'verification',
  'emission',
  'assembly',
];

type Result = ReturnType<JavaScriptTarget['compile']>;

function compileWith(config: Config, expr: Expression, phases?: Phases): Result {
  switch (config) {
    case 'A':
    case 'A2':
      return new JavaScriptTarget().compile(expr, { fallback: false });
    case 'B':
      return new JavaScriptTarget().compile(expr, PILOT_OPTIONS);
    case 'C':
      return new ScalarFragmentJavaScriptTarget().compile(expr, PILOT_OPTIONS);
    case 'D':
      return new ScalarFragmentJavaScriptTarget('structured').compile(expr, PILOT_OPTIONS);
    case 'Dp':
      return new ScalarFragmentJavaScriptTarget('structured', undefined, {
        onPhase: (phase, ms) => {
          phases![phase] += ms;
        },
      }).compile(expr, PILOT_OPTIONS);
  }
}

const zeroPhases = (): Phases =>
  Object.fromEntries(PHASES.map((p) => [p, 0])) as Phases;

//
// Values
//

function callRun(result: Result, inputs: Inputs): unknown {
  const run = result.run as unknown as (...a: unknown[]) => unknown;
  return Array.isArray(inputs) ? run(...inputs) : run(inputs);
}

/** Same value: numbers by `Object.is` (NaN equals NaN, 0 differs from
 *  -0), complex values by part, booleans by `===`. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const p = a as { re: number; im: number };
    const q = b as { re: number; im: number };
    return sameValue(p.re, q.re) && sameValue(p.im, q.im);
  }
  return a === b;
}

/** Equal except for the sign of a zero. */
function sameUpToZeroSign(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const p = a as { re: number; im: number };
    const q = b as { re: number; im: number };
    return sameUpToZeroSign(p.re, q.re) && sameUpToZeroSign(p.im, q.im);
  }
  return a === b;
}

function countOperations(expr: Expression): number {
  let n = 0;
  const seen = new Set<Expression>();
  const walk = (e: Expression) => {
    if (seen.has(e)) return;
    seen.add(e);
    const ops = (e as { ops?: readonly Expression[] }).ops;
    if (ops && (e as { operator?: string }).operator !== undefined) {
      const op = (e as { operator: string }).operator;
      // The parameters of a `Function` literal and a `Declare` are not
      // operations; their bodies are walked.
      if (!['Function', 'Block', 'Declare', 'Typed', 'Complex'].includes(op)) n++;
      for (const o of ops) walk(o);
    }
  };
  walk(expr);
  return n;
}

type Prepared = {
  fixture: Fixture;
  ce: ComputeEngine;
  expr: Expression;
  operations: number;
  /** The configurations that compile this program: C may not. */
  configs: Config[];
  results: Partial<Record<Config, Result>>;
  cDecline?: string;
  dDecline?: string;
  bytes: Partial<Record<Config, { code: number; preamble: number }>>;
  agreement: { inputs: number; differences: string[]; zeroSignOnly: string[] };
  publicCodeMatches: boolean;
};

function prepare(fixture: Fixture): Prepared {
  const ce = engineFor(fixture);
  const expr = ce.expr(fixture.json);
  const results: Partial<Record<Config, Result>> = {};
  const configs: Config[] = [];
  let cDecline: string | undefined;
  let dDecline: string | undefined;
  for (const config of ['A', 'A2', 'B', 'C', 'D'] as Config[]) {
    try {
      results[config] = compileWith(config, expr);
      configs.push(config);
    } catch (e) {
      const message = (e as Error).message;
      if (config === 'C') cDecline = message;
      else if (config === 'D') dDecline = message;
      else throw e;
    }
  }
  if (results.D) configs.push('Dp');
  const bytes: Prepared['bytes'] = {};
  for (const c of configs)
    if (results[c])
      bytes[c] = {
        code: Buffer.byteLength(results[c]!.code ?? ''),
        preamble: Buffer.byteLength(results[c]!.preamble ?? ''),
      };
  // The value agreement, with A as the reference.
  const differences: string[] = [];
  const zeroSignOnly: string[] = [];
  for (const inputs of fixture.inputs) {
    const reference = callRun(results.A!, inputs);
    for (const c of ['A2', 'B', 'C', 'D'] as Config[]) {
      if (!results[c]) continue;
      const v = callRun(results[c]!, inputs);
      if (sameValue(v, reference)) continue;
      const line = `${c} ${JSON.stringify(inputs)}: ${String(JSON.stringify(v))} vs A ${String(JSON.stringify(reference))}`;
      if (sameUpToZeroSign(v, reference)) zeroSignOnly.push(line);
      else differences.push(line);
    }
  }
  // Control: the public `compile()` writes the code of A.
  const pub = compile(expr, { fallback: false });
  return {
    fixture,
    ce,
    expr,
    operations: countOperations(expr),
    configs,
    results,
    cDecline,
    dDecline,
    bytes,
    agreement: { inputs: fixture.inputs.length, differences, zeroSignOnly },
    publicCodeMatches: pub.code === results.A!.code,
  };
}

//
// Statistics
//

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
type Stat = { median: number; min: number; max: number; n: number };
const stat = (xs: number[]): Stat => ({
  median: median(xs),
  min: Math.min(...xs),
  max: Math.max(...xs),
  n: xs.length,
});

/** Per-round values of each configuration, and the per-round ratios. */
type Series = Partial<Record<Config | 'floor', number[]>>;

function summarize(series: Series): Record<string, Stat> {
  const out: Record<string, Stat> = {};
  for (const [k, v] of Object.entries(series)) if (v && v.length) out[k] = stat(v);
  const ratio = (x: Config, base: Config) => {
    const a = series[x];
    const b = series[base];
    if (!a || !b || a.length !== b.length) return;
    out[`${x}/${base}`] = stat(a.map((v, i) => v / b[i]));
  };
  ratio('A2', 'A');
  ratio('D', 'B');
  ratio('D', 'A');
  ratio('C', 'B');
  ratio('D', 'C');
  ratio('B', 'A');
  return out;
}

const orderRandom = random(12345);

/**
 * The order of the configurations in one round: a new random permutation
 * for each round, from a fixed seed. A rotation is not used: with it, a
 * configuration always follows the same neighbour (A2 follows A), and a
 * batch that follows a batch of the same compiler ran about 17% faster,
 * which biased the calibration A2/A to 0.83.
 */
function roundOrder<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(orderRandom() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const now = () => Number(process.hrtime.bigint()) / 1e6;

//
// Timings
//

/** First compilation on a fresh engine, in this process. */
function timeColdEngine(p: Prepared, trials: number): Series {
  const series: Series = {};
  const configs = p.configs.filter((c) => c !== 'Dp');
  for (let t = 0; t < trials; t++) {
    for (const c of roundOrder(configs)) {
      const ce = engineFor(p.fixture);
      const expr = ce.expr(p.fixture.json);
      gc();
      const t0 = now();
      compileWith(c, expr);
      const ms = now() - t0;
      (series[c] ??= []).push(ms);
    }
  }
  return series;
}

/**
 * A full collection before each round (default), or before each timed
 * batch with GC=batch. One collection per batch made a run of the 546
 * corpus programs take more than an hour. The random order of
 * `roundOrder()` spreads over the configurations the cost that the first
 * batches after a collection pay.
 */
const gcPerBatch = (_p: Prepared) => process.env.GC === 'batch';

/** Warm compilation: ITERATIONS compilations per batch, a new target for
 *  each, on the boxed expression of `p`. */
function timeWarmCompile(p: Prepared): { series: Series; phases: Record<string, Stat> } {
  const configs = p.configs;
  for (const c of configs) for (let k = 0; k < 5; k++) compileWith(c, p.expr, zeroPhases());
  const series: Series = {};
  const phaseRounds: Record<StructuredPhase, number[]> = Object.fromEntries(
    PHASES.map((ph) => [ph, [] as number[]])
  ) as never;
  const perBatch = gcPerBatch(p);
  for (let round = 0; round < RUNS; round++) {
    if (!perBatch) gc();
    for (const c of roundOrder(configs)) {
      const phases = zeroPhases();
      if (perBatch) gc();
      const t0 = now();
      for (let k = 0; k < ITERATIONS; k++) compileWith(c, p.expr, phases);
      const ms = (now() - t0) / ITERATIONS;
      (series[c] ??= []).push(ms);
      if (c === 'Dp') for (const ph of PHASES) phaseRounds[ph].push(phases[ph] / ITERATIONS);
    }
  }
  const phases: Record<string, Stat> = {};
  if (configs.includes('Dp')) for (const ph of PHASES) phases[ph] = stat(phaseRounds[ph]);
  return { series, phases };
}

/** A loop that calls `run` on every input `n` times and consumes each
 *  value, made once per configuration so that each has its own call site. */
function makeRunner(fixture: Fixture): (run: unknown, inputs: Inputs[], n: number) => number {
  const arity = Array.isArray(fixture.inputs[0]) ? fixture.inputs[0].length : -1;
  const call =
    arity < 0
      ? 'run(inputs[i])'
      : `run(${Array.from({ length: arity }, (_, j) => `a[${j}]`).join(', ')})`;
  return new Function(
    'run',
    'inputs',
    'n',
    `let acc = 0;
     for (let k = 0; k < n; k++)
       for (let i = 0; i < inputs.length; i++) {
         const a = inputs[i];
         const v = ${call};
         acc += typeof v === 'number' ? v : v === true ? 1 : v === false ? 0.5 : v.re + v.im;
       }
     return acc;`
  ) as never;
}

let sink = 0;

/** Warm execution of `run()` over the inputs of the fixture, in ns per
 *  call. `floor` is the same loop around a function that returns 0. With
 *  `raw`, the loop calls `run.rawCall`, the compiled body without the entry
 *  check, the precision frame and the normalization of the result of
 *  `run()`; it exists only for a vars object (not for a `Function`
 *  literal), and returns undefined otherwise. */
function timeExecution(p: Prepared, raw = false): { series: Series; iterations: number } | undefined {
  const inputs = p.fixture.inputs;
  if (raw && Array.isArray(inputs[0])) return undefined;
  const configs = [...p.configs.filter((c) => c !== 'Dp'), 'floor'] as (Config | 'floor')[];
  const runs = new Map<Config | 'floor', unknown>();
  const runners = new Map<Config | 'floor', ReturnType<typeof makeRunner>>();
  for (const c of configs) {
    const run = c === 'floor' ? () => 0 : p.results[c as Config]!.run;
    runs.set(
      c,
      raw && c !== 'floor' ? (run as unknown as { rawCall: unknown }).rawCall : run
    );
    runners.set(c, makeRunner(p.fixture));
  }
  // Control: the raw body gives the value of `run()`, which writes a complex
  // value with a zero imaginary part as a real number.
  const normalized = (v: unknown) =>
    typeof v === 'object' && v !== null && (v as { im: number }).im === 0
      ? (v as { re: number }).re
      : v;
  if (raw)
    for (const c of configs) {
      if (c === 'floor') continue;
      for (const x of inputs)
        if (!sameValue(normalized((runs.get(c) as (v: unknown) => unknown)(x)), callRun(p.results[c]!, x)))
          throw new Error(`rawCall of ${c} differs from run() on ${p.fixture.id}`);
    }
  // The number of passes over the inputs for a batch of about EXEC_MS.
  let n = 1;
  for (;;) {
    const t0 = now();
    sink += runners.get('A')!(runs.get('A'), inputs, n);
    if (now() - t0 >= EXEC_MS || n > 1 << 24) break;
    n *= 2;
  }
  for (const c of configs) for (let k = 0; k < 3; k++) sink += runners.get(c)!(runs.get(c), inputs, n);
  const series: Series = {};
  const perBatch = gcPerBatch(p);
  for (let round = 0; round < RUNS; round++) {
    if (!perBatch) gc();
    for (const c of roundOrder(configs)) {
      if (perBatch) gc();
      const t0 = now();
      sink += runners.get(c)!(runs.get(c), inputs, n);
      const ns = ((now() - t0) * 1e6) / (n * inputs.length);
      (series[c] ??= []).push(ns);
    }
  }
  return { series, iterations: n };
}

/** First compilation in `n` fresh processes per configuration. */
function timeColdProcess(p: Prepared, n: number): Series {
  const series: Series = {};
  const configs = p.configs.filter((c) => c !== 'Dp');
  for (let t = 0; t < n; t++)
    for (const c of roundOrder(configs)) {
      const out = spawnSync(
        process.execPath,
        ['--expose-gc', '--import', 'tsx', fileURLToPath(import.meta.url)],
        {
          cwd: ROOT,
          env: { ...process.env, MODE: 'cold-child', ONLY: p.fixture.id, CONFIG: c },
          encoding: 'utf8',
        }
      );
      if (out.status !== 0) throw new Error(`cold child failed: ${out.stderr}`);
      const line = out.stdout.trim().split('\n').pop()!;
      (series[c] ??= []).push(JSON.parse(line).ms);
    }
  return series;
}

function coldChild(): void {
  const fixture = allFixtures()[0];
  const ce = engineFor(fixture);
  const expr = ce.expr(fixture.json);
  gc();
  const t0 = now();
  compileWith(process.env.CONFIG as Config, expr);
  const ms = now() - t0;
  console.log(JSON.stringify({ ms }));
}

//
// Modes
//

function environment() {
  const rev = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--', 'src'],
    { cwd: ROOT, encoding: 'utf8' }
  ).trim();
  return {
    commit: rev,
    srcModified: dirty === '' ? [] : dirty.split('\n'),
    node: process.version,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    loadavg: loadavg(),
    runs: RUNS,
    iterations: ITERATIONS,
    execMs: EXEC_MS,
  };
}

function checkReport(prepared: Prepared[]) {
  return prepared.map((p) => ({
    id: p.fixture.id,
    kind: p.fixture.kind,
    operations: p.operations,
    configs: p.configs,
    cApplies: p.results.C !== undefined,
    cDecline: p.cDecline,
    dDecline: p.dDecline,
    bytes: p.bytes,
    agreement: p.agreement,
    publicCodeMatches: p.publicCodeMatches,
  }));
}

function modeCheck(): Prepared[] {
  const fixtures = allFixtures();
  const prepared = fixtures.map(prepare);
  const report = checkReport(prepared);
  const differences = report.flatMap((r) => r.agreement.differences.map((d) => `${r.id}: ${d}`));
  const zeroSign = report.flatMap((r) => r.agreement.zeroSignOnly.map((d) => `${r.id}: ${d}`));
  const summary = {
    fixtures: report.length,
    corpusPrograms: report.filter((r) => r.kind === 'corpus').length,
    corpusAdmittedByD: report.filter((r) => r.kind === 'corpus' && !r.dDecline).length,
    corpusAdmittedByC: report.filter((r) => r.kind === 'corpus' && r.cApplies).length,
    inputsChecked: report.reduce((s, r) => s + r.agreement.inputs, 0),
    valueDifferences: differences,
    zeroSignDifferences: zeroSign,
    publicCodeMismatches: report.filter((r) => !r.publicCodeMatches).map((r) => r.id),
  };
  console.log(JSON.stringify({ mode: 'check', environment: environment(), summary }));
  for (const r of report)
    if (r.kind !== 'corpus') console.log(JSON.stringify({ check: r }));
  console.log(
    JSON.stringify({
      corpusBytes: corpusBytes(prepared.filter((p) => p.fixture.kind === 'corpus')),
    })
  );
  if (differences.length > 0 || summary.publicCodeMismatches.length > 0) process.exitCode = 1;
  return prepared;
}

/** The emitted bytes of the corpus: sums over the programs that every
 *  compared configuration compiles. */
function corpusBytes(prepared: Prepared[]) {
  const sums: Record<string, { code: number; preamble: number; programs: number }> = {};
  for (const c of ['A', 'B', 'D'] as Config[]) {
    const s = { code: 0, preamble: 0, programs: 0 };
    for (const p of prepared) {
      const b = p.bytes[c];
      if (!b || !p.results.D) continue;
      s.code += b.code;
      s.preamble += b.preamble;
      s.programs++;
    }
    sums[c] = s;
  }
  const withC = prepared.filter((p) => p.results.C && p.results.D);
  for (const c of ['B', 'C', 'D'] as Config[])
    sums[`${c} (programs that C admits)`] = {
      code: withC.reduce((s, p) => s + p.bytes[c]!.code, 0),
      preamble: withC.reduce((s, p) => s + p.bytes[c]!.preamble, 0),
      programs: withC.length,
    };
  return sums;
}

function modeTime(): void {
  modeCheck();
  if (process.exitCode) throw new Error('values differ: no timing');
  const coldProcess = Number(process.env.COLD_PROCESS ?? 0);
  const corpus: Record<string, { cold: Series; warm: Series; exec: Series; raw: Series; phases: Record<string, Stat> }> = {};
  // Each program is prepared again here and released after its timings, so
  // that the heap holds one program at a time.
  let done = 0;
  for (const fixture of allFixtures()) {
    const p = prepare(fixture);
    if (++done % 50 === 0) process.stderr.write(`${done} programs timed\n`);
    if (!p.results.D) continue;
    const isCorpus = p.fixture.kind === 'corpus';
    const trials = Number(process.env.TRIALS ?? (isCorpus ? 3 : 9));
    const cold = timeColdEngine(p, trials);
    const warm = timeWarmCompile(p);
    const exec = timeExecution(p)!;
    const raw = timeExecution(p, true);
    if (isCorpus) {
      corpus[p.fixture.id] = { cold, warm: warm.series, exec: exec.series, raw: raw!.series, phases: warm.phases };
      // The per-round values of each program, for subsets of the corpus.
      console.log(
        JSON.stringify({
          corpusProgram: { id: p.fixture.id, doc: p.fixture.source?.doc, row: p.fixture.source?.row, operations: p.operations, cApplies: p.results.C !== undefined, bytes: p.bytes, cold, warm: warm.series, exec: exec.series, raw: raw!.series },
        })
      );
      continue;
    }
    const record: Record<string, unknown> = {
      id: p.fixture.id,
      operations: p.operations,
      configs: p.configs,
      coldEngine: summarize(cold),
      warmCompile: summarize(warm.series),
      phasesD: warm.phases,
      execution: { ...summarize(exec.series), passes: exec.iterations, inputs: p.fixture.inputs.length },
      rawExecution: raw ? { ...summarize(raw.series), passes: raw.iterations } : 'no rawCall for a Function literal',
    };
    if (coldProcess > 0) record.coldProcess = summarize(timeColdProcess(p, coldProcess));
    console.log(JSON.stringify({ timing: record }));
  }
  const ids = Object.keys(corpus);
  if (ids.length === 0) return;
  // Corpus totals: the sum over the programs of each configuration, per
  // round (paired), and the distribution of the per-program median ratios.
  const total = (pick: (c: (typeof corpus)[string]) => Series, configs: Config[] | (Config | 'floor')[]) => {
    const series: Series = {};
    for (const c of configs) {
      const rounds = pick(corpus[ids[0]])[c]?.length ?? 0;
      series[c] = Array.from({ length: rounds }, (_, r) =>
        ids.reduce((s, id) => s + pick(corpus[id])[c]![r], 0)
      );
    }
    return summarize(series);
  };
  const perProgram = (pick: (c: (typeof corpus)[string]) => Series, x: Config, base: Config, subset = ids) => {
    const ratios = subset.map((id) => {
      const s = pick(corpus[id]);
      return median(s[x]!.map((v, i) => v / s[base]![i]));
    });
    const sorted = [...ratios].sort((a, b) => a - b);
    const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    return { programs: ratios.length, p10: q(0.1), p25: q(0.25), median: median(ratios), p75: q(0.75), p90: q(0.9), min: sorted[0], max: sorted[sorted.length - 1] };
  };
  const withC = ids.filter((id) => corpus[id].warm.C);
  const phaseTotals: Record<string, number> = {};
  for (const ph of PHASES) phaseTotals[ph] = ids.reduce((s, id) => s + corpus[id].phases[ph].median, 0);
  console.log(
    JSON.stringify({
      corpus: {
        programs: ids.length,
        programsWithC: withC.length,
        coldEngineTotal: total((c) => c.cold, ['A', 'A2', 'B', 'D']),
        warmCompileTotal: total((c) => c.warm, ['A', 'A2', 'B', 'D', 'Dp']),
        executionTotal: total((c) => c.exec, ['A', 'A2', 'B', 'D', 'floor']),
        rawExecutionTotal: total((c) => c.raw, ['A', 'A2', 'B', 'D', 'floor']),
        rawExecutionPerProgram: {
          'A2/A': perProgram((c) => c.raw, 'A2', 'A'),
          'D/B': perProgram((c) => c.raw, 'D', 'B'),
          'D/A': perProgram((c) => c.raw, 'D', 'A'),
        },
        warmCompilePerProgram: {
          'A2/A': perProgram((c) => c.warm, 'A2', 'A'),
          'D/B': perProgram((c) => c.warm, 'D', 'B'),
          'D/A': perProgram((c) => c.warm, 'D', 'A'),
          'C/B': withC.length ? perProgram((c) => c.warm, 'C', 'B', withC) : undefined,
        },
        executionPerProgram: {
          'A2/A': perProgram((c) => c.exec, 'A2', 'A'),
          'D/B': perProgram((c) => c.exec, 'D', 'B'),
          'D/A': perProgram((c) => c.exec, 'D', 'A'),
          'C/B': withC.length ? perProgram((c) => c.exec, 'C', 'B', withC) : undefined,
        },
        coldEnginePerProgram: {
          'A2/A': perProgram((c) => c.cold, 'A2', 'A'),
          'D/B': perProgram((c) => c.cold, 'D', 'B'),
          'D/A': perProgram((c) => c.cold, 'D', 'A'),
        },
        phasesDSumOfMedians: phaseTotals,
        cSubsetWarmTotal: withC.length
          ? (() => {
              const s: Series = {};
              for (const c of ['B', 'C', 'D'] as Config[]) {
                const rounds = corpus[withC[0]].warm[c]!.length;
                s[c] = Array.from({ length: rounds }, (_, r) =>
                  withC.reduce((t, id) => t + corpus[id].warm[c]![r], 0)
                );
              }
              return summarize(s);
            })()
          : undefined,
      },
    })
  );
  console.log(JSON.stringify({ sink: Number.isFinite(sink) ? 'finite' : String(sink), loadavgEnd: loadavg() }));
}

//
// Corpus extraction
//

function modeExtract(): void {
  const dir = process.env.CORPUS_DIR ?? resolve(ROOT, '../tycho/_TASK/desmos/desmos-corpus/codegen-audit');
  const files = (process.env.CORPUS_FILES ?? 'ce-0.184.0.json,ce-0.185.0-all.json').split(',');
  const seen = new Set<string>();
  const programs: CorpusFile['programs'] = [];
  const programKeys = new Set<string>();
  const counts = { records: 0, javascriptSucceeded: 0, distinctInputs: 0, parseErrors: 0, admitted: 0, literal: 0, closed: 0, symbolOnly: 0, programs: 0, declined: 0 };
  const reasons = new Map<string, number>();
  const sources: Record<string, unknown>[] = [];
  for (const file of files) {
    const text = readFileSync(resolve(dir, file), 'utf8');
    const artifact = JSON.parse(text);
    sources.push({
      file,
      sha256: createHash('sha256').update(text).digest('hex'),
      generatedAt: artifact.generatedAt,
      computeEngine: artifact.computeEngine,
      tychoCommit: artifact.tychoCommit,
      records: artifact.records.length,
    });
    for (const r of artifact.records) {
      counts.records++;
      if (r.target !== 'javascript' || !r.success) continue;
      counts.javascriptSucceeded++;
      const declare: Record<string, string> = Object.fromEntries(
        Object.entries((r.freeSymbolTypes ?? {}) as Record<string, { type: string }>).map(([n, t]) => [n, t.type])
      );
      const key = JSON.stringify([r.input, declare]);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.distinctInputs++;
      const ce = new ComputeEngine();
      let expr: Expression;
      try {
        for (const [n, t] of Object.entries(declare)) ce.declare(n, t);
        expr = ce.parse(r.input);
      } catch {
        counts.parseErrors++;
        continue;
      }
      try {
        new ScalarFragmentJavaScriptTarget('structured').compile(expr, PILOT_OPTIONS);
      } catch (e) {
        counts.declined++;
        const m = (e as Error).message
          .replace(/(unsupported (head|binding)) .*/, '$1 <name>')
          .replace(/^(JS scalar fragment: )(\w+)( reads no symbol).*/, '$1<operator>$3');
        reasons.set(m, (reasons.get(m) ?? 0) + 1);
        continue;
      }
      counts.admitted++;
      const ops = countOperations(expr);
      const free = expr.freeVariables ?? [];
      if (ops === 0 && free.length === 0) counts.literal++;
      else if (ops === 0) counts.symbolOnly++;
      else if (free.length === 0) counts.closed++;
      else {
        const used = Object.fromEntries(free.map((n) => [n, declare[n]]));
        const programKey = JSON.stringify([expr.json, used]);
        if (programKeys.has(programKey)) continue;
        programKeys.add(programKey);
        counts.programs++;
        programs.push({
          id: `corpus-${programs.length}`,
          doc: r.doc,
          row: r.row,
          input: r.input,
          json: expr.json as MathJsonExpression,
          declare: used,
        });
      }
    }
  }
  const out: CorpusFile = {
    provenance: {
      description:
        'The scalar programs of the Tycho codegen audit records that the structured route admits: each `input` (the LaTeX serialization of the compiled expression) parsed on a fresh engine with the recorded free-symbol types, compiled by ScalarFragmentJavaScriptTarget("structured") with cse: false and constantFold: false. Programs with at least one operation and one free symbol, deduplicated by canonical MathJSON and the types of the symbols read.',
      extractedAt: new Date().toISOString(),
      sources,
      counts,
      declineReasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])),
    },
    programs,
  };
  writeFileSync(CORPUS_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out.provenance, null, 1));
}

//
// Line counts
//

/** A line that is not blank and does not begin with `//`, `/*` or `*`. */
const isCodeLine = (line: string) => {
  const t = line.trim();
  return t !== '' && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
};

const codeLines = (text: string) => text.split('\n').filter(isCodeLine).length;

const COMPILATION = resolve(ROOT, 'src/compute-engine/compilation');

/** The code lines of `file` at `rev` whose last change is one of
 *  `commits` (git blame). */
function blamedLines(file: string, rev: string, commits: string[]): number {
  // REV=worktree: the file on disk; a line that no commit holds has the
  // hash 0000000000000000000000000000000000000000.
  const revision = rev === 'worktree' ? [] : [rev];
  const out = execFileSync('git', ['blame', '--line-porcelain', ...revision, '--', file], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  let sha = '';
  let n = 0;
  for (const line of out.split('\n')) {
    if (/^[0-9a-f]{40} /.test(line)) sha = line.slice(0, 40);
    else if (line.startsWith('\t') && commits.some((c) => sha.startsWith(c)) && isCodeLine(line.slice(1))) n++;
  }
  return n;
}

/** The code lines of the AST node, without its leading comments. */
function spanLines(source: ts.SourceFile, node: ts.Node): { from: number; to: number; code: number } {
  const start = node.getStart(source);
  const end = node.getEnd();
  const from = source.getLineAndCharacterOfPosition(start).line + 1;
  const to = source.getLineAndCharacterOfPosition(end).line + 1;
  return { from, to, code: codeLines(source.text.slice(start, end)) };
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(resolve(COMPILATION, file), 'utf8'), ts.ScriptTarget.Latest, true);
}

function findFunction(source: ts.SourceFile, name: string): ts.Node {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(source);
  if (!found) throw new Error(`no function ${name}`);
  return found;
}

/** The property `name` of the object literal of the variable `table`. */
function findEntry(source: ts.SourceFile, table: string, name: string): ts.Node {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === table && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties)
        if (p.name && ts.isIdentifier(p.name) && p.name.text === name) found = p;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(source);
  if (!found) throw new Error(`no entry ${table}.${name}`);
  return found;
}

function modeLines(): void {
  const rev = process.env.REV ?? 'HEAD';
  const pilotFiles = [
    'structured-ir.ts',
    'structured-verify.ts',
    'javascript-structured-policy.ts',
    'javascript-structured-lower.ts',
    'javascript-structured-emit.ts',
  ];
  const pilot: Record<string, number> = {};
  // REV=worktree reads the files on disk; another REV reads them at that
  // commit.
  const source = (f: string) =>
    rev === 'worktree'
      ? readFileSync(resolve(COMPILATION, f), 'utf8')
      : execFileSync('git', ['show', `${rev}:src/compute-engine/compilation/${f}`], { cwd: ROOT, encoding: 'utf8' });
  for (const f of pilotFiles) pilot[f] = codeLines(source(f));
  // The commits of the pilot (steps 2 and 3), of the first change of step 5
  // (local writes), and, with REV=worktree, the uncommitted lines.
  const commits = ['4c4f1c163', '7939b5fac', '5e496c6ad', ...(rev === 'worktree' ? ['0000000'] : [])];
  for (const f of ['javascript-fragment-target.ts', 'javascript-target.ts'])
    pilot[`${f} (lines of ${commits.join(', ')})`] = blamedLines(`src/compute-engine/compilation/${f}`, rev, commits);
  const pilotTotal = Object.values(pilot).reduce((a, b) => a + b, 0);

  const jsTarget = parse('javascript-target.ts');
  const existing: Record<string, { from: number; to: number; code: number }> = {};
  for (const op of ['Add', 'Negate', 'Multiply', 'Less', 'And', 'Or'])
    existing[`JAVASCRIPT_OPERATORS.${op}`] = spanLines(jsTarget, findEntry(jsTarget, 'JAVASCRIPT_OPERATORS', op));
  for (const op of ['Add', 'Negate', 'Multiply', 'Min', 'Max', 'Equal', 'Less', 'And', 'Or'])
    existing[`JAVASCRIPT_FUNCTIONS.${op}`] = spanLines(jsTarget, findEntry(jsTarget, 'JAVASCRIPT_FUNCTIONS', op));
  existing['compileJSEquality (javascript-target.ts)'] = spanLines(jsTarget, findFunction(jsTarget, 'compileJSEquality'));
  existing['compileExtremum (javascript-target.ts)'] = spanLines(jsTarget, findFunction(jsTarget, 'compileExtremum'));
  const operators = parse('compile-operators.ts');
  existing['compileExprOperator (compile-operators.ts)'] = spanLines(operators, findFunction(operators, 'compileExprOperator'));
  const conditionals = parse('compile-conditionals.ts');
  existing['compileExprIf (compile-conditionals.ts)'] = spanLines(conditionals, findFunction(conditionals, 'compileExprIf'));
  const conditions = parse('compile-conditions.ts');
  existing['guardCondition (compile-conditions.ts)'] = spanLines(conditions, findFunction(conditions, 'guardCondition'));
  const calls = parse('compile-user-calls.ts');
  existing['emitUserFunctionCall (compile-user-calls.ts)'] = spanLines(calls, findFunction(calls, 'emitUserFunctionCall'));
  // `Sqrt` (step 5): the handler and the functions that only it calls.
  existing['JAVASCRIPT_FUNCTIONS.Sqrt'] = spanLines(jsTarget, findEntry(jsTarget, 'JAVASCRIPT_FUNCTIONS', 'Sqrt'));
  for (const fn of ['complexSqrtLiteral', 'promotesToComplexLane'])
    existing[`${fn} (javascript-target.ts)`] = spanLines(jsTarget, findFunction(jsTarget, fn));
  const existingTotal = Object.values(existing).reduce((a, b) => a + b.code, 0);
  console.log(JSON.stringify({ mode: 'lines', rev, pilot, pilotTotal, existing, existingTotal }, null, 1));
}

//
// Dependencies of the structured route
//

/** The functions of `src/compute-engine/compilation/` that run during the
 *  compilation of the named fixtures on configuration `config`, by V8
 *  precise coverage. */
async function coveredFunctions(config: Config, prepared: Prepared[]): Promise<Map<string, Set<string>>> {
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object) =>
    new Promise<unknown>((res, rej) => session.post(method, params ?? {}, (e, r) => (e ? rej(e) : res(r))));
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
  // Reset the counts, then compile.
  await post('Profiler.takePreciseCoverage');
  for (const p of prepared) compileWith(config, p.expr);
  const { result } = (await post('Profiler.takePreciseCoverage')) as {
    result: { url: string; functions: { functionName: string; ranges: { count: number }[] }[] }[];
  };
  await post('Profiler.stopPreciseCoverage');
  session.disconnect();
  const out = new Map<string, Set<string>>();
  for (const script of result) {
    const i = script.url.indexOf('/src/compute-engine/compilation/');
    if (i < 0) continue;
    const file = script.url.slice(i + '/src/compute-engine/compilation/'.length).replace(/\?.*$/, '');
    for (const fn of script.functions)
      if (fn.ranges[0].count > 0 && fn.functionName !== '') {
        if (!out.has(file)) out.set(file, new Set());
        out.get(file)!.add(fn.functionName);
      }
  }
  return out;
}

async function modeDeps(): Promise<void> {
  const prepared = [...namedFixtures(), ...deepFixtures()].map(prepare);
  // Warm both configurations first, so that lazily compiled modules load.
  const d = await coveredFunctions('D', prepared);
  const b = await coveredFunctions('B', prepared);
  const PILOT = new Set([
    'structured-ir.ts',
    'structured-verify.ts',
    'javascript-structured-policy.ts',
    'javascript-structured-lower.ts',
    'javascript-structured-emit.ts',
  ]);
  const files: Record<string, { d: number; b: number; dOnly: string[]; dFunctions: string[] }> = {};
  for (const file of new Set([...d.keys(), ...b.keys()])) {
    const ds = d.get(file) ?? new Set();
    const bs = b.get(file) ?? new Set();
    files[file] = {
      d: ds.size,
      b: bs.size,
      dOnly: [...ds].filter((f) => !bs.has(f)).sort(),
      dFunctions: PILOT.has(file) ? [] : [...ds].sort(),
    };
  }
  const outsidePilot = Object.entries(files).filter(([f]) => !PILOT.has(f));
  console.log(
    JSON.stringify(
      {
        mode: 'deps',
        functionsReachedByD: Object.values(files).reduce((s, f) => s + f.d, 0),
        functionsReachedByDOutsidePilotFiles: outsidePilot.reduce((s, [, f]) => s + f.d, 0),
        functionsReachedByB: Object.values(files).reduce((s, f) => s + f.b, 0),
        files,
      },
      null,
      1
    )
  );
}

switch (MODE) {
  case 'check':
    modeCheck();
    break;
  case 'time':
    modeTime();
    break;
  case 'lines':
    modeLines();
    break;
  case 'deps':
    await modeDeps();
    break;
  case 'extract':
    modeExtract();
    break;
  case 'cold-child':
    coldChild();
    break;
  default:
    throw new Error(`Unknown MODE ${MODE}`);
}
