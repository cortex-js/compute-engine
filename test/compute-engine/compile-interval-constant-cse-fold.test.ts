/**
 * A common subexpression whose value is a constant interval is not bound to
 * a temporary on the `interval-js` target: each occurrence is written as the
 * constant, so the emitted-code fold (`foldConstantIntervalCode`) also folds
 * the expressions that read it, and the constant table gives each distinct
 * value one `_k` name.
 *
 * The case that showed the defect is the body of a user function with an
 * unrolled `Sum`. The index of each unrolled term is replaced by a literal
 * when the term is emitted, so `(n − 0.5)/40` is a candidate of the term's
 * region and its right-hand side folds to a constant. Bound to a temporary,
 * that constant was a name the fold cannot see through, and
 * `√(1 − ((n − 0.5)/40)²)` was computed on every call of the function (the
 * exoplanet transit kernel of the Tycho consumer has 40 such terms, so 40
 * interval square roots of constants per call). The JavaScript target folded
 * the same body completely.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type IntervalRun = {
  success: boolean;
  code: string;
  preamble?: string;
  run: (arg: unknown) => unknown;
};

const S_DEF =
  '(a, c) \\mapsto 2\\arccos(\\max(-1, \\min(1, \\frac{a^2 r^2 - c^2}{2 a r c})))';
const B_DEF =
  '(c, k) \\mapsto \\sum_{n=1}^{3} \\frac{n-0.5}{40}\\left(1 - k\\left(1-\\sqrt{1-\\left(\\frac{n-0.5}{40}\\right)^2}\\right)\\right) S\\left(\\frac{n-0.5}{40}, c\\right)';

function makeEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const n of ['x', 'j', 'r']) ce.declare(n, 'real');
  ce.assign('S', ce.parse(S_DEF));
  ce.assign('B', ce.parse(B_DEF));
  return ce;
}

function compileInterval(
  ce: ComputeEngine,
  latex: string,
  options: Record<string, unknown> = {}
): IntervalRun {
  const r = compile(ce.parse(latex), {
    to: 'interval-js',
    fallback: false,
    ...options,
  }) as IntervalRun;
  if (!r.success) throw new Error(`compile failed: ${latex}`);
  return r;
}

/** The source of the emitted definition `const <name> = …;`. */
function definition(preamble: string, name: string): string {
  const line = preamble
    .split('\n')
    .find((l) => l.startsWith(`const ${name} = `));
  if (line === undefined) throw new Error(`no definition of ${name}`);
  return line;
}

