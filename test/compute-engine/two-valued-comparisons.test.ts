/**
 * Two-valued comparisons (user decision 2026-11-02, options page 3, option A
 * of `docs/plans/2026-11-02-language-axes-options.md`).
 *
 * A comparison is `True` or `False`. An undecided operand (`NaN`, `Missing`,
 * a pole, a value with no order) makes it `False` (`NotEqual`: `True`, since
 * `≠` is `Not(=)`). A connective reads an absent value as `False`, and so does
 * the condition of an `If` or a `Which`: the branch takes its next arm, as
 * Desmos does (`\{u<1:5,7\}` is 7 when `u` is undefined, measured by Tycho on
 * 2026-11-02). A comparison whose operands are symbolic stays held.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();
const value = (json: unknown): string =>
  ce
    .box(json as MathJsonExpression)
    .evaluate()
    .toString()
    // A symbol prints quoted (`"False"`): compare without the quotes.
    .replace(/"/g, '');

describe('a comparison with an undecided operand is False', () => {
  test.each([
    [['Greater', 'Missing', 0], 'False'],
    [['Not', ['Greater', 'Missing', 0]], 'True'],
    [['Or', ['Greater', 'Missing', 0], 'True'], 'True'],
    [['And', ['Greater', 'Missing', 0], 'True'], 'False'],
    [['Greater', 'NaN', 0], 'False'],
    [['Equal', ['Divide', 0, 0], 0], 'False'],
    [['Less', 'Missing', 'ImaginaryUnit'], 'False'],
    [['Less', 0, 'Missing', 1], 'False'],
    [['NotEqual', 'NaN', 0], 'True'],
    [['NotEqual', 'Missing', 0], 'True'],
  ])('%j is %s', (json, expected) => {
    expect(value(json)).toBe(expected);
  });

  test('the result type is boolean', () => {
    expect(ce.box(['Greater', 'Missing', 0]).type.toString()).toBe('boolean');
    expect(ce.box(['Not', 'Missing']).type.toString()).toBe('boolean');
  });

  test('a comparison of two collections with an absent cell', () => {
    expect(
      value(['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']])
    ).toBe('False');
    expect(
      value(['NotEqual', ['List', 1, 'Missing'], ['List', 1, 'Missing']])
    ).toBe('True');
    expect(value(['Equal', ['List', 1, 'Missing'], 1])).toBe('[True,False]');
  });

  test('a comparison with a free symbol stays held', () => {
    expect(value(['Less', 0, 'x'])).toBe('0 < x');
  });
});

describe('a connective reads an absent value as False', () => {
  test.each([
    [['Not', 'Missing'], 'True'],
    [['And', 'Missing', 'True'], 'False'],
    [['Or', 'Missing', 'False'], 'False'],
    [['Xor', 'Missing', 'True'], 'True'],
    [['Implies', 'Missing', 'False'], 'True'],
    [
      ['Any', ['List', 1, 'Missing'], ['Function', ['Greater', 'x', 2], 'x']],
      'False',
    ],
    [
      [
        'All',
        ['List', 1, 'Missing', 3],
        ['Function', ['Greater', 'x', 0], 'x'],
      ],
      'False',
    ],
  ])('%j is %s', (json, expected) => {
    expect(value(json)).toBe(expected);
  });
});

describe('an absent condition is False', () => {
  test.each([
    [['If', 'Missing', 1, 2], '2'],
    [['Which', 'Missing', 1, 'True', 2], '2'],
    [['If', 'Missing', 1], 'NaN'],
    [['If', ['Greater', 'Missing', 0], 1, 2], '2'],
  ])('%j is %s', (json, expected) => {
    expect(value(json)).toBe(expected);
  });

  test('a restriction of a relation by a false condition is False', () => {
    expect(value(['If', 'False', ['Less', 0, 'x']])).toBe('False');
  });
});

describe('Desmos parity (measured by Tycho, 2026-11-02)', () => {
  test('{u<1:5,7} with u undefined is 7', () => {
    expect(
      ce.parse('\\left\\{\\frac{0}{0}<1:5,7\\right\\}').evaluate().toString()
    ).toBe('7');
  });

  test('{L<2:5,7} with L = [1, 0/0, 3] is [5, 7, 7]', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    e.assign('L', e.box(['List', 1, 'NaN', 3]));
    expect(e.parse('\\left\\{L<2:5,7\\right\\}').evaluate().toString()).toBe(
      '[5,7,7]'
    );
  });
});

describe('an unmatched cell under a list of conditions', () => {
  const engine = () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<real>');
    return e;
  };
  const relation: MathJsonExpression = [
    'If',
    ['Less', 'L', 2],
    ['Less', 0, 'L'],
  ];
  const colour: MathJsonExpression = [
    'Which',
    ['Less', 'L', 2],
    ['Hsv', 0, 0, 0.5],
  ];

  test('a relation arm gives False, in the interpreter and in JavaScript', () => {
    const e = engine();
    const expr = e.box(relation);
    const c = compile(expr, { to: 'javascript' } as never) as any;
    expect(c.success).toBe(true);
    expect(c.run({ L: [1, 3] })).toEqual([true, false]);
    e.assign('L', e.box(['List', 1, 3]));
    expect(expr.evaluate().toString().replace(/"/g, '')).toBe('[True,False]');
  });

  test('a colour arm gives a colour with NaN channels (Tycho item 189)', () => {
    const e = engine();
    const expr = e.box(colour);
    expect(expr.type.toString()).toBe('list<color>');
    const c = compile(expr, { to: 'javascript' } as never) as any;
    expect(c.success).toBe(true);
    const cells = c.run({ L: [1, 3] });
    expect(Number.isNaN(cells[1].c0)).toBe(true);
    // The same non-finite colour as the compiled colour operators give.
    expect(cells[1]).toEqual({
      space: 'oklch',
      c0: NaN,
      c1: NaN,
      c2: NaN,
      alpha: undefined,
    });
    e.assign('L', e.box(['List', 1, 3]));
    expect(expr.evaluate().json).toEqual([
      'List',
      ['Hsv', 0, 0, 0.5],
      ['Rgb', 'NaN', 'NaN', 'NaN'],
    ]);
  });
});

describe('corpus row neyret/xhlkk7k9aq #1752170633', () => {
  // `.7=c_3\{0<\{c_1<1\}\{c_2<1\}: …, …, 1\}`: the condition of the first arm
  // is `If(c_2<1, Less(0, If(c_1<1, 1)))`. Where `c_2 ≥ 1` the condition is
  // the absent boolean, which reads as `False`: the else arm.
  const json: MathJsonExpression = [
    'Which',
    ['If', ['Less', 'c2', 1], ['Less', 0, ['If', ['Less', 'c1', 1], 1]]],
    5,
    'True',
    7,
  ];
  const engine = () => {
    const e = new ComputeEngine();
    e.declare('c1', 'real');
    e.declare('c2', 'real');
    return e;
  };

  test.each([
    [{ c1: 0, c2: 2 }, 7],
    [{ c1: 0, c2: 0 }, 5],
    [{ c1: 2, c2: 0 }, 7],
  ])(
    'at %j the value is %d on the interpreter and on JavaScript',
    (at, expected) => {
      const e = engine();
      const expr = e.box(json);
      const c = compile(expr, { to: 'javascript' } as never) as any;
      expect(c.success).toBe(true);
      expect(c.run(at)).toBe(expected);
      const subs = Object.fromEntries(
        Object.entries(at).map(([k, v]) => [k, e.number(v)])
      );
      expect(expr.subs(subs).evaluate().toString()).toBe(String(expected));
    }
  );

  test('GLSL compiles it', () => {
    const c = compile(engine().box(json), { to: 'glsl' } as never) as any;
    // The GLSL fragment refuses the form before any code is written.
    expect(c.success).toBe(false);
    expect(c.diagnostic?.code).toBe('outside-fragment');
  });
});

describe('the type of a comparison with an operand absent as a whole', () => {
  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
  // is a result only"), so an operand cannot be declared absent as a whole.
  // The value of a comparison over the written `Missing` is `False`.
  test('an operand cannot be declared `list<integer> | missing`', () => {
    const e = new ComputeEngine();
    expect(() => e.declare('L', 'list<integer> | missing')).toThrow(
      /cannot be declared/
    );
    expect(e.box(['Less', 'Missing', 3]).evaluate().symbol).toBe('False');
  });
});

describe('a boolean predicate with an absent operand is a boolean', () => {
  // A boolean predicate of the collection and set libraries is two-valued,
  // as a comparison is: an absent operand makes it `False`, and its negated
  // form `True` (user decision 2026-11-02, two-valued comparisons).
  const p = ['Function', ['Greater', 'x', 1], 'x'];
  test.each([
    [['Any', 'Missing', p], 'False'],
    [['All', 'Missing', p], 'False'],
    [['Contains', 'Missing', 3], 'False'],
    [['IsEmpty', 'Missing'], 'False'],
    [['Element', 2, 'Missing'], 'False'],
    [['NotElement', 2, 'Missing'], 'True'],
    [['StartsWith', 'Missing', { str: 'a' }], 'False'],
    [['EndsWith', 'Missing', { str: 'a' }], 'False'],
    [['ContainsSequence', 'Missing', ['List', 1]], 'False'],
    [['Subset', 'Missing', ['Set', 1]], 'False'],
    [['NotSubset', 'Missing', ['Set', 1]], 'True'],
  ])('%j is %s, typed boolean', (json, expected) => {
    expect(ce.box(json as MathJsonExpression).type.toString()).toBe('boolean');
    expect(value(json)).toBe(expected);
  });

  test('a number-theory predicate keeps Missing', () => {
    expect(value(['IsPrime', 'Missing'])).toBe('Missing');
  });

  // The held form of a predicate over a restricted collection is the
  // restriction of a boolean, `If(c, True)`, which is `False` for a false
  // condition. The fresh evaluation reads the predicate over `Missing`, and
  // the two routes give the same value.
  test.each([
    ['Any', ['Any', 'R', p], '"True"'],
    ['All', ['All', 'R', p], '"False"'],
    ['Element', ['Element', 2, 'R'], '"True"'],
    ['Contains', ['Contains', 'R', 3], '"True"'],
    ['IsEmpty', ['IsEmpty', 'R'], '"False"'],
    ['ContainsSequence', ['ContainsSequence', 'R', ['List', 1]], '"True"'],
    ['StartsWith', ['StartsWith', 'S', { str: 'a' }], '"True"'],
    ['EndsWith', ['EndsWith', 'S', { str: 'c' }], '"True"'],
  ])('%s: the held and the fresh routes agree', (_op, json, present) => {
    const sub = (x: unknown): unknown =>
      x === 'R'
        ? ['If', ['Less', 0, 't'], ['List', 1, 2, 3]]
        : x === 'S'
          ? ['If', ['Less', 0, 't'], { str: 'abc' }]
          : Array.isArray(x)
            ? x.map(sub)
            : x;
    const e = new ComputeEngine();
    e.declare('t', 'real');
    const expr = e.box(sub(json) as MathJsonExpression);
    const held = expr.evaluate();
    e.assign('t', -1);
    expect(held.evaluate().toString()).toBe('"False"');
    expect(expr.evaluate().toString()).toBe('"False"');
    e.assign('t', 1);
    expect(held.evaluate().toString()).toBe(present);
    expect(expr.evaluate().toString()).toBe(present);
  });
});

describe('a false restriction of a boolean is False', () => {
  // `If(c, Equal(1, 1))` is `False` where `c` is false, so its type is
  // `boolean`, not the singleton `true` of its arm. With the type `true`,
  // the compiled condition below was dropped as always true.
  const engine = () => {
    const e = new ComputeEngine();
    e.declare('c', 'boolean');
    return e;
  };

  test('the type is boolean', () => {
    expect(
      engine()
        .box(['If', 'c', ['Equal', 1, 1]])
        .type.toString()
    ).toBe('boolean');
  });

  test('a condition over it takes the else arm where c is false', () => {
    const e = engine();
    const expr = e.box(['If', ['If', 'c', ['Equal', 1, 1]], 1, 2]);
    const compiled = compile(expr, { to: 'javascript' } as never) as any;
    expect(compiled.success).toBe(true);
    expect(compiled.run({ c: false })).toBe(2);
    expect(compiled.run({ c: true })).toBe(1);
    e.assign('c', false);
    expect(expr.evaluate().toString()).toBe('2');
  });
});

describe('a negated predicate over a restricted collection', () => {
  // `NotElement` over an absent collection is `True`. The held form keeps
  // that answer for a false condition, so the held and the fresh routes
  // agree.
  test('NotElement(2, If(c, [1])) is True on both routes where c is false', () => {
    const e = new ComputeEngine();
    e.declare('c', 'boolean');
    const expr = e.box(['NotElement', 2, ['If', 'c', ['List', 1]]]);
    const held = expr.evaluate();
    e.assign('c', false);
    expect(held.evaluate().toString()).toBe('"True"');
    expect(expr.evaluate().toString()).toBe('"True"');
    e.assign('c', true);
    expect(held.evaluate().toString()).toBe('"True"');
    expect(expr.evaluate().toString()).toBe('"True"');
  });
});

describe('an absent cell of a list of conditions is False', () => {
  test.each(['Missing'])(
    'If(L, 1, 2) with L = [%s, True] is [2, 1]',
    (absent) => {
      const e = new ComputeEngine();
      const expr = e.box(['If', 'L', 1, 2]);
      e.assign('L', e.box(['List', absent, 'True']));
      expect(expr.evaluate().toString()).toBe('[2,1]');
    }
  );
});

describe('a NaN value of a number operand decides a comparison', () => {
  // With `w: number`, `w = NaN` is a present value: `w > 0` is `False`, and
  // the compiled code emits the plain comparison, with no NaN test, so it
  // gives the else arm as the interpreter does. (The declaration was
  // `number | missing` before a declared type could no longer name
  // `missing`.)
  const engine = () => {
    const e = new ComputeEngine();
    e.declare('w', 'number');
    return e;
  };
  const json: MathJsonExpression = ['If', ['Greater', 'w', 0], 1, 0];

  test('the interpreter gives 0', () => {
    const e = engine();
    const expr = e.box(json);
    e.assign('w', e.NaN);
    expect(expr.evaluate().toString()).toBe('0');
  });

  test('JavaScript gives 0', () => {
    const compiled = compile(engine().box(json), {
      to: 'javascript',
    } as never) as any;
    expect(compiled.success).toBe(true);
    expect(compiled.run({ w: NaN })).toBe(0);
    expect(compiled.run({ w: 2 })).toBe(1);
  });

  test('Python compiles the plain comparison', () => {
    const compiled = compile(engine().box(json), {
      to: 'python',
    } as never) as any;
    expect(compiled.success).toBe(true);
    expect(compiled.code).not.toContain('w == w');
  });

  test.each(['interval-js', 'glsl'])('%s compiles it', (to) => {
    const compiled = compile(engine().box(json), { to } as never) as any;
    expect(compiled.success).toBe(true);
  });
});

describe('a quantifier whose body does not use its variable', () => {
  test.each([
    ['ForAll', 'Missing'],
    ['Exists', 'Missing'],
  ])('%s with the absent body %s is False', (op, body) => {
    expect(value([op, ['Element', 'x', ['List', 1, 2]], body])).toBe('False');
  });
});

describe('ExistsUnique reads an absent body answer as False', () => {
  test('one True answer and one absent answer is True', () => {
    // `At([True], 2)` is out of range: an absent answer, read as `False`.
    expect(
      value([
        'ExistsUnique',
        ['Element', 'x', ['List', 1, 2]],
        ['At', ['List', 'True'], 'x'],
      ])
    ).toBe('True');
  });
});

describe('an element-wise connective in a condition keeps the list shape', () => {
  test.each([
    [['And', ['List', 'True', 'False'], 'Missing'], '[0,0]'],
    [['And', 'Missing', ['List', 'True', 'False']], '[0,0]'],
    [['Or', ['List', 'True', 'False'], 'Missing'], '[1,0]'],
    [['Or', 'Missing', ['List', 'True', 'False']], '[1,0]'],
  ])('If(%j, 1, 0) is %s', (cond, expected) => {
    expect(value(['If', cond, 1, 0]).replace(/\s/g, '')).toBe(expected);
  });
});

describe('Not(Not(x)) folds only for a present boolean', () => {
  test('Not(Not(Missing)) is Not(True), which is False', () => {
    expect(value(['Not', ['Not', 'Missing']])).toBe('False');
  });
  test('Not(Not(p)) with p a boolean symbol still folds to p', () => {
    const e = new ComputeEngine();
    e.declare('p', 'boolean');
    expect(e.box(['Not', ['Not', 'p']]).toString()).toBe('p');
  });
});

describe('a failed operand of a condition connective does not end the walk', () => {
  test.each([
    // A later absent operand decides `And` (`False`), as for `And` alone.
    [['And', 1, 'Missing'], '7'],
    // The deciding operand comes first: the failed operand is not evaluated.
    [['And', 'False', 1], '7'],
  ])('If(%j, 5, 7) is %s', (cond, expected) => {
    expect(value(['If', cond, 5, 7])).toBe(expected);
  });
  test('If(And(1, True), 5, 7) is the error of the failed operand', () => {
    expect(value(['If', ['And', 1, 'True'], 5, 7])).toMatch(
      /incompatible-type/
    );
  });
});

describe('a deferred colour cell of a list restriction', () => {
  test('evaluated after its condition becomes false, it is the NaN colour', () => {
    const e = new ComputeEngine();
    const m = e.box([
      'If',
      ['List', 'C', 'True'],
      ['List', ['Rgb', 1, 0, 0], ['Rgb', 0, 1, 0]],
    ]);
    const cell = m.at(1)!;
    e.assign('C', false);
    expect(cell.evaluate().toString()).toBe('Rgb(NaN, NaN, NaN)');
    expect(m.evaluate().at(1)!.toString()).toBe('Rgb(NaN, NaN, NaN)');
  });
});
