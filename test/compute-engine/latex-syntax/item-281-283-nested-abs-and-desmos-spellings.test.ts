import { ComputeEngine } from '../../../src/compute-engine';
import { compile } from '../../../src/compute-engine/compilation/compile-expression';

/**
 * A nested absolute value must survive `serialize` → `parse`, because a
 * consumer that registers a document function through LaTeX loses the whole
 * function when the round trip lands on an error node. The parser must also
 * read back the bare `\vert\vert …` spelling, which an earlier release of the
 * serializer produced and consumers may have stored.
 *
 * The second half covers the lowercase `\operatorname{…}` spellings Desmos
 * writes for the real part, the imaginary part and the error functions.
 */

const ce = new ComputeEngine();

/** Parse `src`, serialize it, parse the result and report both readings. */
function roundTrip(src: string): {
  latex: string;
  valid: boolean;
  same: boolean;
} {
  const expr = ce.parse(src);
  const latex = expr.latex;
  const back = ce.parse(latex);
  return { latex, valid: back.isValid, same: back.isSame(expr) };
}

describe('281 nested absolute value round-trips', () => {
  const NESTED = [
    '||x|-0.5|-0.5',
    '\\left|\\left|x\\right|-0.5\\right|-0.5',
    '\\vert\\vert x\\vert-0.5\\vert-0.5',
    '|x-|y||',
    '||x||',
    '|\\,|x|\\,|',
    '\\vert\\vert x\\vert\\vert',
    '|||x|-1|-2|',
    '|\\frac{|x|}{2}|',
    '|x^{|y|}|',
  ];

  for (const src of NESTED) {
    test(`round trip: ${src}`, () => {
      const r = roundTrip(src);
      expect(r.valid).toBe(true);
      expect(r.same).toBe(true);
    });
  }

  test('the Desmos spelling parses to a nested Abs', () => {
    expect(ce.parse('\\left|\\left|x\\right|-0.5\\right|-0.5').json).toEqual([
      'Add',
      ['Abs', ['Add', ['Abs', 'x'], -0.5]],
      -0.5,
    ]);
  });

  test('a bare `\\vert\\vert` opens a nested absolute value', () => {
    expect(ce.parse('\\vert\\vert x\\vert-0.5\\vert-0.5').json).toEqual([
      'Add',
      ['Abs', ['Add', ['Abs', 'x'], -0.5]],
      -0.5,
    ]);
  });

  test('three levels of nesting', () => {
    expect(ce.parse('|||x|-1|-2|').json).toEqual([
      'Abs',
      ['Add', ['Abs', ['Add', ['Abs', 'x'], -1]], -2],
    ]);
  });

  test('an absolute value inside a fraction inside an absolute value', () => {
    expect(ce.parse('|\\frac{|x|}{2}|', { canonical: false }).json).toEqual([
      'Abs',
      ['Divide', ['Abs', 'x'], 2],
    ]);
  });

  test('thin spaces between adjacent bars are decoration', () => {
    expect(ce.parse('|\\,|x|\\,|').json).toEqual(['Abs', 'x']);
  });
});

/**
 * A vertical bar met inside a brace group opens a nested absolute value; it
 * never closes an absolute value started outside the group. A boundary with a
 * closing spelling of its own — `\end{cases}`, `\end{pmatrix}` — is not
 * ambiguous that way and must stay visible inside the group, so that an
 * unclosed group stops on it instead of consuming the rest of the input.
 */
describe('281 an unclosed brace group still stops at the enclosing boundary', () => {
  test('an unclosed group in a `cases` environment reports the environment', () => {
    expect(ce.parse('\\begin{cases}{a \\end{cases}').json).toEqual([
      'Error',
      "'unbalanced-environment'",
      ['LatexString', "'{a \\end{cases}'"],
    ]);
  });

  test('an unclosed group in a `pmatrix` environment reports the environment', () => {
    expect(ce.parse('\\begin{pmatrix}{a\\end{pmatrix}').json).toEqual([
      'Error',
      "'unbalanced-environment'",
      ['LatexString', "'{a\\end{pmatrix}'"],
    ]);
  });

  test('a nested absolute value inside an environment still parses', () => {
    expect(
      ce.parse('\\begin{cases}\\vert\\vert x\\vert-1\\vert & y\\end{cases}', {
        canonical: false,
      }).json
    ).toEqual(['Which', 'y', ['Abs', ['Subtract', ['Abs', 'x'], 1]]]);
  });
});

