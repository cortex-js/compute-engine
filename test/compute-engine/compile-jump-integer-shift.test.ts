/**
 * A rounding function (`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`) whose
 * operand adds an integer-typed variable to an exact constant that no double
 * holds compiles to the interpreter's value.
 *
 * The structural code computes the constant as a double, and the rounding can
 * go to the other side of the jump: the double of `c = (25! − 1)/24!` is
 * 25.0, so `Floor(k + c)` at `k = 1` was `Math.floor(1 + 25)`, 26, where the
 * exact value is 25. The compiler now rounds the constant alone, exactly
 * (`Floor(k + c) = k + Floor(c)` for an integer `k`), and declines the other
 * shapes whose variables are all integers. A shape with a real variable keeps
 * its structural code: there the double of the constant moves the jump by
 * about one unit in the last place, as in any float code.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

const ce = new ComputeEngine();
ce.declare('n', 'integer');

const box = (json: unknown) => ce.box(json as Parameters<typeof ce.box>[0]);

// (25! + s)/24! = 25 + s/24!: a value just next to 25 whose double is 25.0.
const near = (s: number) => [
  'Divide',
  ['Add', ['Factorial', 25], s],
  ['Factorial', 24],
];
const nearInt = near(-1);

const sumOf = (head: string, lo: number, hi: number) =>
  box([
    'Sum',
    ['Multiply', 'x', [head, ['Add', 'k', nearInt]]],
    ['Limits', 'k', lo, hi],
  ]);

/** The interpreter's value of `expr` at `x = 1`. */
const interpreted = (expr: ReturnType<typeof box>) =>
  expr.subs({ x: 1 }).N().re;

