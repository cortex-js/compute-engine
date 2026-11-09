import { ComputeEngine } from '../../src/compute-engine';
import { checkSource } from '../../src/cli/check';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { parallelLoopDiagnostics } from '../../src/epsil/parallel-checks';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { analyzeReferences } from '../../src/compute-engine/compilation/compile-references';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import {
  beginParallelLoop,
  foldSeed,
  frameDraw,
  parallelPassFrame,
} from '../../src/compute-engine/numerics/random';

//
// The `parallel for` loop, the parallel comprehension clause and the
// compound assignment `+=` (`docs/plans/2026-11-07-ce1093-parallel-for.md`,
// step 1): the parse, the round trips, the static rules, the meaning in the
// interpreter (accumulators and the random frame of each pass) and the
// JavaScript target.
//

/** A raw parse without the source offsets, and the diagnostic codes. */
function parse(source: string): { json: unknown; codes: string[] } {
  const [ast, diagnostics] = parseEpsil(source);
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (x !== null && typeof x === 'object') {
      if ('fn' in x) return strip((x as { fn: unknown }).fn);
      if ('sym' in x) return (x as { sym: unknown }).sym;
      if ('num' in x) return Number((x as { num: string }).num);
      if ('str' in x) return `'${(x as { str: string }).str}'`;
    }
    return x;
  };
  return {
    json: strip(ast),
    codes: diagnostics.map((d) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    ),
  };
}

function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