describe('281 serialization', () => {
  test('a plain absolute value keeps the bare `\\vert` spelling', () => {
    expect(ce.box(['Abs', 'x']).latex).toBe('\\vert x\\vert');
    expect(ce.parse('|x+1|').latex).toBe('\\vert x+1\\vert');
    expect(ce.box(['Abs', ['Divide', 'x', 2]]).latex).toBe(
      '\\vert\\frac{x}{2}\\vert'
    );
  });

  test('a body that starts with a bar gets `\\left`/`\\right`', () => {
    expect(ce.parse('||x|-0.5|').latex).toBe(
      '\\left\\vert\\vert x\\vert-0.5\\right\\vert'
    );
  });

  test('a body that ends with a bar gets `\\left`/`\\right`', () => {
    expect(ce.parse('|x-|y||').latex).toBe(
      '\\left\\vert x-\\vert y\\vert\\right\\vert'
    );
  });

  test('a bar anywhere in the body gets `\\left`/`\\right`', () => {
    expect(ce.parse('|\\frac{|x|}{2}|').latex).toBe(
      '\\left\\vert\\frac{\\vert x\\vert}{2}\\right\\vert'
    );
  });

  test('each level of a three-deep nesting is fenced', () => {
    expect(ce.parse('|||x|-1|-2|').latex).toBe(
      '\\left\\vert\\left\\vert\\vert x\\vert-1\\right\\vert-2\\right\\vert'
    );
  });

  test('a norm is not a bar the serializer has to guard against', () => {
    expect(ce.box(['Abs', ['Norm', 'v']]).latex).toBe(
      '\\vert\\left\\Vert v\\right\\Vert\\vert'
    );
  });
});

describe('281 compiled value matches the interpreter', () => {
  const cases: [string, number][] = [
    ['||x|-0.5|-0.5', 2],
    ['||x|-0.5|-0.5', -0.25],
    ['||x|-0.5|-0.5', 0],
    ['|x-|x||', -3],
  ];

  for (const [src, x] of cases) {
    test(`${src} at x = ${x}`, () => {
      const engine = new ComputeEngine();
      engine.declare('x', 'real');
      const expr = engine.parse(src);
      const r = compile(expr);
      expect(r.success).toBe(true);
      const interpreted = expr.subs({ x }).N();
      expect(r.run!({ x })).toBeCloseTo(interpreted.re, 12);
    });
  }

  test('a NaN argument gives NaN on both routes', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const expr = engine.parse('||x|-0.5|-0.5');
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(Number.isNaN(r.run!({ x: NaN }) as number)).toBe(true);
    expect(expr.subs({ x: NaN }).N().isNaN).toBe(true);
  });
});

describe('283 Desmos spellings for the complex parts and error functions', () => {
  test('`\\operatorname{real}` parses as `Real`', () => {
    expect(ce.parse('\\operatorname{real}(x)').json).toEqual(['Real', 'x']);
  });

  test('`\\operatorname{imag}` parses as `Imaginary`', () => {
    expect(ce.parse('\\operatorname{imag}(x)').json).toEqual([
      'Imaginary',
      'x',
    ]);
  });

  test('`\\operatorname{erf}` parses as `Erf`', () => {
    expect(ce.parse('\\operatorname{erf}(x)').json).toEqual(['Erf', 'x']);
  });

  test('`\\operatorname{erfc}` parses as `Erfc`', () => {
    expect(ce.parse('\\operatorname{erfc}(x)').json).toEqual(['Erfc', 'x']);
  });

  test('the capitalized spellings are unchanged', () => {
    expect(ce.parse('\\operatorname{Re}(x)').json).toEqual(['Real', 'x']);
    expect(ce.parse('\\operatorname{Im}(x)').json).toEqual(['Imaginary', 'x']);
    expect(ce.parse('\\operatorname{Erf}(x)').json).toEqual(['Erf', 'x']);
    expect(ce.parse('\\operatorname{Erfc}(x)').json).toEqual(['Erfc', 'x']);
  });

  test('the aliases are parse-only: serialization is unchanged', () => {
    expect(ce.box(['Real', 'x']).latex).toBe('\\Re(x)');
    expect(ce.box(['Imaginary', 'x']).latex).toBe('\\Im(x)');
    expect(ce.box(['Erf', 1]).latex).toBe('\\mathrm{Erf}(1)');
    expect(ce.box(['Erfc', 1]).latex).toBe('\\mathrm{Erfc}(1)');
  });

  test('a declared symbol of the same name does not shadow the alias', () => {
    // This mirrors the existing `\operatorname{tr}` alias: a dictionary entry
    // wins over a symbol the user declared under the same name.
    const engine = new ComputeEngine();
    engine.declare('real', 'real');
    engine.assign('real', 7);
    engine.declare('erf', 'real');
    engine.assign('erf', 9);
    expect(engine.parse('\\operatorname{real}(x)').json).toEqual(['Real', 'x']);
    expect(engine.parse('\\operatorname{erf}(x)').json).toEqual(['Erf', 'x']);
    expect(engine.parse('\\operatorname{tr}(x)').json).toEqual(['Trace', 'x']);
  });

  test('`erf` and `erfc` evaluate and compile to the interpreted value', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    for (const [src, head] of [
      ['\\operatorname{erf}(x)', 'Erf'],
      ['\\operatorname{erfc}(x)', 'Erfc'],
    ] as const) {
      const expr = engine.parse(src);
      const r = compile(expr);
      expect(r.success).toBe(true);
      for (const x of [0, 0.5, 1, -2]) {
        const interpreted = engine.box([head, x]).N();
        expect(r.run!({ x })).toBeCloseTo(interpreted.re, 12);
      }
    }
  });

  test('`real` and `imag` evaluate like `Re` and `Im`', () => {
    expect(
      ce.parse('\\operatorname{real}(3+4\\imaginaryI)').evaluate().re
    ).toBe(3);
    expect(
      ce.parse('\\operatorname{imag}(3+4\\imaginaryI)').evaluate().re
    ).toBe(4);
  });
});

