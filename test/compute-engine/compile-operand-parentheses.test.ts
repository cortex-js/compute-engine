import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import {
  closingBracket,
  isPrimaryCode,
  operandCode,
} from '../../src/compute-engine/compilation/code-primary';

// The code of a head with no infix spelling on the target (a handler, a
// selection whose condition has a constant type, a type ascription) is written
// in parentheses when it is the operand of an operator, unless it is a
// primary. Before, it was spliced bare: `2 / Haversine(x)` gave
// `2 / (1 - Math.cos(x)) / 2`, a quarter of the value (CE-1196), and
// `2·If(2 < 3, x + 1, 0)` gave `2 * _.x + 1` (CE-1224).

function newEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  return ce;
}

type Json = any;

/** The compiled values of `json` against the interpreter at `points`. */
function expectInterpreterValues(
  ce: ComputeEngine,
  json: Json,
  points: Record<string, number>[],
  options: Record<string, unknown> = {}
): void {
  const e = ce.box(json);
  const r = compile(e, { fallback: false, ...options });
  expect(r.success).toBe(true);
  for (const p of points) {
    const want = e.subs(p).N();
    const got = r.run!(p);
    if (typeof got === 'boolean') expect(got).toBe(want.symbol === 'True');
    else expect(got as number).toBeCloseTo(want.re!, 12);
  }
}

/** The same for a function literal `(params) => body`, called with `args`. */
function expectFunctionValues(
  ce: ComputeEngine,
  body: Json,
  params: string[],
  calls: number[][]
): void {
  const fn = ['Function', body, ...params];
  const r = compile(ce.box(fn), { fallback: false });
  expect(r.success).toBe(true);
  for (const args of calls) {
    const want = ce.box(['Apply', fn, ...args]).N();
    const got = (r.run as any)(...args);
    if (typeof got === 'boolean') expect(got).toBe(want.symbol === 'True');
    else expect(got as number).toBeCloseTo(want.re!, 12);
  }
}

const codeOf = (ce: ComputeEngine, json: Json, options = {}) =>
  compile(ce.box(json), { fallback: false, ...options }).code;

/** The operand positions of `h`: each operator around it. */
const positions = (h: Json): Json[] => [
  ['Negate', h],
  ['Multiply', 2, h],
  ['Subtract', 3, h],
  ['Divide', 2, h],
  ['Divide', h, ['Add', 'y', 5]],
  ['Power', h, 2],
  ['Power', 2, h],
  ['Less', ['Multiply', 2, h], 1],
];

const points = [
  { x: 0.7, y: 0.3 },
  { x: -1.2, y: 2.5 },
  { x: 2.25, y: -0.5 },
];

describe('CE-1196: a handler that writes infix code', () => {
  const ce = newEngine();

  test('the witnesses', () => {
    const fn = ce.box(['Function', ['Divide', 2, ['Haversine', 'x']], 'x']);
    const r = compile(fn, { fallback: false });
    expect(r.code).toBe('(x) => 2 / ((1 - Math.cos(x)) / 2)');
    expect((r.run as any)(1)).toBeCloseTo(8.701370598680086, 12);

    expect(codeOf(ce, ['Divide', 2, ['Sech', 'x']])).toBe(
      '2 / (1 / Math.cosh(_.x))'
    );
    expectInterpreterValues(ce, ['Divide', 2, ['Sech', 'x']], [{ x: 1 }]);
    expect(codeOf(ce, ['Divide', 2, ['Csch', 'x']])).toBe(
      '2 / (1 / Math.sinh(_.x))'
    );
    expectInterpreterValues(ce, ['Divide', 2, ['Csch', 'x']], [{ x: 1 }]);

    const fract = ce.box(['Function', ['Multiply', ['Fract', 'b'], 2], 'b']);
    const f = compile(fract, { fallback: false });
    expect(f.code).toBe('(b) => 2 * (b - Math.floor(b))');
    expect((f.run as any)(7.25)).toBe(0.5);
  });

  // The heads whose handler writes code with an operator at its top level,
  // found by compiling every head of the function tables in each position
  // (2026-11-16): `Haversine` and `Fract` write a template (bare when the
  // operand is a parameter name), `Sech` and `Csch` a quotient,
  // `HarmonicNumber` a sum.
  for (const head of ['Haversine', 'Fract', 'Sech', 'Csch', 'HarmonicNumber'])
    test(`${head} in every operand position`, () => {
      for (const json of positions([head, 'x'])) {
        // `HarmonicNumber` is real for `x > -1` only.
        const at = head === 'HarmonicNumber' ? [points[0], points[2]] : points;
        expectInterpreterValues(ce, json, at);
        expectFunctionValues(
          ce,
          json,
          ['x', 'y'],
          at.map((p) => [p.x, p.y])
        );
      }
    });

  test('a call needs no parentheses', () => {
    // The handler of `Cot` writes a call of the runtime: no change.
    expect(codeOf(ce, ['Divide', 2, ['Cot', 'x']])).toBe(
      '2 / _SYS.cot(_.x)'
    );
    expect(codeOf(ce, ['Multiply', 2, ['Sin', 'x']])).toBe(
      '2 * Math.sin(_.x)'
    );
  });

  test('the GLSL target', () => {
    const glsl = (json: Json) => new GLSLTarget().compile(ce.box(json)).code;
    expect(glsl(['Divide', 2, ['HarmonicNumber', 'x']])).toBe(
      '2.0 / (_gpu_digamma(x + 1.0) + 0.57721566490)'
    );
    expect(glsl(['Negate', ['HarmonicNumber', 'x']])).toBe(
      '-(_gpu_digamma(x + 1.0) + 0.57721566490)'
    );
  });
});

