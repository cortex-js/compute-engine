import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The JavaScript target instantiates a callback lambda ONCE and calls it per
 * element (`((_f) => (coll).map((_x) => _f(_x)))(lambda)`), but the lambda
 * BODY used to be emitted whole: a subexpression that mentions none of the
 * lambda's parameters was recomputed for every element. The expensive shape
 * is a call to a user-defined function of the enclosing parameters —
 * `Map((_) ↦ Which(_ = m(x, y), 1e9, True, _), d(x, y))`, where `m` reduces
 * a list `d` rebuilds, so a nine-element map ran `m` nine times.
 *
 * The hoist binds such a subexpression once, next to the lambda, and assigns
 * it on the FIRST call of the lambda — behind a flag, so an empty collection
 * evaluates it as few times as the interpreter does (never).
 *
 * These tests read the EMITTED SOURCE, because the optimization has no other
 * witness: the values are unchanged by construction.
 */

/** How many times `needle` appears in `code`. */
const occurrences = (code: string, needle: string): number =>
  code.split(needle).length - 1;

/** The line of `preamble` that defines the emitted function `name`. */
function definitionOf(preamble: string, name: string): string {
  const line = preamble
    .split('\n')
    .find((l) => l.includes(`const _fn_${name} =`));
  expect(line).toBeDefined();
  return line!;
}

/**
 * The body of the once-only initializer a hoisted callback carries —
 * `if (!_flag) { _flag = true; <assignments> }` — or `''` when the emission
 * hoisted nothing. Matched by brace balance, so a nested block inside an
 * assignment stays inside the result.
 */
function firstCallInit(code: string): string {
  const header = /if \(!(_[\w$]+)\) \{ \1 = true; /.exec(code);
  if (header === null) return '';
  const start = header.index + header[0].length;
  let depth = 1;
  let i = start;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
  }
  return code.slice(start, i - 1);
}

/** `code` with the once-only initializer removed: what runs per element. */
function perElement(code: string): string {
  const init = firstCallInit(code);
  if (init === '') return code;
  return code.replace(init, '');
}

/** The balanced argument text of the first `.map(` / `.filter(` … call. */
function callbackOf(code: string, call: string): string {
  const at = code.indexOf(call);
  expect(at).toBeGreaterThanOrEqual(0);
  let depth = 1;
  let i = at + call.length;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') depth--;
  }
  return code.slice(at + call.length, i - 1);
}

//
// The Tycho witness (Desmos state 62urmx2dcm): nine lattice points per cell,
// the squared distance to each, the minimum, then the SECOND minimum found by
// masking the first out with a `Map`.
//

const N = 16;
const n = 4;
const h = 1 / n;
const hash = (a: unknown) => [
  'Mod',
  ['Multiply', 10000, ['Sin', ['Multiply', 10000, a]]],
  1,
];
const jitter = (x: unknown, y: unknown, s: number) =>
  hash([
    'Add',
    ['Floor', ['Multiply', n, x]],
    ['Multiply', n, ['Floor', ['Multiply', n, y]]],
    s,
  ]);
const point = (x: unknown, y: unknown) => [
  'Add',
  [
    'Multiply',
    ['Divide', 1, n],
    ['PointList', ['Floor', ['Multiply', n, x]], ['Floor', ['Multiply', n, y]]],
  ],
  [
    'Multiply',
    ['Divide', 1, n],
    ['PointList', jitter(x, y, 0), jitter(x, y, 0.5)],
  ],
];
const OFFSETS: [number, number][] = [
  [-h, -h],
  [0, -h],
  [h, -h],
  [-h, 0],
  [0, 0],
  [h, 0],
  [-h, h],
  [0, h],
  [h, h],
];
const neighbours = (x: unknown, y: unknown) => [
  'List',
  ...OFFSETS.map(([dx, dy]) => point(['Add', x, dx], ['Add', y, dy])),
];

/** The by-REFERENCE chain: five named functions, each calling the last. */
function byReferenceEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  const def = (name: string, body: unknown) =>
    ce.box(['DefineFunction', name, ['Function', body, 'x', 'y']]).evaluate();
  def('V', neighbours('x', 'y'));
  def('d', [
    'Add',
    ['Square', ['Subtract', 'x', ['PointX', ['V', 'x', 'y']]]],
    ['Square', ['Subtract', 'y', ['PointY', ['V', 'x', 'y']]]],
  ]);
  def('m', ['Min', ['d', 'x', 'y']]);
  def('d2', [
    'Map',
    ['Function', ['Which', ['Equal', '_', ['m', 'x', 'y']], 1e9, 'True', '_'], '_'],
    ['d', 'x', 'y'],
  ]);
  def('m2', ['Min', ['d2', 'x', 'y']]);
  return ce;
}

