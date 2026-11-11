import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  createKernelPool,
  type KernelPool,
} from '../../src/compute-engine';
import {
  compile,
  canCompile,
  JavaScriptTarget,
  GLSLTarget,
  PythonTarget,
} from '../../src/compile';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { callPool, type StoredResult } from '../../src/compute-engine/kernel-pool';
import type {
  CompilationResult,
  CompileDiagnostic,
} from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The `numeric-kernel` profile of the JavaScript target
// (docs/plans/2026-11-10-js-numeric-kernel-profile-spec.md): the option
// `profile: 'numeric-kernel'` of `compile()` and `canCompile()`, its
// declines with the code `outside-profile`, and the fields `profile`,
// `pure` and `shippable` of the result. Every test goes through the public
// `compile()` and `canCompile()`, except the test of an internal error,
// which needs an operation that exists only for tests.

const PROFILE = { profile: 'numeric-kernel' } as const;

/** The prelude of Tycho's heat showcase, copied from
 *  `~/dev/tycho/src/graph-paper/onboarding/showcase-heat.js`
 *  (`HEAT_ENTRY.prelude`), as in compile-javascript-structured-heat.test.ts. */
const HEAT_PRELUDE = `
const N = 32
function heatwall(c: integer, r: integer, obstacle: real) -> boolean {
  obstacle > 0.5 && c == 16 && (r < 13 || r > 18)
}
function heatseed() -> list<real> {
  [exp(-((((k - 1) % N) - 9)^2 + (floor((k - 1)/N) - 15.5)^2)/32) for k in 1..N^2]
}
const H_0 = heatseed()
function heatneighbor(H: list<real>, c: integer, r: integer, center: real, boundary: real, obstacle: real) -> real {
  if c < 0 || c >= N || r < 0 || r >= N {
    if boundary > 0.5 { 0 } else { center }
  } else if heatwall(c, r, obstacle) { center } else { H[1 + c + N*r] }
}
function heatstep(H: list<real>, diffusivity: real, boundary: real, obstacle: real) -> list<real> {
  let a = min(0.25, max(0, diffusivity))
  let L = [0 for j in 1..N^2]
  for k in 1..N^2 {
    let c = ((k - 1) % N)
    let r = floor((k - 1)/N)
    let v = H[k]
    if heatwall(c, r, obstacle) {
      L = replaceAt(L, k, v)
    } else {
      let neighbors = heatneighbor(H, c-1, r, v, boundary, obstacle) + heatneighbor(H, c+1, r, v, boundary, obstacle) + heatneighbor(H, c, r-1, v, boundary, obstacle) + heatneighbor(H, c, r+1, v, boundary, obstacle)
      L = replaceAt(L, k, v + a*(neighbors - 4*v))
    }
  }
  L
}
function heatpaint(H: list<real>, p: real, q: real, obstacle: real) -> list<real> {
  [if !heatwall(((k-1) % N), floor((k-1)/N), obstacle) && (((k-1) % N)+0.5-p)^2 + (floor((k-1)/N)+0.5-q)^2 <= 9 { 1 } else { H[k] } for k in 1..N^2]
}
`;

/** The prelude of Tycho's traffic showcase, copied from
 *  `~/dev/tycho/src/graph-paper/onboarding/showcase-traffic.js`
 *  (`TRAFFIC_ENTRY.prelude`), as in
 *  compile-javascript-structured-functions.test.ts. */
const TRAFFIC_PRELUDE = `
const L = 240
const N = 24
const W = 80
function roadseed(p: real) -> list<real> {
  [if k <= N { (k - 1)*L/N + if k == 1 { p } else { 0 } } else { 5 } for k in 1..2*N]
}
const S_0 = roadseed(1)
function roadstart(S: list<real>) -> list<real> {
  [S[1 + Mod(k - 1, N)] for k in 1..N*W]
}
function roadstep(S: list<real>, a: real, v: real) -> list<real> {
  let R = [0.0 for k in 1..2*N]
  let j = 0
  let gap = 0.0
  let target = 0.0
  let speed = 0.0
  for k in 1..N {
    j = 1 + Mod(k, N)
    gap = max(0, Mod(S[j] - S[k], L) - 4)
    target = v*(tanh((gap - 8)/3) + tanh(8/3))/(1 + tanh(8/3))
    speed = min(gap/0.1, max(0, S[N+k] + 0.1*a*(target - S[N+k])))
    R = replaceAt(R, k, Mod(S[k] + 0.1*speed, L))
    R = replaceAt(R, N+k, speed)
  }
  R
}
function roadtrail(H: list<real>, S: list<real>) -> list<real> {
  [if k <= N*(W-1) { H[k+N] } else { S[k-N*(W-1)] } for k in 1..N*W]
}
`;

/** Prelude functions: a draw from the random stream and a list literal,
 *  which the profile declines, a `Break` in a branch, the function `tone`
 *  of Tycho's Buddhabrot showcase (`template-data.js`), and a `let` with a
 *  type and `!=`, which it admits. */
const OTHER_PRELUDE = `
function jitter(x: real) -> real { x + random() }
function firstover(L: list<real>, t: real) -> real {
  let found = 0.0
  for k in 1..length(L) {
    if L[k] > t { found = L[k]; break }
  }
  found
}
function pair(x: real) -> list<real> { [x, 2*x] }
function tone(v: real, lo: real) -> real { min(1, max(lo, max(0, v)^1.5)) }
function nonzero(L: list<integer>) -> integer {
  let n: integer = 0
  for k in 1..length(L) {
    if L[k] != 0 { n = n + 1 }
  }
  n
}
`;