describe('CE-1224: the selected branch of an `If` with a constant condition', () => {
  const ce = newEngine();
  const raw = { cse: false, constantFold: false };

  test('the witnesses', () => {
    const cases: [Json, string, Record<string, number>][] = [
      [
        ['Multiply', 2, ['If', ['Less', 2, 3], ['Add', 'x', 1], 0]],
        '2 * (_.x + 1)',
        { x: 1 },
      ],
      [
        ['Negate', ['If', ['Less', 2, 3], ['Add', 'x', 1], 0]],
        '-(_.x + 1)',
        { x: 1 },
      ],
      [
        ['Divide', 1, ['If', ['Less', 2, 3], ['Multiply', 2, 'x'], 0]],
        '1 / (2 * _.x)',
        { x: 2 },
      ],
      [
        ['Multiply', 'Pi', ['If', ['Less', 1, -0.25], 3, ['Subtract', 'x', 5]]],
        'Math.PI * (_.x + -5)',
        { x: 1 },
      ],
    ];
    for (const [json, code, p] of cases) {
      expect(codeOf(ce, json, raw)).toBe(code);
      expectInterpreterValues(ce, json, [p], raw);
      expectInterpreterValues(ce, json, [p]);
    }
  });

  test('in every operand position', () => {
    for (const json of positions([
      'If',
      ['Less', 2, 3],
      ['Add', 'x', 1],
      0,
    ])) {
      expectInterpreterValues(ce, json, points, raw);
      expectInterpreterValues(ce, json, points);
    }
  });

  test('a selected branch that is a primary has no parentheses', () => {
    expect(
      codeOf(
        ce,
        ['Multiply', 2, ['If', ['Less', 2, 3], ['Sin', 'x'], 0]],
        raw
      )
    ).toBe('2 * Math.sin(_.x)');
  });
});

describe("a type ascription: `2·Typed(x + 1, 'real')`", () => {
  const ce = newEngine();
  const typed = ['Typed', ['Add', 'x', 1], "'real'"];

  test('the witness', () => {
    expect(codeOf(ce, ['Multiply', 2, typed])).toBe('2 * (_.x + 1)');
  });

  test('in every operand position', () => {
    for (const json of positions(typed))
      expectInterpreterValues(ce, json, points);
  });
});

describe('the compile handler of a user operator', () => {
  const ce = newEngine();
  ce.declare('Inc', {
    signature: '(real) -> real',
    evaluate: ([a]) => a.add(1),
    compile: (args, compile) => `${compile(args[0])} + 1`,
  } as any);

  test('its code is an operand', () => {
    expect(codeOf(ce, ['Multiply', 2, ['Inc', 'x']])).toBe('2 * (_.x + 1)');
    for (const json of positions(['Inc', 'x']))
      expectInterpreterValues(ce, json, points);
  });

  test('a code that ends with a line comment keeps its closing parenthesis', () => {
    const ce = newEngine();
    ce.declare('Inc', {
      signature: '(real) -> real',
      evaluate: ([a]) => a.add(1),
      compile: (args, compile) => `${compile(args[0])} + 1 // note`,
    } as any);
    expect(codeOf(ce, ['Multiply', 2, ['Inc', 'x']])).toBe(
      '2 * (_.x + 1 // note\n)'
    );
    for (const json of [
      ['Multiply', 2, ['Inc', 'x']],
      // The last operand of a sum.
      ['Add', 'y', ['Inc', 'x']],
      ['Add', ['Inc', 'x'], 'y'],
    ])
      expectInterpreterValues(ce, json, points);
  });

  test('in a statement position the code is unchanged', () => {
    // A statement of a `Block`: no operator around it, no parentheses.
    const code = codeOf(ce, ['Block', ['Inc', 'x'], ['Multiply', 2, 'x']]);
    expect(code).toContain('\n_.x + 1;');
    expect(code).not.toContain('(_.x + 1)');
  });
});