describe('Sum of a rounding of a loop index plus an exact constant', () => {
  test('the unrolled form gives the interpreter value', () => {
    const e = sumOf('Floor', 1, 3);
    expect(interpreted(e)).toBe(78);
    const r = compile(e, { fallback: false });
    expect(r.code).not.toMatch(/Math\.floor/);
    expect(r.run?.({ x: 1 })).toBe(78);
  });

  test('the loop form gives the interpreter value', () => {
    const e = sumOf('Floor', 1, 300);
    expect(interpreted(e)).toBe(52350);
    const r = compile(e, { fallback: false });
    expect(r.code).toMatch(/while \(k <= _upper\)/);
    expect(r.code).toContain('(k + 24)');
    expect(r.run?.({ x: 1 })).toBe(52350);
  });

  test('also without constant folding', () => {
    for (const hi of [3, 300]) {
      const e = sumOf('Floor', 1, hi);
      const r = compile(e, { fallback: false, constantFold: false });
      expect(r.run?.({ x: 1 })).toBe(interpreted(e));
    }
  });

  test.each(['Floor', 'Ceil', 'Round', 'Truncate', 'Fract'])(
    '%s, unrolled and loop forms, with negative indices',
    (head) => {
      for (const hi of [3, 300]) {
        const e = sumOf(head, -40, hi);
        const r = compile(e, { fallback: false });
        expect(r.run?.({ x: 1 })).toBe(interpreted(e));
      }
    }
  );

  test('GLSL and WGSL code rounds the constant exactly', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      const short = String(compile(sumOf('Floor', 1, 3), { to }).code);
      expect(short).not.toMatch(/floor\(/);
      expect(short).toContain('(x * 25.0) + (x * 26.0) + (x * 27.0)');
      const loop = String(compile(sumOf('Floor', 1, 300), { to }).code);
      expect(loop).not.toMatch(/floor\(/);
      expect(loop).toMatch(/\+ 24\.0\)/);
    }
  });

  const pythonAvailable = (() => {
    if (TEST_PYTHON === undefined) return false;
    try {
      execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  (pythonAvailable ? test : test.skip)(
    'Python, unrolled and loop forms',
    () => {
      const python = new PythonTarget();
      const cases = [
        sumOf('Floor', 1, 3),
        sumOf('Floor', 1, 300),
        sumOf('Truncate', -40, 3),
        sumOf('Round', -40, 300),
      ];
      let program = 'import numpy as np\nimport math, json\n\n';
      cases.forEach((e, i) => {
        program += `${python.compileFunction(e, `fn_${i}`, ['x'])}\n`;
      });
      program += `print(json.dumps([float(f(1)) for f in [${cases
        .map((_, i) => `fn_${i}`)
        .join(', ')}]]))\n`;
      const file = path.join(os.tmpdir(), `ce-py-jump-shift-${process.pid}.py`);
      fs.writeFileSync(file, program);
      let out = '';
      try {
        out = execFileSync(TEST_PYTHON!, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      expect(JSON.parse(out)).toEqual(cases.map(interpreted));
    }
  );
});

describe('Rounding of an integer-typed variable plus an exact constant', () => {
  const constants = [
    nearInt,
    near(1),
    ['Negate', nearInt],
    ['Negate', near(1)],
    // Just above and just below 1/2, and a tie of a large magnitude is
    // tested below.
    ['Add', ['Rational', 1, 2], ['Divide', 1, ['Factorial', 24]]],
    ['Subtract', ['Rational', 1, 2], ['Divide', 1, ['Factorial', 24]]],
    ['Multiply', 'Pi', ['Power', 10, 30]],
    ['Rational', 1, 3],
    ['Negate', ['Rational', 7, 3]],
    ['Sqrt', 2],
  ];

  test.each(['Floor', 'Ceil', 'Round', 'Truncate', 'Fract'])(
    '%s gives the interpreter value at each integer',
    (head) => {
      for (const c of constants) {
        const r = compile(box([head, ['Add', 'n', c]]), { fallback: false });
        for (let n = -30; n <= 30; n += 1) {
          const exact = box([head, ['Add', n, c]]).N().re;
          expect([head, c, n, r.run?.({ n })]).toEqual([
            head,
            c,
            n,
            expect.closeTo(exact, 12),
          ]);
        }
      }
    }
  );

  test('Truncate is not shifted across zero', () => {
    // Truncate(−3 + c) for c just above 1/2 is −2; −3 + Truncate(c) is −3.
    const c = ['Add', ['Rational', 1, 2], ['Divide', 1, ['Factorial', 24]]];
    const r = compile(box(['Truncate', ['Add', 'n', c]]), { fallback: false });
    expect(r.run?.({ n: -3 })).toBe(-2);
    expect(r.run?.({ n: 3 })).toBe(3);
  });

  test('a sum of integer terms with integer coefficients is shifted', () => {
    ce.declare('m', 'integer');
    const e = box(['Floor', ['Add', 'n', ['Multiply', 2, 'm'], nearInt]]);
    const r = compile(e, { fallback: false });
    expect(r.run?.({ n: 1, m: 2 })).toBe(29);
  });
});

describe('Other shapes whose variables are all integers decline', () => {
  const declines = (json: unknown) => {
    expect(() => compile(box(json), { fallback: false })).toThrow(
      /no double holds exactly/
    );
  };

  test('a variable part that is not an integer', () => {
    declines(['Ceil', ['Add', ['Multiply', ['Rational', 1, 3], 'n'], nearInt]]);
    declines(['Floor', ['Add', ['Divide', 'n', 3], ['Rational', 1, 7]]]);
  });

  test('a product of an integer and the constant', () => {
    declines(['Floor', ['Multiply', 'n', 'Pi']]);
    declines(['Floor', ['Divide', 'n', ['Factorial', 24]]]);
  });

  test('the constant inside a variable term', () => {
    declines(['Floor', ['Add', ['Multiply', 'n', ['Sqrt', 2]], 1]]);
  });

  test('a step form', () => {
    declines(['Floor', ['Add', 'n', nearInt], 2]);
  });

  test('Round of a constant halfway between two integers', () => {
    // 30! + 1/2 is a tie, and the tie rule (away from zero by default) is
    // not shift-invariant: Round(−3 + 1/2) is −3, −3 + Round(1/2) is −2.
    declines(['Round', ['Add', 'n', ['Rational', 1, 2], ['Factorial', 30]]]);
  });

  test('the decline is a correctness decline, and the fallback is the interpreter', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // n/3 + (25! − 1)/24! at n = 3 is 26 − 1/24!, whose double is 26.0.
      const r = compile(
        box(['Floor', ['Add', ['Multiply', ['Rational', 1, 3], 'n'], nearInt]])
      );
      expect(r.success).toBe(false);
      expect(r.diagnostic).toMatchObject({
        code: 'inexact-jump-operand',
        kind: 'correctness',
      });
      expect(r.run?.({ n: 3 })).toBe(25);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('A shape with a variable that is not an integer keeps its structural code', () => {
  // `y` is real; `n` is integer.
  const shapes: Array<[unknown, string, string]> = [
    [
      ['Floor', ['Add', 'x', nearInt]],
      'Math.floor(_.x + 25)',
      'floor(x + 25.0)',
    ],
    [
      ['Floor', ['Multiply', 'Pi', 'x']],
      'Math.floor(Math.PI * _.x)',
      'floor(3.14159265359 * x)',
    ],
    [
      ['Floor', ['Add', 'x', ['Rational', 1, 3]]],
      'Math.floor(_.x + 0.3333333333333333)',
      'floor(x + 0.33333334)',
    ],
    [
      ['Floor', ['Divide', 'x', ['Sqrt', 2]]],
      'Math.floor(0.7071067811865476 * _.x)',
      'floor(0.70710677 * x)',
    ],
    [
      ['Floor', ['Add', ['Divide', 'y', 3], ['Rational', 1, 7]]],
      'Math.floor(_.y / 3 + 0.14285714285714285)',
      'floor(y / 3.0 + 0.14285715)',
    ],
    // An integer variable next to a real one: the real one decides.
    [
      ['Floor', ['Add', 'n', 'x', nearInt]],
      'Math.floor(_.n + _.x + 25)',
      'floor(n + x + 25.0)',
    ],
  ];

  test.each(shapes)('%j on JavaScript and GLSL', (json, js, glsl) => {
    expect(compile(box(json), { fallback: false }).code).toBe(js);
    expect(compile(box(json), { to: 'glsl', fallback: false }).code).toBe(glsl);
  });

  test('a product and a step form with a real variable', () => {
    for (const json of [
      ['Floor', ['Divide', 'x', ['Factorial', 24]]],
      ['Floor', ['Add', 'x', nearInt], 2],
      ['Round', ['Add', 'x', ['Rational', 1, 2], ['Factorial', 30]]],
    ]) {
      for (const to of ['javascript', 'glsl'] as const) {
        const r = compile(box(json), { to, fallback: false });
        expect(r.success).toBe(true);
      }
    }
  });

  test('the double of the constant can move the jump', () => {
    // The double of (25! − 1)/24! is 25.0. The interpreter gives
    // Floor(1 + 25 − 1/24!) = 25; the compiled code gives Math.floor(26).
    const e = box(['Floor', ['Add', 'x', nearInt]]);
    expect(interpreted(e)).toBe(25);
    expect(compile(e, { fallback: false }).run?.({ x: 1 })).toBe(26);
  });
});

describe('The structural code is kept', () => {
  test('for a constant that a double holds exactly', () => {
    expect(compile(box(['Floor', ['Add', 'n', ['Rational', 1, 2]]])).code).toBe(
      'Math.floor(_.n + 0.5)'
    );
  });

  test('for a product with a free variable and no constant', () => {
    expect(compile(box(['Floor', ['Multiply', 'n', 'x']])).code).toBe(
      'Math.floor(_.n * _.x)'
    );
    const e = box([
      'Sum',
      ['Floor', ['Multiply', 'k', 'x']],
      ['Limits', 'k', 1, 300],
    ]);
    expect(String(compile(e).code)).toContain('Math.floor(k * _.x)');
  });

  test('for a rational factor emitted as a division', () => {
    expect(compile(box(['Floor', ['Divide', 'x', 3]])).code).toBe(
      'Math.floor(_.x / 3)'
    );
    expect(
      compile(box(['Floor', ['Multiply', ['Rational', 2, 3], 'n']])).code
    ).toBe('Math.floor(_.n / 3 * 2)');
  });

  test('for an operand with a float literal', () => {
    expect(
      String(compile(box(['Floor', ['Add', 'n', 0.5, nearInt]])).code)
    ).toMatch(/^Math\.floor\(/);
  });

  test('for a constant that is not real', () => {
    // The real-only gate of the head judges an operand that may be complex.
    const r = compile(box(['Floor', ['Add', 'x', ['Complex', 1, 1]]]), {
      fallback: false,
      constantFold: false,
    });
    expect(r.code).toContain('_SYS.cisreal(');
  });

  test('on the interval target, whose code computes an enclosure', () => {
    const r = compile(box(['Floor', ['Add', 'n', nearInt]]), {
      to: 'interval-js',
    });
    expect(String(r.code)).toMatch(/_IA\.floor\(/);
  });
});

describe('The rewrite is skipped', () => {
  test('for an operand with an effect: one draw, as in the structural code', () => {
    // Each case: the expression, and the operand the structural code rounds,
    // with its integer term and its single draw.
    const draw = '_SYS.drawNextRandomNumber()';
    const cases: Array<[unknown, string]> = [
      [
        [
          'Truncate',
          ['Add', 'n', ['Rational', 1, 3], ['Multiply', 10, ['Random']]],
        ],
        `Math.trunc(_.n + 0.3333333333333333 + 10 * ${draw})`,
      ],
      // The tie test of `Round` evaluated the constant at compile time.
      [['Round', ['Add', 'n', ['Random']]], `_tv1 = _.n + ${draw};`],
      // `Fract(v + c)` is `Fract(c)`, which dropped the integer term.
      [
        ['Fract', ['Add', 'n', ['Rational', 1, 3], ['Multiply', 10, ['Random']]]],
        `_tv1 = _.n + 0.3333333333333333 + 10 * ${draw};`,
      ],
      [
        ['Floor', ['Add', 'n', nearInt, ['Random']]],
        `Math.floor(_.n + 25 + ${draw})`,
      ],
    ];
    for (const [json, operand] of cases) {
      const code = String(compile(box(json), { fallback: false }).code);
      expect([json, code.split(draw).length - 1]).toEqual([json, 1]);
      expect(code).toContain(operand);
    }
  });

  test('for a caller-supplied lowering of the rounding function', () => {
    const e = box(['Floor', ['Add', 'n', ['Rational', 1, 3]]]);
    const r = compile(e, { fallback: false, functions: { Floor: () => 42 } });
    expect(r.code).toBe('Floor(_.n + 0.3333333333333333)');
    expect(r.run?.({ n: 1 })).toBe(42);
  });

  test('for a caller-supplied lowering of an operator in the operand', () => {
    const e = box([
      'Floor',
      ['Add', ['Ceil', ['Divide', 'n', 3]], ['Rational', 1, 3]],
    ]);
    const r = compile(e, {
      fallback: false,
      functions: { Ceil: (a: number) => a + 0.5 },
    });
    expect(r.code).toBe('Math.floor(Ceil(_.n / 3) + 0.3333333333333333)');
    expect(r.run?.({ n: 3 })).toBe(1);
  });
});

describe('A constant shared between two positions of the operand', () => {
  beforeAll(() => ce.declare('j', 'integer'));

  test('gives the same result as two separate constants', () => {
    // As a factor of a product, 1/3 is emitted as a division by 3; as a
    // term of the sum, it is a constant that no double holds. One shared
    // `1/3` object must be judged at each of its positions.
    const third = ce.box(['Rational', 1, 3]);
    const shared = ce.function('Floor', [
      ce.function('Add', [
        ce.symbol('n'),
        ce.function('Multiply', [third, ce.symbol('j')]),
        third,
      ]),
    ]);
    const separate = box([
      'Floor',
      ['Add', 'n', ['Multiply', ['Rational', 1, 3], 'j'], ['Rational', 1, 3]],
    ]);
    for (const e of [shared, separate])
      expect(() => compile(e, { fallback: false })).toThrow(
        /no double holds exactly/
      );
  });
});