/** Tycho's `ray`, `flips`, `hasmove` and `choosecell` of the Othello
 *  showcase, copied from `~/dev/tycho/src/graph-paper/onboarding/showcase-othello.js`
 *  (`OTHELLO_ENTRY.prelude`), as in compile-javascript-structured-break.test.ts:
 *  helpers whose bodies are blocks of statements, with loops and `Break`. */
const OTHELLO_PRELUDE = `
function ray(B: list<integer>, k: integer, p: integer, dx: integer, dy: integer) -> integer {
  let col = k - 1 - 8 * floor((k - 1) / 8) + dx
  let row = floor((k - 1) / 8) + dy
  let n = 0
  let found = 0
  for j in 1..7 {
    if col < 0 || col > 7 || row < 0 || row > 7 { break }
    let v = B[1 + col + 8 * row]
    if v == -p {
      n = n + 1
    } else {
      if v == p { found = n }
      break
    }
    col = col + dx
    row = row + dy
  }
  found
}
function flips(B: list<integer>, k: integer, p: integer) -> integer {
  let n = 0
  if k >= 1 && k <= 64 && p != 0 {
    if B[k] == 0 {
      for dx in -1..1 {
        for dy in -1..1 {
          if dx != 0 || dy != 0 { n = n + ray(B, k, p, dx, dy) }
        }
      }
    }
  }
  n
}
function hasmove(B: list<integer>, p: integer) -> boolean {
  let found = false
  for k in 1..64 {
    let count: integer = flips(B, k, p)
    if count > 0 { found = true; break }
  }
  found
}
function choosecell(B: list<integer>, rank: integer) -> integer {
  let n = 0
  let cell = 0
  for k in 1..64 {
    let count: integer = flips(B, k, B[65])
    if count > 0 {
      n = n + 1
      if n == rank { cell = k; break }
    }
  }
  cell
}
`;

/** Tycho's `M` of the Multibrot showcase and `J` of the Julia-set
 *  showcase, copied from `~/dev/tycho/src/graph-paper/onboarding/template-data.js`
 *  (as in compile-javascript-structured-break.test.ts): `s^(d/2)`, a `Power`
 *  with an exponent that is not a literal, and `ln(…)^1.6`, a float literal
 *  exponent with an odd recovered denominator. */
const FRACTAL_PRELUDE = `
function M(p: real, q: real, d: real) -> real {
  let a = p
  let b = q
  let n = 1
  let s = 0.0
  let t = 0.0
  let w = 0.0
  let r = 0.0
  for k in 1..128 {
    s = a^2 + b^2
    if s > 4096 { break }
    n = n + 1
    w = if s > 0 { d * arctan2(b, a) } else { 0.0 }
    r = s^(d/2)
    t = r * cos(w) + p
    b = r * sin(w) + q
    a = t
  }
  s = a^2 + b^2
  if s <= 4096 { 1 } else { min(1, (n + 1 - ln(ln(s) / ln(4096)) / ln(d)) / 128) }
}
function J(p: real, q: real, u: real, v: real) -> real {
  const cr = 0.7885 * u
  const ci = 0.7885 * v
  let a = p
  let b = q
  let n = 0
  let s = 0.0
  let t = 0.0
  let d = 1.0
  for k in 1..256 {
    s = a^2 + b^2
    if s > 65536 { break }
    n = n + 1
    t = a^2 - b^2 + cr
    b = 2*a*b + ci
    a = t
    d = min(d, abs(a), abs(b))
  }
  s = a^2 + b^2
  if s <= 65536 {
    -2 + min(1, ln(max(d, 0.0001) / 0.0001) / ln(300))
  } else {
    0.18 * ln(max(n + 1 - ln(ln(s) / ln(65536)) / ln(2), 3.7) / 3.7)^1.6
  }
}
`;

/** An engine with machine numbers that has executed `source`. */
function engineWith(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const { diagnostics } = executeEpsil(ce, source);
  expect(diagnostics).toEqual([]);
  return ce;
}

/** The `Function` literal that `executeEpsil()` made for `name`. */
function literal(ce: ComputeEngine, name: string): Expression {
  const definition = ce.lookupDefinition(name) as
    | { operator?: { _lambdaLiteral?: Expression } }
    | undefined;
  const fn = definition?.operator?._lambdaLiteral;
  if (fn === undefined) throw new Error(`no function literal for ${name}`);
  return fn;
}

/** An engine with the inputs and the captured bindings of the programs of
 *  the table. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of [
    ['x', 'real'],
    ['y', 'real'],
    ['z', 'complex'],
    ['k', 'integer'],
    ['p', 'real<0..>'],
    ['C', 'boolean'],
    ['L', 'list<real>'],
    ['M', 'list<integer>'],
    ['T', 'tuple<real, real>'],
    ['s', 'string'],
  ])
    ce.declare(name, type);
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  ce.declare('g', {
    signature: '(real) -> real',
  } as never);
  ce.assign(
    'twice',
    ce.expr(['Function', ['Multiply', 2, 'u'], typed('u', 'real')])
  );
  return ce;
}

function typed(name: string, type: string): MathJsonExpression {
  return ['Typed', name, `'${type}'`] as MathJsonExpression;
}

/** A `Function` literal with the body `body` (a block) and the typed
 *  parameters `parameters`. */
function fn(
  body: MathJsonExpression[],
  ...parameters: [string, string][]
): MathJsonExpression {
  return [
    'Function',
    ['Block', ...body],
    ...parameters.map(([n, t]) => typed(n, t)),
  ] as MathJsonExpression;
}

/** The expressions of the agreement table. Whether each one compiles is
 *  not stated here: the table checks that `canCompile()` and `compile()`
 *  agree, and counts both outcomes. */