/** The codes of the diagnostics of `epsil check`. */
function checkCodes(source: string): string[] {
  return checkSource(source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

/** Compile an Epsil expression to JavaScript, with no fallback. */
function compileEpsil(
  ce: ComputeEngine,
  source: string
): {
  success: boolean;
  code: string;
  warnings?: unknown[];
  run: (vars?: Record<string, unknown>) => unknown;
} {
  const [ast] = parseEpsil(source);
  const resolved = resolveLibraryNames(ast as never, source, ce);
  return compile(ce.box(resolved as never), {
    fallback: false,
  } as never) as never;
}

describe('the parse', () => {
  test.each([
    [
      'parallel for k in 1..3 { L[k] += 1 }',
      [
        'ParallelLoop',
        ['Block', ['AddTo', ['At', 'L', 'k'], 1]],
        ['Element', 'k', ['Range', 1, 3]],
      ],
    ],
    [
      'parallel for (p, q) in pairs { s += p * q }',
      [
        'ParallelLoop',
        ['Block', ['AddTo', 's', ['Multiply', 'p', 'q']]],
        ['Element', ['Tuple', 'p', 'q'], 'pairs'],
      ],
    ],
    [
      '[k^2 parallel for k in 1..3]',
      [
        'ParallelComprehension',
        ['Power', 'k', 2],
        ['Element', 'k', ['Range', 1, 3]],
      ],
    ],
    [
      '[(k, j) parallel for k in 1..3 if k > 1, j in 1..k]',
      [
        'ParallelComprehension',
        ['Tuple', 'k', 'j'],
        ['Element', 'k', ['Range', 1, 3], ['Greater', 'k', 1]],
        ['Element', 'j', ['Range', 1, 'k']],
      ],
    ],
    [
      '{k -> 1 parallel for k in 1..3}',
      [
        'DictionaryFrom',
        [
          'ParallelComprehension',
          ['Tuple', 'k', 1],
          ['Element', 'k', ['Range', 1, 3]],
        ],
      ],
    ],
    ['s += 1', ['AddTo', 's', 1]],
    ['s+=1', ['AddTo', 's', 1]],
    ['m[1][2] += x', ['AddTo', ['At', 'm', 1, 2], 'x']],
    ['m[1, 2] += x', ['AddTo', ['At', 'm', 1, 2], 'x']],
  ])('%s', (source, json) => {
    const result = parse(source);
    expect(result.codes).toEqual([]);
    expect(result.json).toEqual(json);
  });

  test.each([
    ['a field', 'p.x += 1'],
    ['a string position', 'xs["a"] += 1'],
    ['a call', 'f(x) += 1'],
  ])('the target of `+=` cannot be %s', (_name, source) => {
    expect(parse(source).codes).toEqual(['add-to-target']);
  });

  test('`+=` does not chain', () => {
    expect(parse('a += b += 1').codes).toEqual(['chained-assignment']);
  });

  test.each([
    '[k for k in 1..3, parallel for j in 1..k]',
    '[k for k in 1..3, parallel j in 1..k]',
  ])('only the first clause can be parallel: %s', (source) => {
    const result = parse(source);
    expect(result.codes).toEqual(['parallel-clause-not-first']);
    expect(result.json).toEqual([
      'Comprehension',
      'k',
      ['Element', 'k', ['Range', 1, 3]],
      ['Element', 'j', ['Range', 1, 'k']],
    ]);
  });
});

describe('`parallel` is a contextual keyword', () => {
  // `parallel` left the list of reserved words: it heads a statement only
  // when a `for` follows it on the same line, and it starts a comprehension
  // clause only before a `for`. Everywhere else it is an identifier, as it
  // was when it was reserved and not in use.
  test.each([
    ['an assignment target', 'let parallel = 2\nparallel = parallel + 1\nparallel', 3],
    ['the body of a comprehension', 'let parallel = 2\n[parallel for x in 1..2]', ['List', 2, 2]],
    ['a statement before a `for` on the next line', 'let parallel = 2\nparallel\nfor x in 1..2 { x }\nparallel', 2],
  ])('%s', (_name, source, value) => {
    const { value: result, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(result.json).toEqual(value);
  });

  test('the library function `parallel`', () => {
    expect(parse('parallel(a, b)').json).toEqual(['parallel', 'a', 'b']);
  });
});

describe('the Epsil round trip', () => {
  test.each([
    'parallel for k in 1..3 {\n  L[k] += 1\n}',
    'parallel for (p, q) in pairs {\n  s += p * q\n}',
    '[k^2 parallel for k in 1..3 if k > 1, j in 1..k]',
    '{k parallel for k in 1..3}',
    '{k -> 1 parallel for k in 1..3}',
    's += 2 * x',
    'm[1, 2] += x',
  ])('%s', (source) => {
    const first = parse(source).json;
    const printed = serializeEpsil(parseEpsil(source)[0]);
    expect(printed).toContain(source.includes('parallel') ? 'parallel for' : '+=');
    expect(parse(printed).codes).toEqual([]);
    expect(parse(printed).json).toEqual(first);
  });
});

describe('the LaTeX round trip', () => {
  // The three heads are written in the function form
  // (`\operatorname{ParallelLoop}\left(…\right)`, `\mathrm{AddTo}(…)`).
  test.each([
    [
      'ParallelLoop',
      ['Block', ['AddTo', ['At', 'L', 'k'], 1]],
      ['Element', 'k', ['Range', 1, 3]],
    ],
    ['ParallelComprehension', ['Power', 'k', 2], ['Element', 'k', ['Range', 1, 3]]],
    [
      'ParallelComprehension',
      'k',
      ['Element', 'k', ['Range', 1, 3], ['Greater', 'k', 1]],
      ['Element', 'j', ['Range', 1, 'k']],
    ],
    ['AddTo', 's', 2],
    ['AddTo', ['At', 'L', 2, 'j'], 'x'],
  ])('%j', (...json) => {
    const ce = new ComputeEngine();
    // `L` is declared: a first assignment in a loop body is a static error.
    ce.declare('L', 'list');
    const expr = ce.box(json as never);
    const latex = expr.latex;
    expect(latex).toContain(json[0] as string);
    expect(ce.parse(latex).json).toEqual(expr.json);
  });
});

describe('the static rules', () => {
  test('a valid loop has no diagnostic', () => {
    expect(
      checkCodes(
        'let L = [0, 0]\nlet s = 0\nparallel for k in 1..2 {\n  let t = k\n  t = t + 1\n  t += 1\n  for j in 1..3 { if j > 1 { break } }\n  L[k] += t * random()\n  s += k\n}'
      )
    ).toEqual([]);
  });

  test.each([
    ['an element write', 'let L = [0, 0]\nparallel for k in 1..2 { L[k] = 1 }'],
    ['a variable write', 'let s = 0\nparallel for k in 1..2 { s = s + k }'],
    [
      'a replaceAt write',
      'let L = [0, 0]\nparallel for k in 1..2 { L = replaceAt(L, k, 1) }',
    ],
  ])('rule 1, %s: parallel-outer-write', (_name, source) => {
    expect(checkCodes(source)).toContain('parallel-outer-write');
  });

  test.each([
    ['in the value of `+=`', 'let L = [0, 0]\nparallel for k in 1..2 { L[k] += L[1] }'],
    ['in a condition', 'let s = 0\nparallel for k in 1..2 { s += k; if s > 3 { s += 1 } }'],
  ])('rule 2, a read of an accumulator %s: parallel-accumulator-read', (_name, source) => {
    expect(checkCodes(source)).toEqual(['parallel-accumulator-read']);
  });

  test('rule 3, the target of `+=`: add-to-target', () => {
    expect(checkCodes('let p = 1\nparallel for k in 1..2 { p.x += 1 }')).toEqual([
      'add-to-target',
    ]);
  });

  test.each([
    ['print', 'parallel for k in 1..2 { print(k) }'],
    ['print in a comprehension', '[do { print(k); k } parallel for k in 1..2]'],
  ])('rule 4, an effect other than random (%s): parallel-effect', (_name, source) => {
    const d = checkSource(source).diagnostics;
    expect(d.map((x) => x.message[0])).toEqual(['parallel-effect']);
    expect(d[0].message[1]).toBe('console');
  });

  test.each([
    ['break', 'parallel for k in 1..3 { if k > 1 { break } }'],
    ['continue', 'parallel for k in 1..3 { if k > 1 { continue } }'],
  ])('rule 5, %s: parallel-exit', (keyword, source) => {
    const d = checkSource(source).diagnostics;
    expect(d.map((x) => [x.message[0], x.message[1]])).toEqual([
      ['parallel-exit', keyword],
    ]);
  });

  test('rule 5, a break of an inner loop is valid', () => {
    expect(
      checkCodes('parallel for k in 1..3 { for j in 1..3 { if j > k { break } } }')
    ).toEqual([]);
  });

  test.each([
    ['`+=`', 'let s = 0\n[do { s += k; k } parallel for k in 1..3]'],
    ['`=`', 'let s = 0\n[do { s = k; k } parallel for k in 1..3]'],
  ])('rule 6, a comprehension writes with %s: parallel-comprehension-write', (_name, source) => {
    expect(checkCodes(source)).toEqual(['parallel-comprehension-write']);
  });

  test('rule 6, a comprehension can change its own locals', () => {
    expect(
      checkCodes('[do { let t = k; t += 1; t } parallel for k in 1..3]')
    ).toEqual([]);
  });

  test('rule 6, only the first clause is parallel: parallel-clause-not-first', () => {
    expect(checkCodes('[k for k in 1..3, parallel for j in 1..k]')).toEqual([
      'parallel-clause-not-first',
    ]);
  });
});

describe('the interpreter', () => {
  test.each([
    ['a variable', 'let s = 1\ns += 2\ns', 'let s = 1\ns = s + 2\ns'],
    [
      'a list element',
      'let L = [1, 2, 3]\nL[2] += 5\nL',
      'let L = [1, 2, 3]\nL = replaceAt(L, 2, L[2] + 5)\nL',
    ],
    [
      'a matrix element',
      'let m = [[1, 2], [3, 4]]\nm[2][1] += 10\nm',
      'let m = [[1, 2], [3, 4]]\nm[2, 1] = m[2, 1] + 10\nm',
    ],
  ])('`+=` on %s is the assignment it stands for', (_name, source, assign) => {
    const a = run(source);
    expect(a.diagnostics).toEqual([]);
    expect(a.value.json).toEqual(run(assign).value.json);
  });

  test('a parallel comprehension over a domain that is not resolved stays unevaluated', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer>');
    ce.declare('n', 'integer');
    for (const domain of ['xs', ['Range', 1, 'n']]) {
      const expr = ce.box([
        'ParallelComprehension',
        'x',
        ['Element', 'x', domain],
      ]);
      expect(expr.evaluate().operator).toBe('ParallelComprehension');
    }
    // An empty domain gives the empty list.
    expect(
      ce
        .box(['ParallelComprehension', 'x', ['Element', 'x', ['List']]])
        .evaluate().json
    ).toEqual(['List']);
  });

  test('a domain with a count but no elements that can be computed is not resolved', () => {
    // `Linspace(a, 1, 3)` has 3 elements, but they cannot be computed with
    // `a` unknown: the walk gives no element, and the domain is not known
    // to be empty.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const domain = ['Linspace', 'a', 1, 3];
    expect(ce.box(domain).count).toBe(3);
    const value = ce
      .box(['ParallelComprehension', 'x', ['Element', 'x', domain]])
      .evaluate();
    expect(value.json).toEqual([
      'ParallelComprehension',
      'x',
      ['Element', 'x', domain],
    ]);
    // A domain that is known to be empty without a literal (a count of 0)
    // gives the empty list.
    expect(
      ce
        .box([
          'ParallelComprehension',
          'x',
          [
            'Element',
            'x',
            ['Filter', ['List', 1, 2], ['Function', ['Greater', 'y', 5], 'y']],
          ],
        ])
        .evaluate().json
    ).toEqual(['List']);
  });

  test('a position of `+=` is evaluated once', () => {
    const { value, diagnostics } = run(
      'let n = 0\nfunction pos() scope -> integer { n = n + 1; 2 }\nlet xs = [1, 2, 3]\nxs[pos()] += 9\n[n, xs]'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 1, ['List', 1, 11, 3]]);
  });

  // The target is read before the value is evaluated, as in `s = s + e`.
  // The compiled code declines these programs (a block that assigns is not
  // an operand there), so it has no other value.
  test.each([
    [
      'a variable',
      'let s = 1\ns += do { s = 10; 2 }\ns',
      'let s = 1\ns = s + do { s = 10; 2 }\ns',
      3,
    ],
    [
      'a list element',
      'let L = [1, 2]\nL[1] += do { L = replaceAt(L, 1, 10); 2 }\nL[1]',
      'let L = [1, 2]\nL = replaceAt(L, 1, L[1] + do { L = replaceAt(L, 1, 10); 2 })\nL[1]',
      3,
    ],
  ])('`+=` on %s reads the target before the value', (_name, source, assign, expected) => {
    const a = run(source);
    expect(a.diagnostics).toEqual([]);
    expect(a.value.re).toBe(expected);
    expect(run(assign).value.re).toBe(expected);
  });

  // An increment that assigns the list: the new list is built from the
  // value of the list read before the increment, as `replaceAt(L, …)` reads
  // its first operand before its last one.
  test.each([
    [
      'a list element',
      'let L = [1, 2]\nL[1] += do { L = [10, 20]; 2 }\nL',
      'let L = [1, 2]\nL = replaceAt(L, 1, L[1] + do { L = [10, 20]; 2 })\nL',
    ],
    [
      'a matrix element',
      'let m = [[1, 2], [3, 4]]\nm[2][1] += do { m = [[0, 0], [0, 0]]; 10 }\nm',
      'let m = [[1, 2], [3, 4]]\nm = replaceAt(m, 2, 1, m[2, 1] + do { m = [[0, 0], [0, 0]]; 10 })\nm',
    ],
    [
      'a list element, with a function that assigns the list',
      'let L = [1, 2]\nfunction f() scope -> integer { L = [10, 20]; 2 }\nL[2] += f()\nL',
      'let L = [1, 2]\nfunction f() scope -> integer { L = [10, 20]; 2 }\nL = replaceAt(L, 2, L[2] + f())\nL',
    ],
    [
      'a position out of range',
      'let L = [1, 2]\nL[5] += do { L = [10, 20]; 2 }\nL',
      'let L = [1, 2]\nL = replaceAt(L, 5, L[5] + do { L = [10, 20]; 2 })\nL',
    ],
  ])('`+=` on %s writes into the list read before the value', (_name, source, assign) => {
    const a = run(source);
    const b = run(assign);
    expect(a.value.json).toEqual(b.value.json);
    expect(a.diagnostics.map((d) => d.message)).toEqual(
      b.diagnostics.map((d) => d.message)
    );
  });

  test.each([
    'let s = 1\nabs(s += 1)',
    'let s = 1\n[s += 1]',
    // In a parallel loop, the value of `s += k` would be the running value
    // of the accumulator.
    'let s = 0\nlet L = [0, 0, 0]\nparallel for k in 1..3 { L[k] += (s += k) }',
  ])('`+=` is not a value: %s', (source) => {
    // The value of the program is the error.
    expect(JSON.stringify(run(source).value.json)).toContain(
      'assignment-in-operand'
    );
  });

  test('a write out of range keeps the list', () => {
    const { value, diagnostics } = run('let xs = [1, 2]\nxs[5] += 1\nxs');
    expect(diagnostics.map((d) => d.message[3])).toEqual(['out-of-range']);
    expect(value.json).toEqual(['List', 1, 2]);
  });

  test('a function with `+=` on a local is not a `scope` writer', () => {
    const { value, diagnostics } = run(
      'function f(n) { let L = [0, 0]; parallel for k in 1..n { L[1 + k % 2] += 1 }; L }\nf(5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 2, 3]);
  });

  test('a parallel loop adds every contribution', () => {
    const { value, diagnostics } = run(
      'let L = [0, 0, 0]\nlet s = 0\nparallel for k in 1..6 {\n  L[(k % 3) + 1] += k\n  s += k\n}\n[L, s]'
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', ['List', 9, 5, 7], 21]);
  });

  test.each([
    ['[k^2 parallel for k in 1..4]', '[k^2 for k in 1..4]'],
    ['[k parallel for k in 1..4 if k > 2]', '[k for k in 1..4 if k > 2]'],
    [
      '[(k, j) parallel for k in 1..3, j in 1..k]',
      '[(k, j) for k in 1..3, j in 1..k]',
    ],
  ])('%s is the list of the sequential comprehension', (parallel, sequential) => {
    expect(run(parallel).value.json).toEqual(
      run(`ListFrom(${sequential})`).value.json
    );
  });
});

describe('the random frames of the passes', () => {
  /** Draw `count` values from the frame of pass `k` of a loop that took the
   * index `b` of the frame seeded by `seed` (`docs/RANDOMNESS-MODEL.md` §3). */
  function passDraws(seed: number, b: number, k: number, count: number) {
    const [seedLo, seedHi] = foldSeed(seed);
    const base = beginParallelLoop({ seedLo, seedHi, next: b });
    const frame = parallelPassFrame(base, k);
    return Array.from({ length: count }, (_, n) =>
      frameDraw(frame.seedLo, frame.seedHi, n)
    );
  }

  test('each pass draws from its own frame, and the enclosing frame advances by 1', () => {
    const source =
      'WithRandomSeed(42, (random(), [(random(), random()) parallel for k in 1..4], random()))';
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    const [seedLo, seedHi] = foldSeed(42);
    expect(value.json).toEqual([
      'Tuple',
      frameDraw(seedLo, seedHi, 0),
      [
        'List',
        ...[1, 2, 3, 4].map((k) => ['Tuple', ...passDraws(42, 1, k, 2)]),
      ],
      // The loop took index 1: the next draw is index 2.
      frameDraw(seedLo, seedHi, 2),
    ]);
  });

  test('a parallel loop is not pure: it consumes an index of the frame', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function f() { [1 parallel for k in 1..3] }');
    expect(ce.box('f').type.toString()).toContain('random');
    // A parallel loop in the body of a parallel loop is accepted.
    expect(
      checkCodes(
        'let s = 0\nparallel for j in 1..2 { parallel for k in 1..3 { s += k } }\ns'
      )
    ).toEqual([]);
    expect(
      run('let s = 0\nparallel for j in 1..2 { parallel for k in 1..3 { s += k } }\ns')
        .value.re
    ).toBe(12);
  });

  test('a pass does not depend on the other passes', () => {
    // The pass of the element 3 has the same values when the domain is
    // longer, and when another pass draws more.
    const a = run('WithRandomSeed(7, [random() parallel for k in 1..3])');
    const b = run(
      'WithRandomSeed(7, [do { if k == 1 { random(); random() }; random() } parallel for k in 1..5])'
    );
    const third = (r: ReturnType<typeof run>) =>
      (r.value.json as unknown[])[3];
    expect(third(a)).toEqual(third(b));
    expect(third(a)).toEqual(passDraws(7, 0, 3, 1)[0]);
  });

  test('the statement draws from the same frames', () => {
    const { value } = run(
      'WithRandomSeed(42, do { let s = 0; parallel for k in 1..3 { s += random() }; s })'
    );
    const expected = [1, 2, 3].reduce((t, k) => t + passDraws(42, 0, k, 1)[0], 0);
    expect(value.re).toBeCloseTo(expected, 14);
  });

  test('the compiled JavaScript gives the interpreted values', () => {
    const source =
      'WithRandomSeed(42, (random(), [(random(), random()) parallel for k in 1..4 if random() < 0.7], random()))';
    // `["Tuple", draw, ["List", ["Tuple", u, v], …], draw]`
    const interpreted = (run(source).value.json as unknown[]).slice(1);
    const result = compileEpsil(new ComputeEngine(), source);
    expect(result.success).toBe(true);
    const compiled = result.run() as unknown[];
    expect(compiled[0]).toBe(interpreted[0]);
    expect(compiled[1]).toEqual(
      (interpreted[1] as unknown[]).slice(1).map((t) => (t as unknown[]).slice(1))
    );
    expect(compiled[2]).toBe(interpreted[2]);
  });

  test('a compiled statement loop over a range gives the interpreted values', () => {
    // A block that assigns compiles as the body of a function, not as an
    // operand of `WithRandomSeed`; the input `m` keeps the compilation from
    // folding the seeded value.
    const definition =
      'function g(n: integer) { let s = 0; parallel for k in 1..n { s += random() }; s }';
    const call = 'WithRandomSeed(42, (random(), g(m), random()))';
    const interpreted = run(`${definition}\nlet m = 3\n${call}`).value;
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    executeEpsil(ce, definition);
    const result = compileEpsil(ce, call);
    expect(result.success).toBe(true);
    expect(result.run({ m: 3 })).toEqual([...interpreted.each()].map((x) => x.re));
  });

  // The draws of a lazy view that draws inside a pass are not specified
  // (`docs/RANDOMNESS-MODEL.md` §3, "Pass frames of a parallel loop"): the
  // passes evaluate the same boxed body, and the caches of a view are per
  // instance (§6), so a pass can read the draws that the view made in
  // another pass. The tests below check only what stays guaranteed: the
  // direct draws of each pass, and the draws of the enclosing frame.

  test('with a lazy view in the body, the direct draws of each pass come from its frame', () => {
    // The direct draw is the first draw of its pass, before the view.
    const source =
      'WithRandomSeed(7, ([(random(), sum([random() for j in 1..2])) parallel for k in 1..2], random()))';
    const [list, after] = [...run(source).value.ops!];
    const direct = [...list.each()].map((t) => t.ops![0].re);
    expect(direct).toEqual([1, 2].map((k) => passDraws(7, 0, k, 1)[0]));
    const [seedLo, seedHi] = foldSeed(7);
    expect(after.re).toBe(frameDraw(seedLo, seedHi, 1));
    const result = compileEpsil(new ComputeEngine(), source);
    expect(result.success).toBe(true);
    const compiled = result.run() as [[number, number][], number];
    expect(compiled[0].map((t) => t[0])).toEqual(direct);
    expect(compiled[1]).toBe(after.re);
  });

  test('a lazy view in the body of a statement loop: the enclosing frame advances by 1', () => {
    const definition =
      'function g(n: integer) { let s = 0; parallel for k in 1..n { s += sum([random() for j in 1..2]) }; s }';
    const call = 'WithRandomSeed(7, (g(m), random()))';
    const interpreted = run(`${definition}\nlet m = 2\n${call}`).value;
    const [total, after] = [...interpreted.ops!].map((x) => x.re);
    expect(Number.isFinite(total)).toBe(true);
    const [seedLo, seedHi] = foldSeed(7);
    expect(after).toBe(frameDraw(seedLo, seedHi, 1));
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    executeEpsil(ce, definition);
    const result = compileEpsil(ce, call);
    expect(result.success).toBe(true);
    const compiled = result.run({ m: 2 }) as number[];
    expect(compiled[1]).toBe(after);
  });

  test('a lazy view that does not draw gives the same values in each pass', () => {
    expect(
      run('[sum([j * k for j in 1..2]) parallel for k in 1..3]').value.json
    ).toEqual(['List', 3, 6, 9]);
  });

  test('a lazy view held in a `let` of the body: the program runs', () => {
    const source =
      'WithRandomSeed(7, [do { let v = [random() for j in 1..2]; sum(v) } parallel for k in 1..2])';
    const values = [...run(source).value.each()].map((x) => x.re);
    expect(values.length).toBe(2);
    expect(values.every((x) => Number.isFinite(x))).toBe(true);
    expect(compileEpsil(new ComputeEngine(), source).success).toBe(true);
  });

  test.each([
    ['a list literal', '[random(), random()]'],
    [
      'a loop that appends',
      'do { let v = []; for j in 1..2 { v = append(v, random()) }; v }',
    ],
  ])('to get per-pass draws, draw directly: %s', (_name, body) => {
    // Each `random()` is evaluated in the pass, so its draw is a direct
    // draw from the frame of the pass.
    expect(
      run(`WithRandomSeed(7, [${body} parallel for k in 1..2])`).value.json
    ).toEqual([
      'List',
      ['List', ...passDraws(7, 0, 1, 2)],
      ['List', ...passDraws(7, 0, 2, 2)],
    ]);
  });

  test('a lazy view filled before the loop keeps its elements in each pass', () => {
    const { value } = run(
      'WithRandomSeed(7, do { let v = [random() for j in 1..2]; let t = sum(v); [sum(v) - t parallel for k in 1..3] })'
    );
    expect([...value.each()].map((x) => x.re)).toEqual([0, 0, 0]);
  });

  test('a pure lazy view in the body is computed once for all the passes', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Counted', {
      signature: '(integer) -> integer',
      pure: true,
      evaluate: ([x]) => {
        calls += 1;
        return x;
      },
    });
    const { value } = executeEpsil(
      ce,
      '[sum(map((x) => Counted(x), 1..3)) parallel for k in 1..4]'
    );
    expect(value.json).toEqual(['List', 6, 6, 6, 6]);
    expect(calls).toBe(3);
  });

  test('an element that cannot draw stays a lazy view', () => {
    expect(run('[1..k parallel for k in 1..3]').value.json).toEqual([
      'List',
      ['Range', 1, 1],
      ['Range', 1, 2],
      ['Range', 1, 3],
    ]);
  });

  test('a throw in a pass installs the enclosing frame again', () => {
    // `Caught(x)` gives -1 when the evaluation of `x` throws. The body of
    // the pass throws (the iteration limit, in the walk of the inner
    // comprehension) while the frame of pass 1 is installed; the next draw
    // is from the enclosing frame, at the index after the one that the loop
    // took.
    const ce = new ComputeEngine();
    ce.iterationLimit = 5;
    ce.declare('Caught', {
      signature: '(any) -> any',
      lazy: true,
      evaluate: ([x]) => {
        try {
          return x.evaluate();
        } catch {
          return ce.number(-1);
        }
      },
    });
    const { value } = executeEpsil(
      ce,
      'WithRandomSeed(7, (Caught([sum([random() for i in 1..9]) parallel for k in 1..1]), random()))'
    );
    const [seedLo, seedHi] = foldSeed(7);
    expect(value.json).toEqual(['Tuple', -1, frameDraw(seedLo, seedHi, 1)]);
  });
});