describe('a name with a letter outside ASCII', () => {
  // A name that starts with a keyword (`doα`) is a name, not the keyword.
  const ce = newEngine();
  const d = { sym: 'doα' };

  test('the values match the interpreter', () => {
    for (const body of [
      ['Divide', 2, ['Fract', d]],
      ['Multiply', 2, ['If', ['Less', 2, 3], ['Add', d, 1], 0]],
    ]) {
      const fn = ['Function', body, d];
      const r = compile(ce.box(fn as Json), { fallback: false });
      expect(r.success).toBe(true);
      for (const v of [1.25, -0.4, 3.7])
        expect((r.run as any)(v)).toBeCloseTo(
          ce.box(['Apply', fn, v] as Json).N().re!,
          12
        );
    }
    expect(
      compile(ce.box(['Function', ['Divide', 2, ['Fract', d]], d] as Json), {
        fallback: false,
      }).code
    ).toBe('(doα) => 2 / (doα - Math.floor(doα))');
  });
});

describe('isPrimaryCode', () => {
  test('primaries', () => {
    for (const code of [
      '_.x',
      'x',
      'a.b[c]',
      'a.b[c].d',
      '0',
      '12.5',
      '.5',
      '1e-7',
      '2.5E+10',
      '0x1F',
      '3n',
      'true',
      'NaN',
      '"a(b"',
      "'it\\'s'",
      'Math.cos(_.x)',
      'f(a)(b)',
      '_SYS.pow2(_.x + 1)',
      '(a + b)',
      '((a) + (b))',
      '[a, b + 1]',
      '[1, 2][0]',
      '(() => { const t = _.x; return t * t; })()',
      '((t) => t + 1)(_.x)',
      'vec2(a, b)',
      'vec2(a, b).x',
      'float[3](a, b, c)',
      ' Math.PI ',
      'f("(")',
      'f(a / b)',
      'f((a) / 2)',
      'α',
      '$x.y(z)',
      'πr',
      'x_1',
      'doα',
      'ifé(x)',
    ])
      expect([code, isPrimaryCode(code)]).toEqual([code, true]);
  });

  test('not primaries', () => {
    for (const code of [
      '',
      '-1',
      '-x',
      '!x',
      'a + b',
      'a * b',
      '1 / Math.cosh(_.x)',
      '(1 - Math.cos(x)) / 2',
      'x - Math.floor(x)',
      'c ? a : b',
      'x => x',
      'typeof x',
      'typeof(x)',
      'not(x)',
      'new Foo()',
      '{ re: 1, im: 0 }',
      '(a) (b)',
      'a?.b',
      'a.b.',
      'f(a) + g(b)',
      '(a)(b) * c',
      'x ** 2',
      '"a" + "b"',
      'doα - 1',
      'ifé + 1',
      'α + 1',
      'do$ + 1',
    ])
      expect([code, isPrimaryCode(code)]).toEqual([code, false]);
  });

  test('when the scan cannot tell, the code is not a primary', () => {
    for (const code of [
      // An unbalanced or mismatched bracket.
      'f(a',
      'f(a]',
      '(a))',
      // A template literal, a comment, a regular expression.
      'f(`${a})`)',
      'f(a /* ) */)',
      'f(a // )\n)',
      'f(/\\)/)',
      'f(() => { return /(/.test(s); })',
      // A string that is not closed.
      'f("a)',
      // Code longer than the scan reads (256 characters).
      `f(${'a'.repeat(300)})`,
    ])
      expect([code, isPrimaryCode(code)]).toEqual([code, false]);
  });

  test('closingBracket', () => {
    expect(closingBracket('(a)(b)', 0)).toBe(2);
    expect(closingBracket('f(a[1], ")")', 1)).toBe(11);
    expect(closingBracket('(a', 0)).toBe(-1);
    expect(closingBracket('(a]', 0)).toBe(-1);
    expect(closingBracket('(`a`)', 0)).toBe(-1);
  });

  test('operandCode', () => {
    expect(operandCode('a + b', 12)).toBe('(a + b)');
    expect(operandCode('Math.cos(a)', 12)).toBe('Math.cos(a)');
    // No operator around the code.
    expect(operandCode('a + b', 0)).toBe('a + b');
    // A statement is left to the caller that tests for it.
    expect(operandCode('return a + b', 12)).toBe('return a + b');
    expect(operandCode('', 12)).toBe('');
    // A name that starts with a statement keyword is not a statement.
    expect(operandCode('doα - 1', 12)).toBe('(doα - 1)');
    expect(operandCode('forπ + 1', 12)).toBe('(forπ + 1)');
    expect(operandCode('do$ + 1', 12)).toBe('(do$ + 1)');
    // A line comment does not comment out the closing parenthesis.
    expect(operandCode('a + 1 // note', 12)).toBe('(a + 1 // note\n)');
  });
});