const EXPRESSIONS: [string, MathJsonExpression][] = [
  ['x', 'x'],
  ['x + y', ['Add', 'x', 'y']],
  ['2x', ['Multiply', 2, 'x']],
  ['x y x', ['Multiply', 'x', 'y', 'x']],
  ['-x', ['Negate', 'x']],
  ['x - y', ['Subtract', 'x', 'y']],
  ['x / y', ['Divide', 'x', 'y']],
  ['x^2', ['Power', 'x', 2]],
  ['x^3', ['Power', 'x', 3]],
  ['x^y', ['Power', 'x', 'y']],
  ['Sqrt(x)', ['Sqrt', 'x']],
  ['Sqrt(p)', ['Sqrt', 'p']],
  ['Exp(x)', ['Exp', 'x']],
  ['Exp(z)', ['Exp', 'z']],
  ['Ln(x)', ['Ln', 'x']],
  ['Ln(p)', ['Ln', 'p']],
  ['Sin(x)', ['Sin', 'x']],
  ['Cos(x)', ['Cos', 'x']],
  ['Tan(x)', ['Tan', 'x']],
  ['Tanh(x)', ['Tanh', 'x']],
  ['Sinh(x)', ['Sinh', 'x']],
  ['Abs(x)', ['Abs', 'x']],
  ['Abs(z)', ['Abs', 'z']],
  ['Arctan2(y, x)', ['Arctan2', 'y', 'x']],
  ['Arctan(x)', ['Arctan', 'x']],
  ['Max(0, x)^1.5', ['Power', ['Max', 0, 'x'], 1.5]],
  ['Max(x, y)', ['Max', 'x', 'y']],
  ['Min(x, y, 0)', ['Min', 'x', 'y', 0]],
  ['If(x < y, x, y)', ['If', ['Less', 'x', 'y'], 'x', 'y']],
  [
    'If(x < 1 && 0 < y, 1, 0)',
    ['If', ['And', ['Less', 'x', 1], ['Less', 0, 'y']], 1, 0],
  ],
  ['If(C, x, -x)', ['If', 'C', 'x', ['Negate', 'x']]],
  ['x <= y', ['LessEqual', 'x', 'y']],
  ['Not(x < y)', ['Not', ['Less', 'x', 'y']]],
  ['C || x < 0', ['Or', 'C', ['Less', 'x', 0]]],
  ['k == 2', ['Equal', 'k', 2]],
  ['k != 2', ['NotEqual', 'k', 2]],
  ['Mod(k, 3)', ['Mod', 'k', 3]],
  ['Mod(x, 1)', ['Mod', 'x', 1]],
  ['Floor(x)', ['Floor', 'x']],
  ['Ceil(x)', ['Ceil', 'x']],
  ['x + offset', ['Add', 'x', 'offset']],
  ['z + x', ['Add', 'z', 'x']],
  ['z z', ['Multiply', 'z', 'z']],
  ['Sin(z)', ['Sin', 'z']],
  ['twice(x)', ['twice', 'x']],
  ['g(x)', ['g', 'x']],
  ['At(L, k)', ['At', 'L', 'k']],
  ['Length(L)', ['Length', 'L']],
  ['At(L, 1) + Length(M)', ['Add', ['At', 'L', 1], ['Length', 'M']]],
  ['First(L)', ['First', 'L']],
  ['At(T, 1)', ['At', 'T', 1]],
  ['[x, y]', ['List', 'x', 'y']],
  ['(x, y)', ['Tuple', 'x', 'y']],
  ['Random()', ['Random']],
  ['x + Random()', ['Add', 'x', ['Random']]],
  ['RandomChoice(L, 2)', ['RandomChoice', 'L', 2]],
  ['x + Random(Range(1, k))', ['Add', 'x', ['Random', ['Range', 1, 'k']]]],
  ['Integrate(Sin(x), x)', ['Integrate', ['Sin', 'x'], 'x']],
  ['Sum(j, j = 1..5)', ['Sum', 'j', ['Limits', 'j', 1, 5]]],
  ['Gamma(x)', ['Gamma', 'x']],
  ['Factorial(k)', ['Factorial', 'k']],
  ['Erf(x)', ['Erf', 'x']],
  ['x + u (u undeclared: the default type)', ['Add', 'x', 'u']],
  ['String length', ['StringLength', 's']],
  ['Comprehension(j x, j in 1..5)', [
    'Comprehension',
    ['Multiply', 'j', 'x'],
    ['Element', 'j', ['Range', 1, 5]],
  ]],
  [
    'a ↦ a·a',
    fn([['Multiply', 'a', 'a']], ['a', 'real']),
  ],
  [
    '(a, b) ↦ Max(a, b) - Min(a, b)',
    fn(
      [['Subtract', ['Max', 'a', 'b'], ['Min', 'a', 'b']]],
      ['a', 'real'],
      ['b', 'real']
    ),
  ],
  [
    'n ↦ the sum of 1..n',
    fn(
      [
        ['Declare', 's', "'real'", 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'j']],
          ['Element', 'j', ['Range', 1, 'n']],
        ],
        's',
      ],
      ['n', 'integer']
    ),
  ],
  [
    'a ↦ [j·a for j in 1..5]',
    fn(
      [
        [
          'Comprehension',
          ['Multiply', 'j', 'a'],
          ['Element', 'j', ['Range', 1, 5]],
        ],
      ],
      ['a', 'real']
    ),
  ],
  [
    'A ↦ A[1] + Length(A)',
    fn([['Add', ['At', 'A', 1], ['Length', 'A']]], ['A', 'list<real>']),
  ],
  [
    'A ↦ ReplaceAt(A, 1, 0)',
    fn([['ReplaceAt', 'A', 1, 0]], ['A', 'list<real>']),
  ],
  [
    'a ↦ a + Random()',
    fn([['Add', 'a', ['Random']]], ['a', 'real']),
  ],
  [
    'A ↦ RandomChoice(A, 2)[1]',
    fn([['At', ['RandomChoice', 'A', 2], 1]], ['A', 'list<real>']),
  ],
  [
    'a ↦ (a, a)',
    fn([['Tuple', 'a', 'a']], ['a', 'real']),
  ],
  [
    'a ↦ a + offset',
    fn([['Add', 'a', 'offset']], ['a', 'real']),
  ],
  [
    'a ↦ twice(a)',
    fn([['twice', 'a']], ['a', 'real']),
  ],
  [
    'a ↦ g(a)',
    fn([['g', 'a']], ['a', 'real']),
  ],
  [
    'A ↦ Sum over A',
    fn([['Sum', ['At', 'A', 'j'], ['Limits', 'j', 1, 3]]], ['A', 'list<real>']),
  ],
  [
    'T ↦ T[1]',
    fn([['At', 'T', 1]], ['T', 'tuple<real, real>']),
  ],
  [
    'a ↦ Sinh(a)',
    fn([['Sinh', 'a']], ['a', 'real']),
  ],
  [
    'a ↦ a^3',
    fn([['Power', 'a', 3]], ['a', 'real']),
  ],
  [
    'a ↦ Integrate(a t, t)',
    fn([['Integrate', ['Multiply', 'a', 't'], 't']], ['a', 'real']),
  ],
];