describe('the numeric approximation of a parallel comprehension', () => {
  test('`N()` approximates each element', () => {
    const value = new ComputeEngine()
      .box([
        'ParallelComprehension',
        ['Ln', 'k'],
        ['Element', 'k', ['List', 2, 3]],
      ])
      .N();
    expect(value.operator).toBe('List');
    const elements = [...value.each()];
    expect(elements.every((x) => x.isNumberLiteral)).toBe(true);
    expect(elements[0].re).toBeCloseTo(Math.log(2), 14);
    expect(elements[1].re).toBeCloseTo(Math.log(3), 14);
  });
});

describe('the JavaScript target', () => {
  test('`+=` on a list element updates the list in place, as the `replaceAt` form', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    const program = (write: string) =>
      [
        'do {',
        '  let xs: list<real> = L',
        `  for i in 1..3 { ${write} }`,
        '  xs',
        '}',
      ].join('\n');
    const addTo = compileEpsil(ce, program('xs[i] += 2 * i'));
    const assign = compileEpsil(ce, program('xs = replaceAt(xs, i, xs[i] + 2 * i)'));
    expect(addTo.success).toBe(true);
    expect(addTo.code).toContain('_SYS.replaceAtInPlace');
    expect(addTo.warnings).toEqual(assign.warnings);
    expect(addTo.run({ L: [1, 2, 3] })).toEqual([3, 6, 9]);
  });

  test('a position of `+=` with an effect declines', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.box(
        resolveLibraryNames(
          parseEpsil('do { let L = [0, 0]; L[randomInteger(1, 2)] += 1; L }')[0] as never,
          '',
          ce
        ) as never
      )
    );
    expect(result.success).toBe(false);
  });

  test('a parallel loop over a string iterates its grapheme clusters', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'string');
    const s = 'a\u{1F468}‍\u{1F469}‍\u{1F467}b';
    // The interpreter gives the three grapheme clusters.
    const interpreted = run(`[c parallel for c in ${JSON.stringify(s)}]`);
    expect((interpreted.value.json as unknown[]).length - 1).toBe(3);
    const comprehension = compileEpsil(ce, '[c parallel for c in s]');
    expect(comprehension.success).toBe(true);
    expect(comprehension.run({ s })).toEqual(
      compileEpsil(ce, '[c for c in s]').run({ s })
    );
    expect(comprehension.run({ s })).toEqual([
      'a',
      '\u{1F468}‍\u{1F469}‍\u{1F467}',
      'b',
    ]);
    const loop = compileEpsil(
      ce,
      'do { let n = 0; parallel for c in s { n += 1 }; n }'
    );
    expect(loop.success).toBe(true);
    expect(loop.run({ s })).toBe(3);
  });

  test('a parallel loop over a range is a counted loop', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..n { s += k }; s }'
    );
    expect(result.success).toBe(true);
    expect(result.code).toContain('_SYS.parallelPassesBegin()');
    expect(result.code).not.toContain('Array.from');
    expect(result.run({ n: 4 })).toBe(10);
  });

  test('a function of the engine with `parallel for` and `+=` compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const definitions = [
      'function step(L: list<number>, n: integer) { parallel for k in 1..n { L[k] += 1 }; L }',
      'function total(L: list<number>, n: integer) { let s = 0; parallel for k in 1..n { s += L[k] }; s }',
    ].join('\n');
    expect(executeEpsil(ce, definitions).diagnostics).toEqual([]);
    const H = [5, 6, 7, 8];
    for (const [call, expected] of [
      ['step(H, 3)', [6, 7, 8, 8]],
      ['total(H, 3)', 18],
    ] as const) {
      const result = compileEpsil(ce, call);
      expect(result.success).toBe(true);
      expect(result.run({ H })).toEqual(expected);
      // The interpreter gives the same value.
      const interpreted = run(
        `${definitions}\nlet H = [${H.join(', ')}]\n${call}`
      ).value;
      expect(
        Array.isArray(expected)
          ? [...interpreted.each()].map((x) => x.re)
          : interpreted.re
      ).toEqual(expected);
    }
  });

  // The body of a `parallel for` is a statement list, as the body of a
  // `for`: its last statement, here an `if` with no `else` whose branch
  // ends with an inner `for`, is a statement, and the value of the inner
  // loop is not used. Before, the check of a used loop value read the body
  // of a `ParallelLoop` as a value, and the compilation declined with "the
  // value of this `Loop` is used" (issue CE-1164).
  test('a parallel loop whose body ends with an inner loop compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const definition = `function f(H: list<integer>, n: integer) -> list<integer> {
      let L = H
      parallel for k in 1..n {
        if k > 0 {
          for m in 1..3 { L[m] += 1 }
        }
      }
      L
    }`;
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    const result = compileEpsil(ce, 'f([0, 0, 0, 0], n)');
    expect(result.success).toBe(true);
    expect(result.run({ n: 5 })).toEqual([5, 5, 5, 0]);
    const interpreted = run(`${definition}\nf([0, 0, 0, 0], 5)`).value;
    expect([...interpreted.each()].map((x) => x.re)).toEqual([5, 5, 5, 0]);
  });

  // A parameter with no declared type takes the type that the assignment
  // `+=` stands for gives it: a list argument is then bound whole, not
  // applied to each element.
  test('a parameter changed with `+=` has the type of the assignment form', () => {
    const signature = (definition: string): string => {
      const ce = new ComputeEngine();
      expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
      return ce.box('step').type.toString();
    };
    expect(
      signature('function step(L, n) { for k in 1..n { L[k] += 1 }; L }')
    ).toBe(
      signature('function step(L, n) { for k in 1..n { L[k] = L[k] + 1 }; L }')
    );
    expect(signature('function step(x) { x += 1; x }')).toBe(
      signature('function step(x) { x = x + 1; x }')
    );

    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const definition =
      'function step(L, n) { parallel for k in 1..n { L[k] += 1 }; L }';
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    const H = [5, 6, 7, 8];
    const interpreted = run(
      `${definition}\nlet H = [${H.join(', ')}]\nstep(H, 3)`
    );
    expect(interpreted.diagnostics).toEqual([]);
    expect(interpreted.value.json).toEqual(
      run(
        `function step(L, n) { for k in 1..n { L[k] = L[k] + 1 }; L }\nlet H = [${H.join(', ')}]\nstep(H, 3)`
      ).value.json
    );
    expect(interpreted.value.json).toEqual(['List', 6, 7, 8, 8]);
    const compiled = compileEpsil(ce, 'step(H, 3)');
    expect(compiled.success).toBe(true);
    expect(compiled.run({ H })).toEqual([6, 7, 8, 8]);
  });

  test.each(['glsl', 'interval-js', 'python'])(
    'the target %s declines the parallel heads',
    (to) => {
      const ce = new ComputeEngine();
      for (const source of [
        'do { let s = 0; parallel for k in 1..n { s += k }; s }',
        '[k * x parallel for k in 1..n]',
      ]) {
        const [ast] = parseEpsil(source);
        // With no fallback, the decline is an error that names the reason,
        // or (interval-js) a result that is not a success.
        let declined: boolean;
        try {
          declined = !(
            compile(ce.box(ast as never), { to, fallback: false } as never) as {
              success: boolean;
            }
          ).success;
        } catch (e) {
          declined = /parallel for|GLSL fragment/.test(String(e));
        }
        expect(declined).toBe(true);
      }
    }
  );
});

//
// The witness: the `step` function of Tycho's `buddhabrot` showcase
// (`~/dev/tycho/src/graph-paper/onboarding/template-data.js`), on a smaller
// grid (planes of 15 × 20 cells), with lower ceilings (200, 50, 10 passes),
// and with few samples, so the test is fast. Written once with `for` and
// `replaceAt`, and once with `parallel for` and `+=`.
//
function buddhabrot(parallel: boolean): string {
  const add = (cell: string) =>
    parallel ? `L[${cell}] += 1` : `L = replaceAt(L, ${cell}, L[${cell}] + 1)`;
  return `const N = 901
