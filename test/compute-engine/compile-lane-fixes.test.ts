import { ComputeEngine, compile } from '../../src/compute-engine';

// The JavaScript target chooses the real or the complex lane of a
// linear-algebra head (`Determinant`, `Inverse`, …) and of a user-function
// call from what the compiler can prove about the operands. These tests pin
// four cases where that choice went wrong: a matrix written with a `Matrix`
// head, a recursive user function whose lane is only known once its body is
// compiled, a mutually recursive pair, and the diagnostic of a wide operand
// (now the run-time entry check of the symbol it comes from).

const MODES = ['strict', 'auto', 'complex'] as const;

function js(expr: any, mode: string): any {
  return compile(expr, { to: 'javascript', mode, fallback: false } as any);
}

/** The value `v` as `[re, im]`: a number or a `{re, im}` object. */
function parts(v: any): [number, number] {
  if (typeof v === 'number') return [v, 0];
  return [v.re, v.im];
}

function expectValue(actual: any, expected: [number, number]): void {
  const [re, im] = parts(actual);
  expect(re).toBeCloseTo(expected[0], 9);
  expect(im).toBeCloseTo(expected[1], 9);
}

describe('A MATRIX WITH A `Matrix` HEAD HAS THE LANE OF ITS ENTRIES', () => {
  // `\begin{pmatrix}…\end{pmatrix}` parses to `Matrix(List(List(…), …))`.
  // The lane analysis read the entries of a `List` only, so the same matrix
  // written with a `Matrix` head was wide (`matrix<2x2>`) and failed closed in
  // `strict` and `auto`, while the `List` spelling compiled.
  const PMATRIX = '\\begin{pmatrix}x&1\\\\1&x\\end{pmatrix}';
  const CASES: Array<[string, string, any]> = [
    ['determinant', `\\det${PMATRIX}`, 8],
    [
      'inverse',
      `${PMATRIX}^{-1}`,
      [
        [0.375, -0.125],
        [-0.125, 0.375],
      ],
    ],
    ['trace', `\\operatorname{Trace}(${PMATRIX})`, 6],
    ['trace, \\tr', `\\tr${PMATRIX}`, 6],
    [
      'bmatrix inverse',
      '\\begin{bmatrix}x&1\\\\1&x\\end{bmatrix}^{-1}',
      [
        [0.375, -0.125],
        [-0.125, 0.375],
      ],
    ],
    ['vmatrix', '\\begin{vmatrix}x&1\\\\1&x\\end{vmatrix}', 8],
  ];
  for (const [label, latex, expected] of CASES) {
    for (const mode of MODES) {
      it(`${label}, ${mode}: ${latex} at x = 3`, () => {
        const ce = new ComputeEngine();
        const result = js(ce.parse(latex), mode);
        expect(result.run({ x: 3 })).toEqual(expected);
      });
    }
  }

  const L = [
    ['List', 'x', 1],
    ['List', 1, 'x'],
  ];
  const HEADS: Array<[string, (m: any) => any]> = [
    ['Determinant', (m) => ['Determinant', m]],
    ['Inverse', (m) => ['Inverse', m]],
    ['Trace', (m) => ['Trace', m]],
    ['MatrixPower', (m) => ['MatrixPower', m, 2]],
    ['MatrixMultiply', (m) => ['MatrixMultiply', m, m]],
    ['RowReduce', (m) => ['RowReduce', m]],
  ];
  for (const [head, build] of HEADS) {
    for (const mode of MODES) {
      it(`${head}, ${mode}: the Matrix and the List spelling agree`, () => {
        const ce = new ComputeEngine();
        const run = (json: any): any => {
          try {
            return { value: js(ce.box(json), mode).run({ x: 3 }) };
          } catch (e) {
            return { error: (e as Error).message };
          }
        };
        const viaList = run(build(['List', ...L]));
        const viaMatrix = run(build(['Matrix', ['List', ...L]]));
        expect(viaMatrix).toEqual(viaList);
        // Only `RowReduce` under `mode: 'complex'` declines: that mode reads
        // the undeclared `x` as complex, and the interpreter has no row
        // echelon form of a complex matrix.
        if (!(head === 'RowReduce' && mode === 'complex'))
          expect(viaMatrix.error).toBeUndefined();
      });
    }
  }

  it('RowReduce of a pmatrix compiles in auto', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(`\\operatorname{RowReduce}(${PMATRIX})`);
    expect(js(expr, 'auto').run({ x: 3 })).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('Matrix(A) with a declared matrix<real> is real', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix<real>');
    const result = js(ce.box(['Determinant', ['Matrix', 'A']]), 'strict');
    expect(
      result.run({
        A: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toBe(-2);
  });
});

describe('A RECURSIVE CALL HAS THE LANE OF THE BODY OF ITS DEFINITION', () => {
  // While a definition compiles, the lane of its own recursive calls is not
  // known yet, and is assumed from the type of the call. With
  // `f: (integer) -> number`, the call types `number`, which strict and auto
  // read as real. The body `n·f(n − 1)` is then complex (the base case is
  // `i`), and the compilation failed closed in every mode. The definition is
  // now compiled a second time with the recursive calls read as complex.
  const CASES_F = '\\begin{cases} i & n = 0 \\\\ n f(n-1) & \\end{cases}';

  for (const mode of MODES) {
    it(`complex base case, (integer) -> number, ${mode}`, () => {
      const ce = new ComputeEngine();
      ce.declare('f', '(integer) -> number');
      ce.assign('f', ce.parse(`n \\mapsto ${CASES_F}`));
      const expr = ce.parse('f(3)+1');
      expect(expr.evaluate().toString()).toBe('(1 + 6i)');
      expectValue(js(expr, mode).run({}), [1, 6]);
    });

    it(`complex base case, (integer) -> complex, ${mode}`, () => {
      const ce = new ComputeEngine();
      ce.declare('f', '(integer) -> complex');
      ce.assign('f', ce.parse(`n \\mapsto ${CASES_F}`));
      expectValue(js(ce.parse('f(3)+1'), mode).run({}), [1, 6]);
    });

    it(`real base case, ${mode}`, () => {
      const ce = new ComputeEngine();
      ce.declare('f', '(integer) -> number');
      ce.assign(
        'f',
        ce.parse(
          'n \\mapsto \\begin{cases} 1 & n = 0 \\\\ n f(n-1) & \\end{cases}'
        )
      );
      const result = js(ce.parse('f(3)+1'), mode);
      expectValue(result.run({}), [7, 0]);
      // Outside `mode: 'complex'` the definition stays on the real lane.
      if (mode !== 'complex') expect(result.run({})).toBe(7);
    });

    it(`mutually recursive pair with a complex base case, ${mode}`, () => {
      // g(n) = 2·h(n − 1), h(n) = 3·g(n − 1), g(0) = i, h(0) = 1 + i.
      // g(3) = 2·3·2·h(0) = 12 + 12i, so g(3) + 1 = 13 + 12i.
      const ce = new ComputeEngine();
      ce.declare('g', '(integer) -> number');
      ce.declare('h', '(integer) -> number');
      ce.assign(
        'g',
        ce.parse(
          'n \\mapsto \\begin{cases} i & n = 0 \\\\ 2 h(n-1) & \\end{cases}'
        )
      );
      ce.assign(
        'h',
        ce.parse(
          'n \\mapsto \\begin{cases} 1+i & n = 0 \\\\ 3 g(n-1) & \\end{cases}'
        )
      );
      const expr = ce.parse('g(3)+1');
      expect(expr.evaluate().toString()).toBe('(13 + 12i)');
      const result = js(expr, mode);
      // The definition of `g` is emitted, not inlined around a definition
      // of `h` that calls a `_fn_g` that does not exist.
      expectValue(result.run({}), [13, 12]);
    });
  }
});

// A wide operand (`matrix<number>`, `vector<number>`) is read as real in
// `strict` and `auto` mode (user decision of 2026-09-24, option B). Before,
// the compilation failed closed and its diagnostic named the symbol to
// declare. Now the compiled runner checks the entries of the symbol when it
// is called, and its diagnostic names the symbol, its declared type, and the
// complex entry, also when the operand is computed from the symbol.
describe('THE ENTRY CHECK OF A WIDE OPERAND NAMES WHAT TO DECLARE', () => {
  function entryError(
    decl: Record<string, string>,
    json: any,
    vars: Record<string, unknown>
  ): string {
    const ce = new ComputeEngine();
    for (const [k, v] of Object.entries(decl)) ce.declare(k, v);
    const result = js(ce.box(json), 'strict');
    expect(result.success).toBe(true);
    try {
      result.run(vars);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('expected the entry check to throw');
  }
  const M = [
    [1, 2],
    [{ re: 0, im: 1 }, 4],
  ];

  it('a symbol: its type as declared', () => {
    const msg = entryError({ M: 'matrix<number>' }, ['Determinant', 'M'], {
      M,
    });
    expect(msg).toContain(
      '"M" (type `matrix<number>`) was compiled with real entries, but its entry [1][0] is a complex {re, im} value'
    );
    expect(msg).toContain("compile with `mode: 'complex'`");
  });

  it('a computed operand: the symbol it comes from', () => {
    const msg = entryError(
      { M: 'matrix<number>' },
      ['Determinant', ['Transpose', 'M']],
      { M }
    );
    expect(msg).toContain('"M" (type `matrix<number>`)');
  });

  it('a computed vector operand', () => {
    const msg = entryError(
      { u: 'vector<number>' },
      ['Dot', ['Reverse', 'u'], 'u'],
      { u: [1, { re: 2, im: 1 }, 3] }
    );
    expect(msg).toMatch(/"u" \(type `vector<number>`\).*entry \[1\]/);
  });
});

describe('A SHAPE-PRESERVING HEAD KEEPS A REAL LANE', () => {
  // `Reverse`, `Sort`, `Take`, `Drop`, `Flatten` and `Transpose` of a
  // real-typed operand keep the real lane: the head only moves the entries.
  const HEADS: Array<[string, any, number]> = [
    ['Reverse', ['Reverse', 'u'], 10],
    ['Sort', ['Sort', 'u'], 14],
    ['Flatten', ['Flatten', 'u'], 14],
    ['Take', ['Take', 'u', 3], 14],
    ['Drop', ['Drop', 'u', 0], 14],
  ];
  for (const [label, operand, expected] of HEADS) {
    for (const mode of ['strict', 'auto']) {
      it(`Dot(${label}(u), u), ${mode}`, () => {
        const ce = new ComputeEngine();
        ce.declare('u', 'vector<real>');
        const result = js(ce.box(['Dot', operand, 'u']), mode);
        expect(result.run({ u: [1, 2, 3] })).toBe(expected);
      });
    }
  }
});

describe('A MUTUALLY RECURSIVE PAIR WHOSE BODY HAS NO LOWERING FAILS CLOSED', () => {
  // `g` calls `h` and `Simplify`, which has no compiled form; `h` calls `g`.
  // While `g` compiles, the call of `g` inside `h` is answered by name (a
  // re-entrant reference), so `h` was stored with a call of `_fn_g`, and
  // when the emission of `g` then failed, `h` kept that call: `h(2)` ran to
  // `ReferenceError: _fn_g is not defined`, and asking the lane of the pair
  // inlined the two bodies into each other without end. The definitions
  // stored during a failed emission are now removed, and the lane question
  // guards the inlining like the code generation does: every spelling fails
  // closed, and the interpreter answers through the fallback.
  function pair(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(integer) -> number' });
    ce.declare('h', { signature: '(integer) -> number' });
    ce.assign(
      'g',
      ce.parse(
        'n \\mapsto \\operatorname{If}(n = 0, 1, 2 h(n-1) + \\operatorname{Simplify}(n))'
      )
    );
    ce.assign(
      'h',
      ce.parse('n \\mapsto \\operatorname{If}(n = 0, 1, 3 g(n-1))')
    );
    return ce;
  }

  for (const latex of ['g(2) + h(2)', 'h(2)', 'g(2)']) {
    test(`${latex} fails closed and the fallback answers`, () => {
      const ce = pair();
      expect(() =>
        compile(ce.parse(latex), { to: 'javascript', fallback: false })
      ).toThrow(/cannot compile|Cannot compile/);
      const r = compile(ce.parse(latex), { to: 'javascript' }) as any;
      expect(r.success).toBe(false);
      expect(r.run({})).toBe(ce.parse(latex).evaluate().re);
    });
  }

  test('a mutually recursive pair that compiles keeps every definition', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(integer) -> number' });
    ce.declare('h', { signature: '(integer) -> number' });
    ce.assign(
      'g',
      ce.parse('n \\mapsto \\operatorname{If}(n = 0, 1, 2 h(n-1) + n)')
    );
    ce.assign(
      'h',
      ce.parse('n \\mapsto \\operatorname{If}(n = 0, 1, 3 g(n-1))')
    );
    const r = compile(ce.parse('g(2) + h(2)'), {
      to: 'javascript',
      fallback: false,
    }) as any;
    expect(r.success).toBe(true);
    expect(r.run({})).toBe(ce.parse('g(2) + h(2)').evaluate().re);
  });
});