/** The prelude functions of the table, by prelude. */
const PRELUDES: [string, string, string[]][] = [
  [
    'heat',
    HEAT_PRELUDE,
    ['heatwall', 'heatseed', 'heatneighbor', 'heatstep', 'heatpaint'],
  ],
  [
    'traffic',
    TRAFFIC_PRELUDE,
    ['roadseed', 'roadstart', 'roadstep', 'roadtrail'],
  ],
  ['other', OTHER_PRELUDE, ['jitter', 'firstover', 'pair', 'tone', 'nonzero']],
  ['othello', OTHELLO_PRELUDE, ['ray', 'flips', 'hasmove', 'choosecell']],
  ['fractal', FRACTAL_PRELUDE, ['M', 'J']],
];

/** What `compile()` gives with `fallback: false`: the result, or the
 *  diagnostic of the decline that it throws. */
function outcome(
  expr: Expression,
  options: Record<string, unknown> = {}
):
  | { result: CompilationResult<'javascript'> }
  | { diagnostic: CompileDiagnostic; message: string } {
  try {
    return {
      result: compile(expr, {
        ...PROFILE,
        ...options,
        fallback: false,
      } as never) as CompilationResult<'javascript'>,
    };
  } catch (e) {
    return {
      diagnostic: (e as { diagnostic: CompileDiagnostic }).diagnostic,
      message: (e as Error).message,
    };
  }
}

/** Check that `canCompile()` agrees with `compile()` on `expr` and
 *  return whether `expr` compiles. */
function agrees(expr: Expression, modes: readonly string[]): boolean[] {
  return modes.map((mode) => {
    const options = { mode };
    const got = outcome(expr, options);
    const answer = canCompile(expr, { ...PROFILE, ...options } as never);
    if ('result' in got) {
      expect(answer).toEqual({
        ok: true,
        pure: got.result.pure,
        shippable: got.result.shippable,
        ...(got.result.defaultedSymbols === undefined
          ? {}
          : { defaultedSymbols: got.result.defaultedSymbols }),
      });
      expect(got.result.success).toBe(true);
      expect(got.result.profile).toBe('numeric-kernel');
      return true;
    }
    // Every decline carries a diagnostic. A message of the profile names
    // the profile, not the internal compiler, and gives no reason in terms
    // of the existing compiler.
    expect(got.diagnostic).toBeDefined();
    if (got.diagnostic.code === 'outside-profile')
      expect(got.diagnostic.message).not.toMatch(
        /structured|existing|fragment|JS scalar/
      );
    expect(answer).toEqual({ ok: false, diagnostic: got.diagnostic });
    return false;
  });
}