const H_0 = [0 for k in 1..N]
function step(H: list<number>, n: integer) {
  let L = H
  const r = H[901]
  ${parallel ? 'parallel for' : 'for'} k in 1..n {
    const p = 3 * fract(0.7548776662 * (r + k)) - 2
    const q = 3 * fract(0.5698402910 * (r + k)) - 1.5
    const x = p - 0.25
    const t = x^2 + q^2
    if t * (t + x) > q^2 / 4 && (p + 1)^2 + q^2 > 1/16 {
      let a = 0.0
      let b = 0.0
      let e = 0
      let sa = 0.0
      let sb = 0.0
      let s = 2
      for m in 1..200 {
        (a, b) := (a^2 - b^2 + p, 2*a*b + q)
        if a^2 + b^2 > 4 { e = m; break }
        if abs(a - sa) < 1e-12 && abs(b - sb) < 1e-12 { break }
        if m == s { sa = a; sb = b; s = 2*s }
      }
      if e > 0 {
        a = 0.0
        b = 0.0
        for m in 1..e {
          (a, b) := (a^2 - b^2 + p, 2*a*b + q)
          if a^2 + b^2 > 4 { break }
          const i = floor((b + 1.125) / 2.25 * 15)
          const j = floor((1 - a) / 3 * 20)
          if i >= 0 && i < 15 && j >= 0 && j < 20 {
            const c = 1 + i + 15*j
            const d = 15 - i + 15*j
            ${add('c')}
            ${add('d')}
            if e <= 50 {
              ${add('c + 300')}
              ${add('d + 300')}
            }
            if e <= 10 {
              ${add('c + 600')}
              ${add('d + 600')}
            }
          }
        }
      }
    }
  }
  L = replaceAt(L, 901, r + n)
  L
}
`;
}

describe('the witness: the buddhabrot step', () => {
  const samples = 40;

  test('the parallel form has no diagnostic', () => {
    expect(checkCodes(buddhabrot(true))).toEqual([]);
  });

  test('both forms give the same counts, in the interpreter and in JavaScript', () => {
    const interpreted = (parallel: boolean) => {
      const { value, diagnostics } = run(
        `${buddhabrot(parallel)}step(step(H_0, ${samples}), ${samples})`
      );
      expect(diagnostics).toEqual([]);
      return [...value.each()].map((x) => x.re);
    };
    const sequential = interpreted(false);
    expect(interpreted(true)).toEqual(sequential);
    // The orbits cross some cells, and the last element counts the samples.
    expect(sequential.slice(0, 900).some((c) => (c as number) > 0)).toBe(true);
    expect(sequential[900]).toBe(2 * samples);

    const compiled = (parallel: boolean) => {
      const ce = new ComputeEngine();
      ce.declare('H', 'list<number>');
      const result = compileEpsil(
        ce,
        `do {\n${buddhabrot(parallel)}step(step(H, ${samples}), ${samples})\n}`
      );
      expect(result.success).toBe(true);
      if (parallel) expect(result.code).toContain('_SYS.parallelPasses');
      return result.run({ H: new Array(901).fill(0) });
    };
    expect(compiled(false)).toEqual(sequential);
    expect(compiled(true)).toEqual(sequential);
  });
});

describe('the static rules: calls, local writes, and checks that cannot decide', () => {
  /** The messages of `epsil check`, without the ranges. */
  function messages(source: string, engine?: ComputeEngine): unknown[] {
    return checkSource(source, undefined, engine ? { engine } : {}).diagnostics.map(
      (d) => d.message
    );
  }

  // Rule 2 reports only a read of an accumulator written by name in the
  // pass. A call is not followed: a read in a called function gives an
  // unspecified value ('rule 2: a read of an accumulator by another route
  // is not checked', below).
  test.each([
    [
      'a function of the program that reads the accumulator',
      'let s = 0\nfunction total() { s }\nparallel for k in 1..3 { s += total() + k }',
    ],
    [
      'a function of the program that reads no accumulator',
      'let s = 0\nfunction sq(x) { x^2 }\nparallel for k in 1..3 { s += sq(k) + max(k, 2) }',
    ],
    [
      'a variable bound to a function literal',
      'let s = 0\nlet h = (x) => x + 1\nparallel for k in 1..3 { s += h(k) }',
    ],
    [
      'an expression',
      'let s = 0\nlet fs = [() => 1]\nparallel for k in 1..3 { s += fs[1]() }',
    ],
    [
      'a parameter',
      'function integrate(f, n) {\n let s = 0\n parallel for k in 1..n { s += f(k) }\n s\n}',
    ],
  ])('rule 2, a call of %s has no diagnostic', (_name, source) => {
    expect(messages(source)).toEqual([]);
  });

  test('rule 2, library functions and functions written in the pass are valid', () => {
    expect(
      messages(
        'let s = 0\nparallel for k in 1..3 {\n let g = (x) => x\n function h(x) { 2 * x }\n s += g(k) + h(k) + ((x) => x)(k) + max(k, 2) + map((x) => x + 1, [k])[1] + map(Sqrt, [k])[1]\n}'
      )
    ).toEqual([]);
  });

  test('rule 2, a read in a function literal written in the pass: parallel-accumulator-read', () => {
    expect(
      messages(
        'let s = 0\nparallel for k in 1..3 { let g = () => s\n s += g() + k }'
      )
    ).toEqual([['parallel-accumulator-read', 's']]);
  });

  test('rule 2, an untyped list parameter is read as a value', () => {
    expect(
      messages(
        'function f(xs, m) {\n let s = 0\n parallel for k in 1..length(xs) { s += xs[k] + length(xs) + sum(xs) + m[k, 1] }\n s\n}'
      )
    ).toEqual([]);
  });

  test('rule 2, a loop with no accumulator can call a function of the program', () => {
    expect(
      messages(
        'function sq(x) { x^2 }\nparallel for k in 1..3 { let t = sq(k) }'
      )
    ).toEqual([]);
  });

  test.each([
    ['a loop variable', 'parallel for f in [() => print(1)] { f() }'],
    [
      'a loop variable passed to a library function',
      'parallel for f in [(x) => print(x)] { let t = map(f, [1]) }',
    ],
    [
      'a loop variable passed to a function of the program',
      'function app(g) { g() }\nparallel for f in [() => print(1)] { app(f) }',
    ],
    [
      'a literal passed to a parameter of a literal in the pass',
      'parallel for k in 1..2 { let app = (g) => g(k)\n let t = app(() => print(k)) }',
    ],
  ])('rule 4, a call of a function value (%s) has the inferred effects', (_name, source) => {
    expect(messages(source)).toEqual([['parallel-effect', 'console']]);
  });

  test.each([
    ['called', 'function run(fs) { parallel for f in fs { f() } }'],
    [
      'passed to a function of the program',
      'function app(g) { g() }\nfunction run(fs) { parallel for f in fs { app(f) } }',
    ],
  ])('rule 4, a function value whose type is not known is inferred pure (%s)', (_name, source) => {
    // The documented limit: the loop variable has the element type of an
    // unannotated parameter, so the effects of the functions in `fs` are not
    // seen.
    expect(messages(source)).toEqual([]);
  });

  test('rule 4, an annotated parameter gives the contract of the effects', () => {
    expect(
      messages(
        'function run(fs: list<() any -> any>) { parallel for f in fs { f() } }'
      )
    ).toEqual([['parallel-effect', 'any']]);
  });

  test('rule 4, a function literal applied in the pass has its inferred effects', () => {
    expect(
      messages('parallel for k in 1..2 { let g = () => print(k)\n g() }')
    ).toEqual([['parallel-effect', 'console']]);
    expect(
      messages('[do { let g = (x) => x^2\n g(k) } parallel for k in 1..3]')
    ).toEqual([]);
  });

  test('rule 2, the key of a `let` is not a read of a variable `value`', () => {
    expect(
      messages('let value = 0\nparallel for k in 1..3 { let t = 1\n value += t }')
    ).toEqual([]);
  });

  test.each([
    ['the loop variable', 'parallel for k in 1..3 { k += 1 }'],
    ['a destructured loop variable', 'parallel for (a, b) in [(1, 2)] { a += b }'],
  ])('rule 4, a write to %s is not a scope effect', (_name, source) => {
    expect(messages(source)).toEqual([]);
  });

  test('rule 4, an inference that fails reports the effect `any`', () => {
    const ce = new ComputeEngine();
    const statement = parseEpsil('parallel for k in 1..3 { print(k) }')[0] as never;
    const box = ce.box.bind(ce);
    // The effect inference boxes a function literal: make it fail.
    ce.box = ((expr: unknown, options?: unknown) => {
      if (Array.isArray(expr) && expr[0] === 'Function') throw new Error('box');
      return box(expr as never, options as never);
    }) as typeof ce.box;
    expect(
      parallelLoopDiagnostics(ce, statement).map((d) => d.message)
    ).toEqual([['parallel-effect', 'any']]);
  });

  test('a node with no source range is reported at the parallel node', () => {
    const statement = {
      fn: ['ParallelLoop', ['Block', ['Break']], ['Element', 'k', ['Range', 1, 3]]],
      sourceOffsets: [0, 30],
    } as never;
    const d = parallelLoopDiagnostics(new ComputeEngine(), statement);
    expect(d.map((x) => [x.message, x.range])).toEqual([
      [['parallel-exit', 'break'], [0, 30]],
    ]);
  });

  test('the rules, also the effect rule, apply when the statement cannot be boxed', () => {
    const ce = new ComputeEngine();
    const box = ce.box.bind(ce);
    // Make the boxing of the statement fail: the static pass then skips the
    // engine checks of the statement.
    let failures = 0;
    ce.box = ((expr: unknown, options?: unknown) => {
      const head = (expr as { fn?: unknown[] } | null)?.fn?.[0];
      if (head === 'ParallelLoop') {
        failures += 1;
        throw new Error('box');
      }
      return box(expr as never, options as never);
    }) as typeof ce.box;
    expect(
      messages(
        'let s = 0\nlet L = [0, 0]\nparallel for k in 1..2 { L[k] = s\n s += k\n print(k)\n if k > 1 { break } }',
        ce
      ).map((m) => (m as unknown[])[0])
    ).toEqual([
      'parallel-exit',
      'parallel-outer-write',
      'parallel-accumulator-read',
      'parallel-effect',
    ]);
    expect(failures).toBeGreaterThan(0);
  });
});

describe('`+=` errors, the reference analysis, and an empty parallel loop', () => {
  /** The diagnostics of `epsil check`, each as its code and, for a static
   * type error, the code of the error it reports (the last element). */
  function checkErrors(source: string): string[] {
    return checkSource(source).diagnostics.map((d) => {
      if (!Array.isArray(d.message)) return String(d.message);
      const [code, ...rest] = d.message.map(String);
      return code === 'static-type-error' ? `${code}:${rest.at(-1)}` : code;
    });
  }

  test.each([
    [
      'parallel for k in 1..3 { t += k }',
      'parallel for k in 1..3 { t = t + k }',
    ],
    ['for k in 1..3 { t += k }', 'for k in 1..3 { t = t + k }'],
    [
      'function f(n) { for k in 1..n { u += k }; 0 }',
      'function f(n) { for k in 1..n { u = u + k }; 0 }',
    ],
    [
      'for k in 1..2 { M[k] += 1 }',
      'for k in 1..2 { M = replaceAt(M, k, M[k] + 1) }',
    ],
    ['let s = "a"\ns += 1', 'let s = "a"\ns = s + 1'],
    ['let s = 0\ns += "a"', 'let s = 0\ns = s + "a"'],
    ['let s: number = 0\ns += [1, 2]', 'let s: number = 0\ns = s + [1, 2]'],
    [
      'let L = [1, 2]\nL[1] += "a"',
      'let L = [1, 2]\nL = replaceAt(L, 1, L[1] + "a")',
    ],
  ])('`%s` has the static errors of its long form', (short, long) => {
    // The long form of a parallel loop also writes a variable declared
    // outside the loop, which `+=` may do: that rule is not compared.
    const errors = checkErrors(short);
    expect(errors).toEqual(
      checkErrors(long).filter((c) => c !== 'parallel-outer-write')
    );
  });

  test('an undeclared `+=` target in a loop body is a first assignment', () => {
    expect(checkErrors('for k in 1..3 { t += k }')).toEqual([
      'static-type-error:first-assignment-in-branch',
    ]);
  });

  test('the target of `AddTo` is checked before its value and its positions declare it', () => {
    // The increment `t`, or the position `Length(L)`, names the undeclared
    // target. A canonical form of it would declare the name before the
    // check; the target is checked first, as `Assign` does.
    const cases: [unknown, unknown, string][] = [
      [
        ['AddTo', 't', 't'],
        ['Assign', 't', ['Add', 't', 't']],
        't',
      ],
      [
        ['AddTo', ['At', 'L', ['Length', 'L']], 1],
        [
          'Assign',
          'L',
          [
            'ReplaceAt',
            'L',
            ['Length', 'L'],
            ['Add', ['At', 'L', ['Length', 'L']], 1],
          ],
        ],
        'L',
      ],
    ];
    for (const [short, long, name] of cases) {
      const error = [
        'Error',
        ['ErrorCode', "'first-assignment-in-branch'", `'${name}'`],
      ];
      for (const body of [short, long]) {
        const loop = new ComputeEngine().box([
          'Loop',
          body,
          ['Element', 'k', ['Range', 1, 3]],
        ] as never);
        expect(loop.json).toEqual(['Loop', error, ['Element', 'k', ['Range', 1, 3]]]);
      }
    }
    expect(checkErrors('for k in 1..3 { t += t }')).toEqual([
      'static-type-error:first-assignment-in-branch',
    ]);
  });

  test('a valid `+=` has no diagnostic and keeps its head', () => {
    expect(
      checkCodes('let t = 0\nparallel for k in 1..3 { t += k }\nt')
    ).toEqual([]);
    expect(
      checkCodes('let L = [0, 0, 0]\nparallel for k in 1..3 { L[k] += k }\nL')
    ).toEqual([]);
    const ce = new ComputeEngine();
    const expr = ce.box(['Block', ['Assign', 't', 0], ['AddTo', 't', 1], 't']);
    expect(expr.isValid).toBe(true);
    expect(JSON.stringify(expr.json)).toContain('AddTo');
  });

  test('the reference analysis of a call to a function whose `+=` position has an effect does not throw', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'function f(n) { let L = [0, 0, 0]; L[random(1..3)] += n; L }'
    );
    ce.declare('m', 'integer');
    // With a registry of user functions, the analysis visits the body of `f`.
    const target = {
      ...new JavaScriptTarget(ce).createTarget(),
      userFunctions: { defs: new Map<string, string>(), compiling: new Set<string>() },
    };
    const result = analyzeReferences(ce.box(['f', 'm']), target);
    expect(result.freeSymbols).toEqual(['m']);
    // The body is visited as it is, and the target does not lower `AddTo`.
    expect(result.unsupported).toEqual(['AddTo']);
  });

  test('the reference analysis binds the index of a parallel loop that is not lowered', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'function f(n) { let L = [0, 0, 0]; parallel for k in 1..n { L[random(1..3)] += k }; L }'
    );
    ce.declare('m', 'integer');
    const target = {
      ...new JavaScriptTarget(ce).createTarget(),
      userFunctions: { defs: new Map<string, string>(), compiling: new Set<string>() },
    };
    // The lowering of the body throws, so the body is visited as it is,
    // with its `ParallelLoop` head: `k` is its index, not an input.
    expect(analyzeReferences(ce.box(['f', 'm']), target).freeSymbols).toEqual([
      'm',
    ]);
  });

  test('the reference analysis binds the indices of a parallel comprehension', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    const target = new JavaScriptTarget(ce).createTarget();
    const expr = ce.box([
      'ParallelComprehension',
      ['Tuple', 'i', 'j'],
      ['Element', 'i', ['Range', 1, 'm']],
      ['Element', 'j', ['Range', 1, 'i']],
    ]);
    expect(analyzeReferences(expr, target).freeSymbols).toEqual(['m']);
  });

  test('an empty parallel loop consumes an index of the frame, as in compiled code', () => {
    const definition =
      'function g(n: integer) { parallel for k in 1..n { }; random() }';
    const call = 'WithRandomSeed(42, (random(), g(m), random()))';
    const interpreted = run(`${definition}\nlet m = 3\n${call}`).value;
    const [seedLo, seedHi] = foldSeed(42);
    // Index 0 before the loop, index 1 for the loop, then 2 and 3.
    expect(interpreted.json).toEqual([
      'Tuple',
      frameDraw(seedLo, seedHi, 0),
      frameDraw(seedLo, seedHi, 2),
      frameDraw(seedLo, seedHi, 3),
    ]);
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    executeEpsil(ce, definition);
    const result = compileEpsil(ce, call);
    expect(result.success).toBe(true);
    expect(result.run({ m: 3 })).toEqual(
      [...interpreted.each()].map((x) => x.re)
    );
  });

  test('a parallel loop whose body is `Nothing` consumes an index of the frame, as in compiled code', () => {
    // The Epsil body `{ }` is `Block()`; a body that is the symbol `Nothing`
    // takes another branch of the interpreter.
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    const expr = ce.box([
      'WithRandomSeed',
      42,
      [
        'Tuple',
        ['Random'],
        [
          'Block',
          ['ParallelLoop', 'Nothing', ['Element', 'k', ['Range', 1, 'm']]],
          ['Random'],
        ],
        ['Random'],
      ],
    ]);
    const [seedLo, seedHi] = foldSeed(42);
    const expected = [0, 2, 3].map((n) => frameDraw(seedLo, seedHi, n));
    // Compiled while `m` has no value: the input keeps the compilation from
    // folding the seeded value.
    const result = compile(expr, { fallback: false } as never) as never as {
      success: boolean;
      run: (vars?: Record<string, unknown>) => unknown;
    };
    expect(result.success).toBe(true);
    expect(result.run({ m: 3 })).toEqual(expected);
    ce.assign('m', 3);
    expect([...expr.evaluate().each()].map((x) => x.re)).toEqual(expected);
  });
});

describe('rule 2: programs that the checker accepts', () => {
  /** The messages of `epsil check`, without the ranges. */
  function messages(source: string): unknown[] {
    return checkSource(source).diagnostics.map((d) => d.message);
  }

  test.each([
    [
      'a function of the program that does not read the accumulator',
      'let s = 0\nfunction sq(x) { x * x }\nparallel for k in 1..3 { s += sq(k) }',
      14,
    ],
    [
      'a comparison with an untyped variable',
      'let s = 0\nlet m = 2\nparallel for k in 1..3 { if m == k { s += 10 } else { s += k } }',
      14,
    ],
    [
      'a qualified name of the standard library',
      'let s = 0\nparallel for k in 1..3 { s += std::floor(k / 2) }',
      2,
    ],
    [
      'a pipeline stage with a nested placeholder',
      'let s = 0\nparallel for k in 1..3 { s += k |> max(_ + 1, 3) }',
      10,
    ],
    [
      'a library function with a function literal',
      'let s = 0\nlet xs = [1, 2, 3]\nparallel for k in 1..3 { s += count(xs, (x) => x > 1) }',
      6,
    ],
    [
      'a pipeline of library functions and a literal',
      'let s = 0\nlet xs = [1, 2]\nparallel for k in 1..3 { s += xs |> map((x) => x * k) |> sum }',
      18,
    ],
    [
      'the accumulator in the domain, which is read before the passes',
      'let s = 3\nparallel for k in 1..s { s += k }',
      9,
    ],
    [
      'nested parallel loops with the same accumulator',
      'let s = 0\nparallel for i in 1..3 { parallel for j in 1..2 { s += i * j } }',
      18,
    ],
    [
      'a constructor of a declared type',
      'type Shape = Circle(r: number) | Rect(a: number)\nlet s = 0\nparallel for k in 1..3 { let c = Circle(k)\n s += k }',
      6,
    ],
    [
      'a capture of a `match` case with the name of the accumulator',
      'let s = 0\nparallel for k in 1..3 {\n s += match k {\n  1 => 2\n  s => s\n }\n}',
      7,
    ],
    [
      'a pattern of a `match` case',
      'type Shape = Circle(r: number) | Rect(a: number)\nlet s = 0\nparallel for k in 1..3 {\n s += match Circle(k) {\n  Circle(r) => r\n  Rect(a) => a\n }\n}',
      6,
    ],
    [
      'a parameter with a default value of a literal in the pass',
      'let s = 0\nparallel for k in 1..3 { let c = (s = 1) => s\n s += c() + k }',
      9,
    ],
    [
      'a first assignment in a function of the pass, then `+=` on it',
      'let s = 0\nparallel for k in 1..3 {\n function h(x) { t = x; t += 1; t }\n s += h(k)\n}',
      9,
    ],
  ])('%s', (_name, source, expected) => {
    expect(messages(source)).toEqual([]);
    const result = run(`${source}\ns`);
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual(expected);
  });

  test('a first assignment to a name declared before the loop is an outer write', () => {
    expect(
      messages(
        'let s = 0\nlet t = 0\nparallel for k in 1..3 {\n function h(x) { t = x + 1; t }\n s += h(k)\n}'
      )
    ).toEqual([['parallel-outer-write', 't']]);
  });

  test.each([
    [
      'a function defined in the enclosing body',
      'function f(n) {\n function h(x) { x + 1 }\n parallel for k in 1..n { let t = h(k) }\n}',
    ],
    [
      'a function defined later in the program',
      'function run(n) { parallel for k in 1..n { let t = later(k) } }\nfunction later(x) { x }',
    ],
    [
      'a library function with a parameter that can be a function (`partition`)',
      'let xs = [1, 2, 3, 4]\nparallel for k in 1..3 { let t = partition(xs, 2) }',
    ],
    [
      'a constant that holds a function literal',
      'const f = (x) => x^2\n[f(k) parallel for k in 1..3]',
    ],
    [
      'a function of the program and a variable that holds no function',
      'function twice(f, x) { f(f(x)) }\nfunction f(y) { y + 1 }\nlet a = 2\nparallel for k in 1..3 { let t = f(k) * a }',
    ],
  ])('%s is valid in a loop with no accumulator', (_name, source) => {
    expect(messages(source)).toEqual([]);
  });
});

// A read of an accumulator in a pass gives an unspecified value. The checker
// reports only a read written by name in the pass; the interpreter does not
// check the other reads, and gives the value that the passes, run in order,
// give. The values below are the values of today, not a guarantee of the
// language: a target that runs the passes in parallel declines such a pass.
describe('rule 2: a read of an accumulator by another route is not checked', () => {
  /** Run `definitions`, a parallel loop whose pass computes `contribution`,
   * then `s`, in `ce`: the value of `s` after the loop. */
  function sAfterLoop(
    definitions: string,
    contribution: string,
    ce = new ComputeEngine()
  ): unknown {
    const source = `let s = 0\n${definitions}\nparallel for k in 1..3 { s += ${contribution} }`;
    // The checker cannot see these reads.
    expect(checkSource(source, undefined, { engine: ce }).diagnostics).toEqual(
      []
    );
    return executeEpsil(ce, `${source}\ns`).value.json;
  }

  // The passes add `s + k` with the `s` of the earlier passes: 1, 3, 7.
  test.each([
    ['a function of the program', 'function total() { s }', 'total() + k', 11],
    ['`parse`', '', 'parse("s") + k', 11],
    [
      'a function given to `map` through `applyWhole`',
      'function total(x) { s + x }',
      'sum(map(applyWhole, [total], [k]))',
      11,
    ],
    [
      'a function in a condition of the pass',
      'function total() { s }',
      'if total() > 1 { 1 } else { 2 }',
      4,
    ],
  ])('%s gives the value of the passes in order', (_name, definitions, contribution, expected) => {
    expect(sAfterLoop(definitions, contribution)).toEqual(expected);
  });

  test('a function that the host declares with an evaluator', () => {
    const ce = new ComputeEngine();
    ce.declare('peek', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) => engine.box(['Add', x, 's']).evaluate(),
    });
    expect(sAfterLoop('', 'peek(k)', ce)).toEqual(11);
  });

  test('a variable of the same name in another scope', () => {
    // `total` reads the variable `s` of the program, not the local `s` of
    // `f` that the loop changes.
    expect(
      run(
        'let s = 5\nfunction total() { s }\nfunction f(n) { let s = 0; parallel for k in 1..n { s += total() + k }; s }\nf(3)'
      ).value.json
    ).toEqual(21);
  });

  test('a loop that ends with an exception in a pass keeps the contributions of the earlier passes', () => {
    const ce = new ComputeEngine();
    ce.declare('boom', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        if (x.re === 2) throw new Error('boom');
        return x;
      },
    });
    const result = executeEpsil(
      ce,
      'let s = 0\nparallel for k in 1..3 { s += boom(k) }\ns + 10'
    );
    // The pass `k = 1` added 1, then the pass `k = 2` threw.
    expect(result.value.json).toEqual(11);
  });

  test('a loop that ends with an error value in a pass keeps the contributions of the earlier passes', () => {
    const result = run(
      'let s = 0\nparallel for k in 1..3 { s += k; if k == 2 { s += parse("1 +") } }\ns + 10'
    );
    expect(result.value.json).toEqual(13);
  });
});

describe('rule 2 in compiled JavaScript', () => {
  // The compiled passes run in order, as in the interpreter, so a read of an
  // accumulator that the checker does not see gives the same (unspecified)
  // value in both.
  test.each([
    [
      'a local function that reads the accumulator',
      'function g(n: integer) { let s = 0; let h = () => s; parallel for k in 1..n { s += h() + k }; s }',
      11,
    ],
    [
      'a local function that calls a local function that reads the accumulator',
      'function g(n: integer) { let s = 0; let h = () => s; function h2() { h() + 1 }; parallel for k in 1..n { s += h2() }; s }',
      7,
    ],
    [
      'a local function given to a library function',
      'function g(n: integer) { let s = 0; let h = (x) => s + x; parallel for k in 1..n { s += map(h, [k])[1] }; s }',
      11,
    ],
    [
      'a function held in a list',
      'function g(n: integer) { let s = 0; let fs = [() => s]; parallel for k in 1..n { s += fs[1]() + k }; s }',
      11,
    ],
  ])('a pass that calls %s: no diagnostic, and the interpreted value', (_name, definition, expected) => {
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    expect(checkSource(definition).diagnostics).toEqual([]);
    const result = compileEpsil(ce, 'g(m)');
    expect(result.success).toBe(true);
    expect(result.run({ m: 3 })).toBe(expected);
    expect(run(`${definition}\ng(3)`).value.json).toEqual(expected);
  });

  test('a pass that reads the accumulator with `parse`: the compilation falls back to the interpreter', () => {
    // `Parse` has no JavaScript lowering, so the compiled function is the
    // interpreter's.
    const definition =
      'function g(n: integer) { let s = 0; parallel for k in 1..n { s += parse("s") + k }; s }';
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    expect(checkSource(definition).diagnostics).toEqual([]);
    expect(() => compileEpsil(ce, 'g(m)')).toThrow(/`Parse`/);
    expect(run(`${definition}\ng(3)`).value.json).toEqual(11);
  });

  test('a call of a user function named `AddTo` is not lowered to an assignment', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'function AddTo(a, b) { a * b }\nfunction f(x: real) { let s = 2; AddTo(s, x); s }'
    );
    const result = compileEpsil(ce, 'f(x)');
    expect(result.success).toBe(true);
    expect(result.run({ x: 5 })).toBe(2);
    expect(executeEpsil(ce, 'f(5)').value.json).toEqual(2);
  });

  test.each([
    [
      'a function of the engine that reads a variable of the same name',
      'let s = 5\nfunction total() { s }\nfunction g(n: integer) { let s = 0; parallel for k in 1..n { s += total() + k }; s }',
      21,
    ],
    [
      'a local function that does not read the accumulator',
      'function g(n: integer) { let s = 0; let h = (x) => x * x; parallel for k in 1..n { s += h(k) }; s }',
      14,
    ],
  ])('a pass that calls %s compiles', (_name, definition, expected) => {
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    const result = compileEpsil(ce, 'g(m)');
    expect(result.success).toBe(true);
    expect(result.run({ m: 3 })).toBe(expected);
    expect(run(`${definition}\ng(3)`).value.json).toEqual(expected);
  });
});

describe('the constant fold of a seeded parallel loop', () => {
  // A `WithRandomSeed` frame is pure from the outside, so the JavaScript
  // target can fold a seeded expression with no inputs to a constant. The
  // fold evaluates the lowered tree, where the parallel loop is a plain
  // `Loop` over `ParallelDomain(xs)`, which has no pass frames: the fold
  // declines such a tree (`constantFoldValue()` in `compiler-core.ts`), and
  // the compiled code installs the pass frames.
  function interpretedAndCompiled(json: unknown): [number[], number[]] {
    const ce = new ComputeEngine();
    const expr = ce.box(json as never);
    const interpreted = expr.evaluate().ops!.map((x) => x.re);
    const result = compile(expr, { fallback: false } as never) as never as {
      success: boolean;
      run: () => number[];
    };
    expect(result.success).toBe(true);
    return [interpreted, result.run()];
  }

  test.each([
    [
      'a parallel loop that draws',
      ['Block', ['Random']],
      (loop: unknown) => ['Block', loop, ['Random']],
    ],
    [
      'a parallel loop with an empty body',
      ['Block', 'Nothing'],
      (loop: unknown) => ['Block', loop, ['Random']],
    ],
  ])('%s', (_, body, around) => {
    const loop = ['ParallelLoop', body, ['Element', 'k', ['Range', 1, 3]]];
    const [interpreted, compiled] = interpretedAndCompiled([
      'WithRandomSeed',
      42,
      ['Tuple', ['Random'], around(loop), ['Random']],
    ]);
    expect(interpreted).toHaveLength(3);
    expect(compiled).toHaveLength(3);
    // The loop consumes one index of the frame, so the draw after it is the
    // third draw of the frame, not the second.
    for (let i = 0; i < 3; i++)
      expect(compiled[i]).toBeCloseTo(interpreted[i], 12);
  });

  test('an element of a parallel comprehension', () => {
    const [interpreted, compiled] = interpretedAndCompiled([
      'WithRandomSeed',
      42,
      [
        'Tuple',
        ['Random'],
        [
          'At',
          [
            'ParallelComprehension',
            ['Random'],
            ['Element', 'k', ['Range', 1, 3]],
          ],
          2,
        ],
        ['Random'],
      ],
    ]);
    expect(compiled).toHaveLength(3);
    for (let i = 0; i < 3; i++)
      expect(compiled[i]).toBeCloseTo(interpreted[i], 12);
  });
});

describe('the domain, the increment and the residual of a parallel loop', () => {
  test('a lazy increment that reads no accumulator', () => {
    expect(
      run(
        'let s = [0, 0]\nparallel for k in 1..3 { s += map((x) => x * k, 1..2) }\ns'
      ).value.json
    ).toEqual(['List', 6, 12]);
  });

  test('the domain is read to the end before the first pass', () => {
    // The lazy domain reads `s` before any pass changes it, as the compiled
    // code does.
    expect(
      run(
        'let s = 0\nlet r = 0\nparallel for k in map((x) => s, 1..3) { s += 10; r += k }\n[s, r]'
      ).value.json
    ).toEqual(['List', 30, 0]);
  });

  test('a `+=` in the domain does not make its target an accumulator', () => {
    expect(
      run(
        'let s = 0\nlet r = 0\nparallel for k in do { s += 1; 1..3 } { r += s }\n[s, r]'
      ).value.json
    ).toEqual(['List', 1, 3]);
  });

  test('an unevaluated parallel comprehension keeps the value of its domain', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<real>');
    ce.declare('c', 'any');
    ce.box([
      'WithRandomSeed',
      1,
      [
        'Block',
        [
          'Assign',
          'c',
          [
            'ParallelComprehension',
            ['Multiply', 2, 'x'],
            ['Element', 'x', ['Block', ['Random'], 'xs']],
          ],
        ],
        ['Random'],
      ],
    ]).evaluate();
    // The draw of the domain is not in the residual: it is made once, and
    // not again when `c` is evaluated.
    const value = ce.box('c').value!;
    expect(value.has('Random')).toBe(false);
    expect(value.json).toEqual([
      'ParallelComprehension',
      ['Multiply', 2, 'x'],
      ['Element', 'x', 'xs'],
    ]);
  });
});
