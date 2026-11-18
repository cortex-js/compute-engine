import { ComputeEngine, compile } from '../../src/compute-engine';

// The JavaScript target chooses the real or the complex lane of a
// linear-algebra head (`Determinant`, `Inverse`, …) and of a user-function
// call from what the compiler can prove about the operands. These tests pin
// four cases where that choice went wrong: a matrix written with a `Matrix`
// head, a recursive user function whose lane is only known once its body is
// compiled, a mutually recursive pair, and a wide operand, which is read as
// real.

const MODES = ['strict', 'complex'] as const;

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

describe('A RECURSIVE CALL HAS THE LANE OF THE BODY OF ITS DEFINITION', () => {
  // While a definition compiles, the lane of its own recursive calls is not
  // known yet, and is assumed from the type of the call. With
  // `f: (integer) -> number`, the call types `number`, which strict reads as
  // real. The body `n·f(n − 1)` is then complex (the base case is
  // `i`), and the compilation failed closed in every mode. The definition is
  // now compiled a second time with the recursive calls read as complex.
  const CASES_F = '\\begin{cases} i & n = 0 \\\\ n f(n-1) & \\end{cases}';

  for (const mode of MODES) {

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
      ).toThrow(/Could not compile/);
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