describe('canCompile() and compile() agree', () => {
  test('on the expressions of the table, in both modes', () => {
    const ce = engine();
    let compiled = 0;
    let declined = 0;
    for (const [name, json] of EXPRESSIONS) {
      const expr = ce.expr(json);
      for (const ok of agrees(expr, ['strict', 'complex'])) {
        if (ok) compiled++;
        else declined++;
      }
      void name;
    }
    // Each expression, in two modes.
    expect(compiled + declined).toBe(2 * EXPRESSIONS.length);
    expect(EXPRESSIONS.length).toBeGreaterThanOrEqual(60);
    expect(compiled).toBeGreaterThanOrEqual(60);
    // `Sum(j, j = 1..5)` and `A ↦ Sum over A` compile since `Sum` is in the
    // profile; list literals, tuples, folds and element-wise arithmetic
    // since slice 1 of docs/plans/2026-11-11-structured-collections-and-lambdas.md.
    expect(declined).toBeGreaterThanOrEqual(23);
  });

  test.each(PRELUDES)(
    'on the functions of the %s prelude',
    (_name, source, names) => {
      const ce = engineWith(source);
      for (const name of names) agrees(literal(ce, name), ['strict']);
    }
  );

  test('a decline names its node and keeps the message of the refusal', () => {
    const ce = engine();
    // A name declared with a type that the profile has no kind for.
    ce.declare('u', 'any');
    const cases: [MathJsonExpression, Partial<CompileDiagnostic>][] = [
      [
        ['RandomChoice', 'L', 2],
        { operator: 'RandomChoice', value: 'RandomChoice(L, 2)' },
      ],
      [
        ['Integrate', ['Sin', 'x'], 'x'],
        { operator: 'Integrate' },
      ],
      [['Add', 'x', 'u'], { binding: 'u', value: 'u' }],
      [['Power', 'x', 0.5], { operator: 'Power' }],
      [['List', ['List', 'x'], 'y'], { operator: 'List' }],
      // A parameter of a type outside the profile: its name.
      [fn([['At', 'T', 1]], ['T', 'tuple<x: real, y: real>']), { binding: 'T' }],
      // A statement outside the profile, in a function body: its head.
      [
        fn(
          [
            ['Declare', 's', "'real'", 0],
            [
              'Loop',
              ['If', ['Less', 'j', 3], ['Continue']],
              ['Element', 'j', ['Range', 1, 'n']],
            ],
            's',
          ],
          ['n', 'integer']
        ),
        { operator: 'Continue' },
      ],
    ];
    for (const [json, fields] of cases) {
      const got = outcome(ce.expr(json));
      expect('diagnostic' in got && got.diagnostic).toMatchObject({
        code: 'outside-profile',
        kind: 'capability',
        ...fields,
      });
      if ('diagnostic' in got) {
        expect(got.diagnostic.message).toMatch(
          /^Could not compile with the profile 'numeric-kernel': /
        );
        expect(got.message).toBe(got.diagnostic.message);
      }
    }
  });

  test('a node that is not a function expression has no operator', () => {
    const ce = engine();
    const got = outcome(ce.expr(fn([{ str: 'ab' }], ['a', 'real'])));
    expect('diagnostic' in got && got.diagnostic).toMatchObject({
      code: 'outside-profile',
      value: '"ab"',
    });
    expect('diagnostic' in got && got.diagnostic.operator).toBeUndefined();
  });

  test('the public wording of a refusal of the internal compiler', () => {
    const ce = engine();
    // The internal message is "Mod with the literal divisor 1 is not in the
    // structured route: the existing emitter writes % or the fractional
    // part for it".
    const got = outcome(ce.expr(['Mod', 'x', 1]));
    expect('diagnostic' in got && got.diagnostic.message).toBe(
      "Could not compile with the profile 'numeric-kernel': Mod with the literal divisor 1 is not in the profile"
    );
    // "… has the type true, and the existing compiler writes the literal
    // true in its place: the structured route does not".
    const closed = outcome(ce.expr(['Less', 1, 2]));
    expect('diagnostic' in closed && closed.diagnostic.message).toBe(
      "Could not compile with the profile 'numeric-kernel': 1 < 2 has the type true: the profile does not admit a node whose value its type fixes"
    );
  });

  test('an expression that is not valid declines', () => {
    const ce = engine();
    const expr = ce.expr(['Add', 'x', ['Sin']]);
    expect(expr.isValid).toBe(false);
    agrees(expr, ['strict']);
    expect(canCompile(expr, PROFILE as never).ok).toBe(false);
  });
});

describe('the example of the spec', () => {
  const ce = engineWith(HEAT_PRELUDE);
  const heatstep = literal(ce, 'heatstep');

  test('compile(heatstep) without the profile: the existing compiler, no profile fields', () => {
    const result = compile(heatstep, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.profile).toBeUndefined();
    expect(result.pure).toBeUndefined();
  });

  test('compile(heatstep) with the profile: pure and shippable', () => {
    const result = compile(heatstep, { ...PROFILE, fallback: false });
    expect(result.success).toBe(true);
    expect(result.profile).toBe('numeric-kernel');
    expect(result.pure).toBe(true);
    expect(result.shippable).toBe(true);
    expect(result.calling).toBe('lambda');
  });

  test('canCompile(heatstep) with the profile', () => {
    expect(canCompile(heatstep, PROFILE as never)).toEqual({
      ok: true,
      pure: true,
      shippable: true,
    });
  });

  test('a function that calls Random() compiles, not pure and not shippable', () => {
    const other = engineWith(OTHER_PRELUDE);
    const jitter = literal(other, 'jitter');
    const got = outcome(jitter);
    expect('result' in got && got.result).toMatchObject({
      success: true,
      profile: 'numeric-kernel',
      pure: false,
      shippable: false,
    });
    expect(canCompile(jitter, PROFILE as never)).toEqual({
      ok: true,
      pure: false,
      shippable: false,
    });
  });

  test('a function with a let of the type integer and != compiles, pure and shippable', () => {
    const nonzero = literal(engineWith(OTHER_PRELUDE), 'nonzero');
    const got = outcome(nonzero);
    expect('result' in got && got.result).toMatchObject({
      success: true,
      pure: true,
      shippable: true,
    });
    if ('result' in got)
      expect((got.result.run as unknown as (L: number[]) => number)([0, 3, -1, 0, 2])).toBe(3);
  });
});