/** `(1/16)^2 - |m2(x, y) - m(x, y)|`, over the named functions. */
const byReferenceRow = (x: unknown, y: unknown) => [
  'Subtract',
  ['Power', ['Divide', 1, N], 2],
  ['Abs', ['Subtract', ['m2', x, y], ['m', x, y]]],
];

/** The same row with every definition INLINED — no named function at all. */
function inlinedRow(): unknown {
  const dIn = (x: unknown, y: unknown) => [
    'Add',
    ['Square', ['Subtract', x, ['PointX', neighbours(x, y)]]],
    ['Square', ['Subtract', y, ['PointY', neighbours(x, y)]]],
  ];
  const mIn = (x: unknown, y: unknown) => ['Min', dIn(x, y)];
  const d2In = (x: unknown, y: unknown) => [
    'Map',
    [
      'Function',
      ['Which', ['Equal', '_', mIn(x, y)], 1e9, 'True', '_'],
      '_',
    ],
    dIn(x, y),
  ];
  return [
    'Subtract',
    ['Power', ['Divide', 1, N], 2],
    ['Abs', ['Subtract', ['Min', d2In('x', 'y')], mIn('x', 'y')]],
  ];
}

describe('callback lambda: loop-invariant hoist (JavaScript target)', () => {
  it('a: the by-reference chain emits no per-element callback at all', () => {
    // The nine-element map this hoist was written for is gone from the
    // by-reference chain. A definition body now has its nested
    // collection-valued calls substituted before it is emitted
    // (`inlineCollectionValuedCallsInDefinitionBody` in
    // `compilation/base-compiler.ts`), so `d2`'s `Map` runs over a literal
    // nine-element list and the fixed-width unroll replaces it with
    // straight-line code. `d` and `d2` are not emitted as definitions at all
    // any more, and nothing is left to hoist here: the invariant `m(x, y)` is
    // bound once as an ordinary common subexpression. The hoist itself is
    // pinned by the inline-lambda cases below, whose collections have no
    // fixed width to unroll.
    const ce = byReferenceEngine();
    const result = compile(ce.box(byReferenceRow('x', 'y')), {
      to: 'javascript',
    } as any) as any;
    expect(result.success).not.toBe(false);

    expect(`${result.preamble ?? ''}${result.code ?? ''}`).not.toContain(
      '.map('
    );
    expect(result.preamble).not.toContain('const _fn_d');

    // `m` is SCALAR-valued, so it stays a shared definition, and `m2` calls it
    // exactly once — bound ahead of the nine element expressions instead of
    // repeated inside each of them. The call is BARE: `m2`'s own parameters
    // hold run-time scalars, because no parameter of `m2` binds its argument
    // whole and every emitted call site of `m2` broadcasts or guards (user
    // ruling 2026-09-09). It used to be a `_SYS.bcastFn` dispatch, for the
    // sole reason that an unannotated parameter infers as `unknown`.
    const m2 = definitionOf(result.preamble, 'm2');
    expect(occurrences(m2, '_fn_m(')).toBe(1);
    expect(occurrences(m2, '_SYS.bcastFn(')).toBe(0);
  });

  it('b: an inline `Sin(x)` in a Map body is emitted once, outside the callback', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    const result = compile(
      ce.box([
        'Map',
        ['Function', ['Add', '_', ['Sin', 'x']], '_'],
        ['List', 1, 2, 3],
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    expect(occurrences(code, 'Math.sin')).toBe(1);
    expect(firstCallInit(code)).toContain('Math.sin');
    expect(perElement(code)).not.toContain('Math.sin');
    expect(callbackOf(code, '.map(')).not.toContain('Math.sin');
  });

  it('c: a Filter predicate hoists its invariant part', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    const result = compile(
      ce.box([
        'Filter',
        ['List', 1, 2, 3, 4],
        ['Function', ['Greater', '_', ['Sin', 'x']], '_'],
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    expect(occurrences(code, 'Math.sin')).toBe(1);
    expect(firstCallInit(code)).toContain('Math.sin');
    expect(perElement(code)).not.toContain('Math.sin');
  });

  it('c2: CountIf, Find and IndexWhere hoist the same way', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    for (const op of ['CountIf', 'Find', 'IndexWhere']) {
      const result = compile(
        ce.box([
          op,
          ['List', 1, 2, 3, 4],
          ['Function', ['Greater', '_', ['Sin', 'x']], '_'],
        ]),
        { to: 'javascript' } as any
      ) as any;
      expect(result.success).not.toBe(false);
      const code: string = result.code;
      expect(occurrences(code, 'Math.sin')).toBe(1);
      expect(firstCallInit(code)).toContain('Math.sin');
      expect(perElement(code)).not.toContain('Math.sin');
    }
  });

  it('c3: the index-consuming Tabulate and Fill hoist the same way', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    const tabulate = compile(
      ce.box(['Tabulate', ['Function', ['Multiply', '_', ['Sin', 'x']], '_'], 5]),
      { to: 'javascript' } as any
    ) as any;
    expect(tabulate.success).not.toBe(false);
    expect(occurrences(tabulate.code, 'Math.sin')).toBe(1);
    expect(firstCallInit(tabulate.code)).toContain('Math.sin');
    expect(perElement(tabulate.code)).not.toContain('Math.sin');
    expect(tabulate.run({ x: 0.5 })).toEqual([
      Math.sin(0.5),
      2 * Math.sin(0.5),
      3 * Math.sin(0.5),
      4 * Math.sin(0.5),
      5 * Math.sin(0.5),
    ]);

    // Two parameters: the shim forwards both.
    const fill = compile(
      ce.box([
        'Fill',
        ['Function', ['Add', 'i', 'j', ['Sin', 'x']], 'i', 'j'],
        ['Tuple', 2, 3],
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(fill.success).not.toBe(false);
    expect(occurrences(fill.code, 'Math.sin')).toBe(1);
    expect(firstCallInit(fill.code)).toContain('Math.sin');
    expect(fill.run({ x: 0.5 })).toEqual([
      [2 + Math.sin(0.5), 3 + Math.sin(0.5), 4 + Math.sin(0.5)],
      [3 + Math.sin(0.5), 4 + Math.sin(0.5), 5 + Math.sin(0.5)],
    ]);
  });

  it('d: a body that reads only the parameter is left alone', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const result = compile(
      ce.box(['Map', ['Function', ['Sin', '_'], '_'], 'L']),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    // Nothing is invariant, so no binding and no once-only initializer.
    expect(firstCallInit(code)).toBe('');
    expect(occurrences(code, 'Math.sin')).toBe(1);
  });

  it('d2: an IMPURE invariant stays inside the callback', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    const result = compile(
      ce.box([
        'Map',
        ['Function', ['Add', '_', ['Sin', 'x'], ['Random']], '_'],
        ['List', 1, 2, 3],
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    const draw = 'drawNextRandomNumber';
    // The interpreter draws once per element, so the compiled code must too:
    // the draw is emitted inside the lambda, never in the once-only
    // initializer.
    expect(occurrences(code, draw)).toBe(1);
    expect(firstCallInit(code)).not.toContain(draw);
    expect(perElement(code)).toContain(draw);
    // The PURE invariant beside it is still hoisted.
    expect(firstCallInit(code)).toContain('Math.sin');
  });

  it('d3: a `Random()` body hoists nothing at all', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.box([
        'Map',
        ['Function', ['Add', '_', ['Random']], '_'],
        ['List', 1, 2, 3],
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);
    const code: string = result.code;
    expect(firstCallInit(code)).toBe('');
    expect(occurrences(code, 'drawNextRandomNumber')).toBe(1);
  });

  it('d4: the hoisted value is computed once, and NOT AT ALL over an empty collection', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('L', 'list<number>');
    const result = compile(
      ce.box(['Map', ['Function', ['Add', '_', ['Sin', 'x']], '_'], 'L']),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);

    // A getter counts how often a run reads `x`. The count includes whatever
    // the runner's own entry check reads, which is the same for every call —
    // so the counts are compared with EACH OTHER, never with a constant.
    let reads = 0;
    const count = (L: number[]): number => {
      reads = 0;
      const value = result.run({
        L,
        get x() {
          reads++;
          return 0.5;
        },
      });
      expect(value).toEqual(L.map((v) => v + Math.sin(0.5)));
      return reads;
    };

    const empty = count([]);
    const three = count([1, 2, 3]);
    const six = count([1, 2, 3, 4, 5, 6]);

    // Once per CALL, not once per element: twice the elements reads `x` no
    // more often. The defect this hoist fixes read it once per element.
    expect(three).toBe(six);
    // An empty collection runs the body zero times in the interpreter, so
    // the compiled code must not evaluate the hoisted subexpression either:
    // an error it raised would be one the unhoisted code never raised. The
    // empty run reads `x` exactly one time LESS than a non-empty one.
    expect(empty).toBe(three - 1);
  });

  it('f: a LAZY stream stage hoists NOTHING, where the eager Map still hoists', () => {
    // A stage of a lazy stream pulls one element at a time (`_SYS.mapIter` is
    // `for (const x of it) yield f(x)`), so the callback of an UPSTREAM stage
    // runs between two calls of this stage's callback. An upstream body that
    // assigns a variable of the enclosing scope therefore changes, in the
    // middle of this stage's iteration, a value the stage would treat as
    // invariant — and the candidate analysis cannot see that assignment,
    // since it scans only the body it is given. So the lazy stages compile
    // their callback unhoisted: `Math.sin` stays INSIDE the lambda. The eager
    // lowerings have no such interleaving — their source collection is fully
    // materialized before the callback is called even once — and keep the
    // hoist.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');

    const lazy = compile(
      ce.box([
        'Take',
        [
          'Map',
          ['Function', ['Add', '_', ['Sin', 'x']], '_'],
          ['Range', 1, { num: '+Infinity' }],
        ],
        3,
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(lazy.success).not.toBe(false);
    const lazyCode: string = lazy.code;
    expect(lazyCode).toContain('_SYS.mapIter');
    // No once-only initializer at all, and the invariant call is emitted
    // where it runs per element.
    expect(firstCallInit(lazyCode)).toBe('');
    expect(occurrences(lazyCode, 'Math.sin')).toBe(1);
    expect(perElement(lazyCode)).toContain('Math.sin');
    expect(lazy.run({ x: 0.5 })).toEqual([
      1 + Math.sin(0.5),
      2 + Math.sin(0.5),
      3 + Math.sin(0.5),
    ]);

    // The same body over a literal list — an eager `Map` — still hoists.
    const eager = compile(
      ce.box([
        'Map',
        ['Function', ['Add', '_', ['Sin', 'x']], '_'],
        ['List', 1, 2, 3],
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(eager.success).not.toBe(false);
    expect(firstCallInit(eager.code)).toContain('Math.sin');
    expect(perElement(eager.code)).not.toContain('Math.sin');
  });

  it('g: a callback rebuilt at its GROUND signature emits no hoist at all', () => {
    // The hoist rewrites an occurrence by installing a code override keyed on
    // the body NODE, so it only reaches an emission that compiles those very
    // nodes. A callback whose declared signature is GENERIC is re-boxed at its
    // ground bound before its body is compiled (the `Function` lowering's
    // `literalAtGroundSignature` repair), which compiles different node
    // objects: no override is read, and the bindings would be declared and
    // never used. The emission checks whether the compiled lambda names any of
    // its minted temporaries and, finding none, emits the plain lambda.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('L', 'list<number>');
    const result = compile(
      ce.box([
        'Map',
        [
          'Function',
          [
            'Typed',
            ['Add', '_', ['Sin', 'x']],
            { str: '(_: T) -> T where T: number' },
          ],
          '_',
        ],
        'L',
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    // No wrapper, no once-only initializer, and exactly one emission of the
    // invariant — a declared-but-unread binding would show up as a second
    // `Math.sin` beside an initializer that assigns a name nothing reads.
    expect(firstCallInit(code)).toBe('');
    expect(occurrences(code, 'Math.sin')).toBe(1);
    expect(result.run({ x: 0.5, L: [1, 2, 3] })).toEqual([
      1 + Math.sin(0.5),
      2 + Math.sin(0.5),
      3 + Math.sin(0.5),
    ]);
  });

  it('e: the compiled rows agree with the interpreter at 20 sample points', () => {
    const ce = byReferenceEngine();
    const byRef = compile(ce.box(byReferenceRow('x', 'y')), {
      to: 'javascript',
    } as any) as any;
    expect(byRef.success).not.toBe(false);

    const ceInline = new ComputeEngine();
    const inline = compile(ceInline.box(inlinedRow() as any), {
      to: 'javascript',
    } as any) as any;
    expect(inline.success).not.toBe(false);

    for (let i = 0; i < 20; i++) {
      const x = -0.83 + i * 0.0817;
      const y = 0.61 - i * 0.0713;
      // `.N()` and not `.evaluate()`: a transcendental of an EXACT argument
      // stays symbolic under `evaluate()` (the exactness contract), and at a
      // lattice-aligned sample the whole chain is exact.
      const expected = ce.box(byReferenceRow(x, y) as any).N().re;
      expect(typeof expected).toBe('number');
      expect(byRef.run({ x, y })).toBeCloseTo(expected, 9);
      expect(inline.run({ x, y })).toBeCloseTo(expected, 9);
    }
  });
});

/**
 * The same hoist for a `Reduce`/`Scan` COMBINER. A fold calls its combiner
 * once per element, so a subexpression of the combiner body that mentions
 * neither the accumulator nor the element was recomputed on every step. The
 * combiner is compiled inside a local shape frame that binds its two
 * parameters to the fold's lanes (`BaseCompiler.compileCombinerLiteral`);
 * `customCombinerWithLanes` routes the literal through
 * `hoistedCallbackLambda`, so the frame still wraps the literal's emission
 * while the bindings are compiled and declared outside it.
 */
describe('fold combiner: loop-invariant hoist (JavaScript target)', () => {
  /** `a…f` and `u`, `v` declared real; the source list is `[a, …, f]`. */
  function foldEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'u', 'v'])
      ce.declare(name, 'real');
    return ce;
  }
  const SOURCE = ['List', 'a', 'b', 'c', 'd', 'e', 'f'];
  const VALUES = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, u: 0.5, v: 0.25 };
  /** `(acc, x) ↦ acc + x·sin(u)·cos(v)`: `sin(u)·cos(v)` is the invariant. */
  const COMBINER = [
    'Function',
    ['Add', 'acc', ['Multiply', 'x', ['Sin', 'u'], ['Cos', 'v']]],
    'acc',
    'x',
  ];
  /** The same fold with every symbol replaced by its value in `VALUES`. */
  const grounded = (expr: unknown): unknown =>
    typeof expr === 'string' && expr in VALUES
      ? VALUES[expr as keyof typeof VALUES]
      : Array.isArray(expr)
        ? expr.map(grounded)
        : expr;

  it('h: a Reduce combiner emits its invariant once, outside the fold', () => {
    const ce = foldEngine();
    const expr = ['Reduce', SOURCE, COMBINER, 0];
    const result = compile(ce.box(expr as any), {
      to: 'javascript',
    } as any) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    expect(occurrences(code, 'Math.sin')).toBe(1);
    expect(occurrences(code, 'Math.cos')).toBe(1);
    expect(firstCallInit(code)).toContain('Math.sin');
    expect(firstCallInit(code)).toContain('Math.cos');
    expect(perElement(code)).not.toContain('Math.sin');
    expect(perElement(code)).not.toContain('Math.cos');

    // The `Reduce` lowering still hands the native `reduce` a binary function.
    expect(code).toContain('.reduce(');
    expect(result.run(VALUES)).toBeCloseTo(
      ce.box(grounded(expr) as any).N().re as number,
      12
    );
  });

  it('i: a Scan combiner hoists the same way', () => {
    const ce = foldEngine();
    const expr = ['Scan', SOURCE, COMBINER, 0];
    const result = compile(ce.box(expr as any), {
      to: 'javascript',
    } as any) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    expect(occurrences(code, 'Math.sin')).toBe(1);
    expect(occurrences(code, 'Math.cos')).toBe(1);
    expect(firstCallInit(code)).toContain('Math.sin');
    expect(perElement(code)).not.toContain('Math.sin');

    // `Scan` answers a LAZY collection, whose elements are read with `each()`
    // — its `ops` are still the unevaluated `Scan` operands.
    const expected = [...ce.box(grounded(expr) as any).N().each()].map(
      (v) => v.re
    );
    expect(expected).toHaveLength(6);
    const got: number[] = result.run(VALUES);
    expect(got).toHaveLength(6);
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i] as number, 12));
  });

  it('j: a combiner with nothing invariant emits the plain wrapper', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    for (const op of ['Reduce', 'Scan']) {
      const result = compile(
        ce.box([
          op,
          'L',
          ['Function', ['Add', 'acc', ['Sin', 'x']], 'acc', 'x'],
          0,
        ] as any),
        { to: 'javascript' } as any
      ) as any;
      expect(result.success).not.toBe(false);
      const code: string = result.code;
      // No bindings, so no once-only initializer and no holder: the combiner
      // is the arity wrapper applied straight to the compiled lambda, exactly
      // as it was emitted before the hoist reached this route.
      expect(firstCallInit(code)).toBe('');
      expect(code).toContain('((_f) => (_a, _b) => _f(_a, _b))(');
      expect(occurrences(code, 'Math.sin')).toBe(1);
    }
    const reduce = compile(
      ce.box([
        'Reduce',
        'L',
        ['Function', ['Add', 'acc', ['Sin', 'x']], 'acc', 'x'],
        0,
      ] as any),
      { to: 'javascript' } as any
    ) as any;
    expect(reduce.run({ L: [1, 2, 3] })).toBeCloseTo(
      Math.sin(1) + Math.sin(2) + Math.sin(3),
      12
    );
  });

  it('k: a COMPLEX-lane combiner keeps its `_SYS.cplx` lifts', () => {
    const ce = foldEngine();
    const expr = [
      'Reduce',
      SOURCE,
      [
        'Function',
        ['Add', 'acc', ['Multiply', 'x', 'ImaginaryUnit', ['Sin', 'u']]],
        'acc',
        'x',
      ],
      0,
    ];
    const result = compile(ce.box(expr as any), {
      to: 'javascript',
    } as any) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    // The accumulator is lifted into the complex lane by the arity wrapper,
    // and the real seed is lifted too.
    expect(code).toContain('(_a, _b) => _f(_SYS.cplx(_a), _b)');
    expect(code).toContain('_SYS.cplx(0)');
    // The invariant is still hoisted, and only the invariant.
    expect(occurrences(code, 'Math.sin')).toBe(1);
    expect(firstCallInit(code)).toContain('Math.sin');
    expect(perElement(code)).not.toContain('Math.sin');

    const expected = ce.box(grounded(expr) as any).N();
    const got = result.run(VALUES);
    expect(got.re).toBeCloseTo(expected.re as number, 12);
    expect(got.im).toBeCloseTo(expected.im as number, 12);
  });

  it('l: a bare user-function SYMBOL combiner is unaffected', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.box([
      'DefineFunction',
      'g',
      ['Function', ['Add', 'p', ['Multiply', 2, 'q']], 'p', 'q'],
    ]).evaluate();
    const result = compile(ce.box(['Reduce', 'L', 'g', 0]), {
      to: 'javascript',
    } as any) as any;
    expect(result.success).not.toBe(false);

    const code: string = result.code;
    // A symbol has no body to rewrite here: the combiner is the arity wrapper
    // around the function's value reference, with no once-only initializer.
    expect(firstCallInit(code)).toBe('');
    expect(code).toContain('((_f) => (_a, _b) => _f(_a, _b))(_fn_g');
    expect(result.run({ L: [1, 2, 3] })).toBe(12);
  });

  it('m: the hoisted value is computed once per RUN, never over an empty fold', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.declare('u', 'real');
    const result = compile(
      ce.box([
        'Reduce',
        'L',
        ['Function', ['Add', 'acc', ['Multiply', 'x', ['Sin', 'u']]], 'acc', 'x'],
        0,
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);

    // A getter counts how often a run reads `u`. The counts are compared with
    // EACH OTHER, never with a constant: the runner's own entry check reads
    // the same variables on every call.
    let reads = 0;
    const count = (L: number[]): number => {
      reads = 0;
      const value = result.run({
        L,
        get u() {
          reads++;
          return 0.5;
        },
      });
      expect(value).toBeCloseTo(
        L.reduce((s, v) => s + v * Math.sin(0.5), 0),
        12
      );
      return reads;
    };

    const empty = count([]);
    const three = count([1, 2, 3]);
    const six = count([1, 2, 3, 4, 5, 6]);
    // Once per CALL, not once per element.
    expect(three).toBe(six);
    // An empty fold never calls the combiner, so it must not evaluate the
    // hoisted subexpression either: an error it raised would be one the
    // unhoisted code never raised.
    expect(empty).toBe(three - 1);
  });
});