describe('INTERVAL CSE: A CONSTANT COMMON SUBEXPRESSION IS FOLDED', () => {
  test('the body of a user function with an unrolled Sum folds its constants', () => {
    const ce = makeEngine();
    const r = compileInterval(ce, '1 - B(x, j)');
    const body = definition(r.preamble ?? '', '_fn_B');
    // No temporary, and no run-time computation over constants only.
    expect(body).not.toContain('_cse');
    expect(body).not.toContain('_IA.sqrt(');
    expect(body).not.toContain('_IA.square(');
    // Each term reads the folded constants by their table names.
    expect(body).toMatch(
      /^const _fn_B = \(c, k\) => _IA\.add\(_IA\.scaleDiv\(_IA\.mul\(_IA\.scale\(_k\d+, _IA\.sub\(_k\d+, _IA\.mul\(k, _k\d+\)\)\), _fn_S\(_k\d+, c\)\), _k\d+\), /
    );
    expect(body.match(/_fn_S\(_k\d+, c\)/g)?.length).toBe(3);
  });

  test('the constant table holds an enclosure of each folded value', () => {
    const ce = makeEngine();
    const r = compileInterval(ce, '1 - B(x, j)');
    const preamble = r.preamble ?? '';
    const enclosures = [
      ...preamble.matchAll(
        /const _k\d+ = \{ kind: 'interval', value: \{ lo: ([^,]+), hi: ([^ ]+) \} \};/g
      ),
    ].map((m) => [Number(m[1]), Number(m[2])]);
    for (const n of [1, 2, 3]) {
      const t = (n - 0.5) / 40;
      // `t` itself, and `1 − √(1 − t²)`. The double expressions are close to
      // the real values but are not the real values, so each is required to
      // fall inside an enclosure that is at most a few ulps wide.
      for (const v of [t, 1 - Math.sqrt(1 - t * t)]) {
        const hit = enclosures.find(
          ([lo, hi]) => lo <= v && v <= hi && hi - lo <= 8 * Number.EPSILON
        );
        expect(hit).toBeDefined();
      }
    }
  });

  test('the emission is the one compiled with CSE turned off', () => {
    // With CSE off nothing is bound, and every constant subtree folds. A
    // constant common subexpression must give the same code.
    const ce = makeEngine();
    const withCse = compileInterval(ce, '1 - B(x, j)');
    const withoutCse = compileInterval(ce, '1 - B(x, j)', { cse: false });
    expect(withCse.preamble).toBe(withoutCse.preamble);
    expect(withCse.code).toBe(withoutCse.code);
  });

  test('the same sum at the root folds the same way', () => {
    const ce = makeEngine();
    const r = compileInterval(
      ce,
      '1 - \\sum_{n=1}^{3} \\frac{n-0.5}{40}\\left(1 - j\\left(1-\\sqrt{1-\\left(\\frac{n-0.5}{40}\\right)^2}\\right)\\right) S\\left(\\frac{n-0.5}{40}, x\\right)'
    );
    expect(r.code).not.toContain('_cse');
    expect(r.code).not.toContain('_IA.sqrt(');
    expect(r.code).not.toContain('_IA.square(');
  });

  test('the compiled value encloses the value of the expression', () => {
    const ce = makeEngine();
    const r = compileInterval(ce, '1 - B(x, j)');
    const points = [
      { x: 0.3, j: 0.5, r: 10 },
      { x: 0.2, j: 0.8, r: 8 },
    ];
    for (const p of points) {
      const out = r.run(p) as {
        kind: string;
        value: { lo: number; hi: number };
      };
      expect(out.kind).toBe('interval');
      // The reference value comes from a separate engine, so that assigning
      // `x`, `j` and `r` does not change the engine the code was compiled by.
      const ref = makeEngine();
      ref.assign('x', p.x);
      ref.assign('j', p.j);
      ref.assign('r', p.r);
      const n = ref.parse('1 - B(x, j)').N().re;
      expect(Number.isFinite(n)).toBe(true);
      expect(out.value.lo).toBeLessThanOrEqual(n);
      expect(n).toBeLessThanOrEqual(out.value.hi);
      expect(out.value.hi - out.value.lo).toBeLessThanOrEqual(
        16 * Number.EPSILON
      );
    }
  });

  test('a common subexpression that reads a parameter is still bound', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign(
      'F',
      ce.parse(
        '(c) \\mapsto \\sum_{n=1}^{3} \\left(\\sin\\left(\\frac{n+c}{4}\\right) + \\cos\\left(\\frac{n+c}{4}\\right) + \\left(\\frac{n+c}{4}\\right)^3\\right)'
      )
    );
    const r = compileInterval(ce, 'F(x)');
    const body = definition(r.preamble ?? '', '_fn_F');
    // One temporary per unrolled term, each reading the parameter `c`.
    expect(body.match(/const _cse\d+ = _IA\.[a-z]+\([^;]*\bc\b/g)?.length).toBe(
      3
    );
  });

  test('a caller-mapped vars source is not folded', () => {
    // `s` is the caller's live binding: the `vars` contract says it is never
    // folded, even when its source is spelled in this target's own dialect.
    // So `(n − s)/40` and the square root over it stay run-time computations
    // in each term, as they are with CSE turned off.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('s', 'real');
    const latex =
      '\\sum_{n=1}^{3} \\frac{n-s}{40}\\left(1 - x\\left(1-\\sqrt{1-\\left(\\frac{n-s}{40}\\right)^2}\\right)\\right)';
    const vars = { s: '_IA.point(0.5)' };
    const mapped = compileInterval(ce, latex, { vars });
    const reference = compileInterval(ce, latex, { vars, cse: false });
    expect(mapped.code.split('_IA.sqrt(').length - 1).toBe(3);
    expect(mapped.code).toBe(reference.code);
    expect(mapped.preamble).toBe(reference.preamble);
  });
});