describe('the fields of the result', () => {
  test('a pure program of an expression', () => {
    const ce = engine();
    const result = compile(ce.expr(['Add', 'x', ['Multiply', 2, 'y']]), {
      ...PROFILE,
      fallback: false,
    });
    expect(result).toMatchObject({
      success: true,
      profile: 'numeric-kernel',
      pure: true,
      shippable: true,
      calling: 'expression',
    });
    expect(result.run!({ x: 1, y: 2 })).toBe(5);
    // The assembly of the JavaScript target gives the batch entries.
    expect(typeof result.broadcast).toBe('function');
    expect(typeof result.broadcastAsync).toBe('function');
    expect(typeof result.runAsync).toBe('function');
  });

  test('without the option, no profile field', () => {
    const ce = engine();
    const result = compile(ce.expr(['Add', 'x', ['Multiply', 2, 'y']]), {
      fallback: false,
    });
    expect(result.success).toBe(true);
    expect('profile' in result).toBe(false);
    expect('pure' in result).toBe(false);
    expect(canCompile(ce.expr(['Add', 'x', 'y'])).ok).toBe(false);
  });

  test('a decline with fallback has no profile field', () => {
    const ce = engine();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(ce.expr(['RandomChoice', 'L', 2]), PROFILE);
      expect(result.success).toBe(false);
      expect(result.profile).toBeUndefined();
      expect(result.pure).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('the options', () => {
  const ce = engine();
  const expr = ce.expr(['Add', 'x', 'y']);

  // The other options are admitted
  // (`compile-javascript-structured-options.test.ts`).
  test.each([
    ["the option `mode: 'bigint'`", { mode: 'bigint' }],
    [
      'the function form of the option `operators`',
      { operators: () => undefined },
    ],
  ])('%s declines with outside-profile and names the option', (option, options) => {
    const got = outcome(expr, options);
    expect('diagnostic' in got && got.diagnostic).toEqual({
      code: 'outside-profile',
      kind: 'capability',
      message: `Could not compile with the profile 'numeric-kernel': ${option} is not in the profile.`,
    });
    expect(canCompile(expr, { ...PROFILE, ...options } as never)).toEqual({
      ok: false,
      diagnostic: 'diagnostic' in got ? got.diagnostic : undefined,
    });
  });

  test('cse and constantFold are ignored: the same code', () => {
    const programs = [
      ce.expr(['Add', ['Sin', 'x'], ['Sin', 'x'], ['Multiply', 2, 3]]),
      ce.expr(fn([['Add', ['Sin', 'a'], ['Sin', 'a']]], ['a', 'real'])),
    ];
    for (const program of programs) {
      const plain = compile(program, { ...PROFILE, fallback: false });
      for (const options of [
        { cse: true },
        { constantFold: true },
        { cse: true, constantFold: true },
        { cse: false, constantFold: false },
      ]) {
        const other = compile(program, {
          ...PROFILE,
          ...options,
          fallback: false,
        });
        expect(other.code).toBe(plain.code);
        expect(canCompile(program, { ...PROFILE, ...options })).toEqual(
          canCompile(program, PROFILE)
        );
      }
    }
  });

  test.each(['glsl', 'python', 'interval-js'])(
    'with the target %s, the option is an error, whatever fallback says',
    (to) => {
      for (const fallback of [true, false])
        expect(() => compile(expr, { ...PROFILE, to, fallback } as never)).toThrow(
          `Invalid compilation option "profile": the profile "numeric-kernel" is defined for the target "javascript" only, not for "${to}"`
        );
      const answer = canCompile(expr, { ...PROFILE, to } as never);
      expect(answer.ok).toBe(false);
      expect(!answer.ok && answer.diagnostic.message).toMatch(
        /defined for the target "javascript" only/
      );
    }
  );

  test('with a direct target, the option is an error', () => {
    const target = ce._getCompilationTarget('javascript')!.createTarget();
    expect(() => compile(expr, { ...PROFILE, target } as never)).toThrow(
      /not for a direct target/
    );
  });

  test.each([
    ['JavaScriptTarget', () => new JavaScriptTarget()],
    ['GLSLTarget', () => new GLSLTarget()],
    ['PythonTarget', () => new PythonTarget()],
  ])(
    'the compile() method of %s refuses the option, whatever fallback says',
    (_name, make) => {
      for (const fallback of [true, false])
        expect(() =>
          make().compile(expr, { ...PROFILE, fallback } as never)
        ).toThrow(
          'Invalid compilation option "profile": the profile "numeric-kernel" is an option of the function compile() with the target "javascript"'
        );
    }
  );

  test('a vars entry that names a user function is a call of the host', () => {
    // `JavaScriptTarget.compile()` makes it a `functions` entry: the code
    // calls the function of the host, as the existing compiler does.
    const got = outcome(ce.expr(['twice', 'x']), {
      vars: { twice: 'hostTwice' },
    });
    expect('result' in got && got.result.code).toBe(
      '(() => { const _tv1 = hostTwice(_.x); return _tv1; })()'
    );
    expect('result' in got && [got.result.pure, got.result.shippable]).toEqual(
      [false, false]
    );
  });

  test('an empty functions, operators or vars is an absent option', () => {
    const plain = compile(expr, { ...PROFILE, fallback: false });
    for (const options of [
      { functions: {} },
      { operators: {} },
      { vars: {} },
      { imports: [] },
    ]) {
      const other = compile(expr, {
        ...PROFILE,
        ...options,
        fallback: false,
      } as never);
      expect([other.calling, other.code, other.run!({ x: 1, y: 2 })]).toEqual(
        [plain.calling, plain.code, 3]
      );
      expect(canCompile(expr, { ...PROFILE, ...options } as never).ok).toBe(
        true
      );
    }
  });

  test('canCompile() leaves the symbolDeps and varsObjectRefs of the caller empty', () => {
    const symbolDeps = new Set<string>();
    const varsObjectRefs = new Set<string>();
    expect(
      canCompile(ce.expr(['Add', 'x', 'offset']), {
        ...PROFILE,
        symbolDeps,
        varsObjectRefs,
      }).ok
    ).toBe(true);
    expect([symbolDeps.size, varsObjectRefs.size]).toEqual([0, 0]);
    // `compile()` fills them.
    compile(ce.expr(['Add', 'x', 'offset']), {
      ...PROFILE,
      symbolDeps,
      varsObjectRefs,
      fallback: false,
    });
    expect(varsObjectRefs.size).toBeGreaterThan(0);
  });

  test('a profile other than numeric-kernel is an error', () => {
    expect(() =>
      compile(expr, { profile: 'program', fallback: true } as never)
    ).toThrow('Invalid compilation option "profile": expected "numeric-kernel"');
    expect(canCompile(expr, { profile: 'program' } as never).ok).toBe(false);
  });

  test('fallback: a decline gives the interpreter, or throws', () => {
    const declined = ce.expr(['RandomChoice', 'L', 2]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const fallback of [undefined, true]) {
        const result = compile(declined, { ...PROFILE, fallback } as never);
        expect(result.success).toBe(false);
        expect(result.diagnostic).toMatchObject({
          code: 'outside-profile',
          operator: 'RandomChoice',
        });
        expect(typeof result.run).toBe('function');
      }
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(() =>
      compile(declined, { ...PROFILE, fallback: false })
    ).toThrow(/Could not compile with the profile 'numeric-kernel'/);
  });
});

describe('an internal error', () => {
  // An operation that exists only for tests (the third argument of the
  // target), with no source for it: the emitter throws. The public
  // `compile()` has no such operation, so the target is called directly,
  // with the option of the profile.
  function traceEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('Trace', {
      signature: '(real) -> real',
      effects: ['console'],
      evaluate: (ops: readonly Expression[]) => ops[0],
    } as never);
    return ce;
  }

  test('is a compile-error that names the phase, not outside-profile', () => {
    const ce = traceEngine();
    const target = new ScalarFragmentJavaScriptTarget(
      'structured',
      new Map([['Trace', 'trace']])
    );
    let error: unknown;
    try {
      target.compile(ce.expr(['Add', 'x', ['Trace', 'x']]), {
        ...PROFILE,
        fallback: false,
      });
    } catch (e) {
      error = e;
    }
    const diagnostic = (error as { diagnostic: CompileDiagnostic }).diagnostic;
    expect(diagnostic.code).toBe('compile-error');
    expect(diagnostic.message).toMatch(
      /^Could not compile with the profile 'numeric-kernel': an internal error in the emission phase: /
    );
  });

  test('an error of a defect in the admission is a compile-error, not outside-profile', () => {
    // The admission of a call of a user function checks its captured
    // callable bindings; a `TypeError` there stands for a defect.
    const ce = engine();
    const spy = jest
      .spyOn(BaseCompiler, 'assertCapturedCallableBindings')
      .mockImplementation(() => {
        throw new TypeError('made failure');
      });
    try {
      const got = outcome(ce.expr(['twice', 'x']));
      expect('diagnostic' in got && got.diagnostic).toEqual({
        code: 'compile-error',
        kind: 'capability',
        message:
          "Could not compile with the profile 'numeric-kernel': an internal error in the preparation phase: made failure",
      });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('with fallback: the interpreter, with the same diagnostic', () => {
    const ce = traceEngine();
    const target = new ScalarFragmentJavaScriptTarget(
      'structured',
      new Map([['Trace', 'trace']])
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = target.compile(ce.expr(['Add', 'x', ['Trace', 'x']]), {
        ...PROFILE,
        fallback: true,
      });
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('compile-error');
      expect(result.run!({ x: 2 })).toBe(4);
    } finally {
      warn.mockRestore();
    }
  });

  test('an operation with an effect: not pure, not shippable', () => {
    const ce = traceEngine();
    const target = new ScalarFragmentJavaScriptTarget(
      'structured',
      new Map([['Trace', 'trace']]),
      { trace: (_id, operands) => `(${operands[0]})` }
    );
    const result = target.compile(ce.expr(['Add', 'x', ['Trace', 'x']]), {
      ...PROFILE,
      fallback: false,
    });
    expect(result).toMatchObject({
      success: true,
      profile: 'numeric-kernel',
      pure: false,
      shippable: false,
    });
    // The text of the code has no draw from the random stream: the checks
    // of the assembly alone would ship it.
    expect(result.willUsePool!(1e9)).toBe(false);
  });

  // The existing emitter writes the code of a Haversine with no parentheses
  // in a product, except for a read of an input (`_.x`): these declined at
  // the emission (`compile-error`), and decline at the admission now.
  test.each([
    [
      'a read of the host',
      ['Multiply', 0.5, ['Haversine', 'vr']],
      ['Haversine', 'vr'],
      { vars: { vr: 'globalThis.hostRead()' } },
      'Haversine of "vr" as an operand of Multiply',
    ],
    [
      'the value of an operand block',
      [
        'Multiply',
        'y',
        ['Block', ['Declare', 'b0', "'unknown'", 1], ['Haversine', -0.25]],
      ],
      ['Block', ['Declare', 'b0', "'unknown'", 1], ['Haversine', -0.25]],
      {},
      'Haversine of -0.25 as an operand of Multiply',
    ],
  ] as const)('a Haversine of %s in a product declines with outside-profile', (_, json, whole, options, text) => {
    const ce = engine();
    for (const mode of ['strict', 'complex']) {
      const got = outcome(ce.expr(json as never), { ...options, mode });
      expect('diagnostic' in got && got.diagnostic.code).toBe('outside-profile');
      // The complex mode refuses the source of `vr` first.
      if (mode === 'strict' || Object.keys(options).length === 0)
        expect('diagnostic' in got && got.diagnostic.message).toContain(text);
    }
    // The Haversine as the whole value is not in a parent: it compiles.
    expect('result' in outcome(ce.expr(whole as never), { ...options, mode: 'strict' })).toBe(true);
  });
});

describe('shippable, backed by a run in a worker', () => {
  const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));
  let pool: KernelPool;
  const ce = engineWith(HEAT_PRELUDE);
  ce.declare('x', 'real');
  ce.declare('y', 'real');

  beforeAll(async () => {
    pool = createKernelPool({
      create: () => new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] }),
      size: 2,
    });
    ce.workers = pool;
    await pool.prewarm();
  }, 60_000);

  afterAll(() => {
    pool.dispose();
  });

  test('an expression: broadcastAsync() runs it on the pool', async () => {
    const result = compile(
      ce.expr(['Add', ['Sin', 'x'], ['Multiply', 'x', 'y']]),
      { ...PROFILE, fallback: false }
    );
    expect(result.shippable).toBe(true);
    const n = 40_000;
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = i / 100;
    const inputs = { x: xs, y: 0.5 };
    const { out, done, route } = await result.broadcastAsync!(inputs, {
      chunk: 5000,
    });
    expect(route).toBe('pool');
    expect(done).toBe(n);
    expect(Array.from(out)).toEqual(Array.from(result.broadcast!(inputs)));
  }, 30_000);

  test('heatstep: the stored code runs in a worker and gives the values of run()', async () => {
    const result = compile(literal(ce, 'heatstep'), {
      ...PROFILE,
      fallback: false,
    });
    expect(result.shippable).toBe(true);
    const calls = callPool(pool);
    if (calls === undefined) throw new Error('not a usable pool');
    const field = Array.from({ length: 1024 }, (_, k) =>
      Math.sin(0.37 * (k + 1))
    );
    const inputs = [
      [field, 0.22, 0, 0],
      [field, 0.1, 1, 1],
    ];
    const run = result.run as unknown as (...args: unknown[]) => number[];
    const values = await Promise.all(
      inputs.map((args) =>
        calls.runCall(result as unknown as StoredResult, args, undefined, undefined)
      )
    );
    expect(values.map((v) => [...(v as number[])])).toEqual(
      inputs.map((args) => [...run(...args)])
    );
  }, 60_000);

  test('choosecell, which calls helpers with statement bodies: the stored code runs in a worker', async () => {
    const othello = engineWith(OTHELLO_PRELUDE);
    const result = compile(literal(othello, 'choosecell'), {
      ...PROFILE,
      fallback: false,
    });
    expect([result.pure, result.shippable]).toEqual([true, true]);
    const calls = callPool(pool);
    if (calls === undefined) throw new Error('not a usable pool');
    const start = Array.from({ length: 65 }, (_, i) =>
      i === 27 || i === 36 ? -1 : i === 28 || i === 35 || i === 64 ? 1 : 0
    );
    const inputs = [1, 2, 3, 4, 5].map((rank) => [start, rank]);
    const run = result.run as unknown as (...args: unknown[]) => number;
    const values = await Promise.all(
      inputs.map((args) =>
        calls.runCall(result as unknown as StoredResult, args, undefined, undefined)
      )
    );
    expect(values).toEqual(inputs.map((args) => run(...args)));
    // The four legal moves of the start position, then no fifth one.
    expect(values).toEqual([20, 27, 38, 45, 0]);
  }, 60_000);
});

describe('the default route does not change', () => {
  // The code of `compile(expr, { to: 'javascript' })` for these programs,
  // recorded at the commit before the profile (58ad9e17a).
  const RECORDED: [MathJsonExpression, string][] = DEFAULT_ROUTE_CODES();

  test('the code of 20 programs is the code recorded before the profile', () => {
    const ce = engine();
    expect(RECORDED.length).toBe(20);
    const spy = jest.spyOn(
      ScalarFragmentJavaScriptTarget.prototype,
      'compile'
    );
    try {
      for (const [json, code] of RECORDED) {
        const result = compile(ce.expr(json), { to: 'javascript' });
        expect([json, result.code]).toEqual([json, code]);
        expect(result.profile).toBeUndefined();
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

/** The programs of the test of the default route, with their code. */
function DEFAULT_ROUTE_CODES(): [MathJsonExpression, string][] {
  return [
    [["Add","x","y"], "_.x + _.y"],
    [["Multiply",2,"x"], "2 * _.x"],
    [["Subtract","x","y"], "_.x + -_.y"],
    [["Divide","x","y"], "_.x / _.y"],
    [["Power","x",2], "(_.x * _.x)"],
    [["Power","x",3], "_SYS.pow3(_.x)"],
    [["Sqrt","p"], "Math.sqrt(_.p)"],
    [["Exp","x"], "Math.exp(_.x)"],
    [["Ln","p"], "Math.log(_.p)"],
    [["Sin",["Add","x","y"]], "Math.sin(_.x + _.y)"],
    [["Abs","z"], "_SYS.cabs(_.z)"],
    [["Arctan2","y","x"], "Math.atan2(_.y, _.x)"],
    [["Power",["Max",0,"x"],1.5], "_SYS.pow3h(Math.max(0, _.x))"],
    [["If",["Less","x","y"],"x","y"], "((_.x < _.y) ? (_.x) : (_.y))"],
    [["Mod","k",3], "_SYS.floorMod(_.k, 3)"],
    [["Floor","x"], "Math.floor(_.x)"],
    [["Add","x","offset"], "2 + _.x"],
    [["Multiply","z","z"], "(() => { const _tv1 = _.z; const _tv2 = _.z; return { re: _tv1.re * _tv2.re - _tv1.im * _tv2.im, im: _tv1.re * _tv2.im + _tv1.im * _tv2.re }; })()"],
    [["Add",["At","L",1],["Length","M"]], "_SYS.atNumeric(_.L, 1, \"real\") + (_.M).length"],
    [["Function",["Block",["Multiply","a","a"]],["Typed","a","'real'"]], "(a) => a * a"],
  ];
}