describe('Desmos spelling for the complex conjugate', () => {
  test('`\\operatorname{conj}` parses as `Conjugate`', () => {
    expect(ce.parse('\\operatorname{conj}(z)').json).toEqual([
      'Conjugate',
      'z',
    ]);
    expect(ce.parse('\\mathrm{conj}(z)').json).toEqual(['Conjugate', 'z']);
  });

  test('a power or a sign applies to the call, not to the argument', () => {
    // Without the dictionary entry `conj` was an undeclared symbol and
    // `\operatorname{conj}(z)^2` was the product `conj * z^2`.
    expect(ce.parse('\\operatorname{conj}(z)^2').json).toEqual([
      'Power',
      ['Conjugate', 'z'],
      2,
    ]);
    expect(ce.parse('-\\operatorname{conj}(z)').json).toEqual([
      'Negate',
      ['Conjugate', 'z'],
    ]);
    expect(ce.parse('2\\operatorname{conj}(z)').json).toEqual([
      'Multiply',
      2,
      ['Conjugate', 'z'],
    ]);
  });

  test('the alias is parse-only: serialization is unchanged', () => {
    expect(ce.box(['Conjugate', 'z']).latex).toBe('z^\\star');
  });

  test('`conj` evaluates like `Conjugate`, and broadcasts over a list', () => {
    const v = ce.parse('\\operatorname{conj}(3+4\\imaginaryI)').evaluate();
    expect([v.re, v.im]).toEqual([3, -4]);
    expect(
      ce.parse('\\operatorname{conj}([1+\\imaginaryI, 2])').evaluate().json
    ).toEqual(['List', ['Complex', 1, -1], 2]);
  });

  test('a piecewise over a list condition that holds `conj` selects per element', () => {
    // With `conj` unknown, `conj(L)` stayed symbolic inside every cell of the
    // condition, no cell could be decided, and the piecewise stayed a symbolic
    // `Which` that held one copy of the list per element.
    const engine = new ComputeEngine();
    engine.declare('L', 'unknown');
    engine.assign(
      'L',
      engine.box(['List', ['Complex', 1, 1], 0, ['Complex', 0, 2]])
    );
    const v = engine
      .parse(
        '\\begin{cases} 1 & |\\operatorname{conj}(L)| > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'
      )
      .evaluate();
    expect(v.json).toEqual(['List', 1, 0, 1]);
  });
});

describe('A square of a base that ends with a superscript', () => {
  test('the base is braced, so the LaTeX has no double superscript', () => {
    expect(ce.parse('\\operatorname{conj}(z)^2').latex).toBe('{z^\\star}^2');
    expect(ce.box(['Power', ['Transpose', 'A'], 2]).latex).toBe('{A^T}^2');
    expect(ce.box(['Square', ['Prime', 'f']], { form: 'raw' }).latex).toBe(
      '{f^{\\prime}}^2'
    );
  });

  test('a superscript followed by a subscript is braced too', () => {
    // The symbol `x__2_1` serializes as `x^2_1`: both scripts attach to `x`,
    // so a second superscript after the subscript is still a double one.
    expect(ce.box(['Power', 'x__2_1', 2]).latex).toBe('{x^2_1}^2');
  });

  test('a superscript inside a delimiter or a group adds no brace', () => {
    expect(ce.parse('(x^2+1)^2').latex).toBe('(x^2+1)^2');
    expect(
      ce.box(['Square', ['Sqrt', ['Power', 'x', 3]]], { form: 'raw' }).latex
    ).toBe('\\sqrt{x^3}^2');
  });

  test('a base with no superscript adds no brace', () => {
    expect(ce.parse('(n!)^2').latex).toBe('n!^2');
    expect(ce.parse('x_1^2').latex).toBe('x_1^2');
  });

  test('the braced form parses back to the same expression', () => {
    const expr = ce.box(['Power', ['Transpose', 'A'], 2]);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });
});
