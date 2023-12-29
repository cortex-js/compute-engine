// import { expression, latex } from './utils';

import {
  Pattern,
  SemiBoxedExpression,
  Substitution,
} from '../../src/compute-engine';
import { Expression } from '../../src/math-json';
import { engine, latex } from '../utils';

const ce = engine;

function pattern(p: Expression) {
  return engine.pattern(p);
}

function match(pattern: Pattern, expr: Expression): Substitution | null {
  const result = pattern.match(engine.box(expr), {});
  if (result === null) return null;
  const r = {};
  for (const key of Object.keys(result)) r[key] = result[key].toString();
  return r;
}

describe('PATTERNS  MATCH - Universal wildcard', () => {
  // Return not null (i.e. `{}`) when there is a match
  const pattern = engine.pattern(['Add', 1, '__']);
  test('Simple match', () =>
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`{}`));
  test('Commutative', () =>
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`{}`));
  test('Commutative, multiple ops', () =>
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(`{}`));
  // Associative
  test('Associative', () =>
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(
      `{}`
    ));
});

describe('PATTERNS  MATCH - Named wildcard', () => {
  const pattern = engine.pattern(['Add', 1, '__a']);
  test('Commutative wildcards', () => {
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`{__a: "2"}`);
    // Commutative
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`{__a: "2"}`);
  });
  test('Associative wildcards', () => {
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(
      `{__a: "Add(2, 3)"}`
    );
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(
      `{__a: "Add(2, 3)"}`
    );
  });
});

describe('PATTERNS  MATCH - Sequence wildcard', () => {
  test('Sequence wildcard', () => {
    expect(
      pattern(['Add', 1, '__a']).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`{__a: ["Add", 2, 3, 4]}`);
    expect(
      pattern(['Add', 1, '__a', 4]).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`{__a: ["Add", 2, 3]}`);
    expect(
      pattern(['Add', 1, 2, '__a', 3]).match(engine.box(['Add', 1, 2, 3]))
    ).toMatchInlineSnapshot(`null`);
    expect(
      pattern(['Add', 1, 2, '___a', 3]).match(engine.box(['Add', 1, 2, 3]))
    ).toMatchInlineSnapshot(`{___a: 0}`);
    expect(
      pattern(['Multiply', 1, 2, '___a', 3]).match(
        engine.box(['Multiply', 1, 2, 3])
      )
    ).toMatchInlineSnapshot(`null`);
    expect(
      pattern(['Add', 1, 2, '__a', 4]).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`{__a: 3}`);
    expect(
      pattern(['Add', 1, 2, '__a', 3]).match(engine.box(['Add', 1, 2, 3]))
    ).toMatchInlineSnapshot(`null`);
  });
});

const TOLERANCE = 2.22044604925031e-16;

const sameExprs: [SemiBoxedExpression, SemiBoxedExpression][] = [
  [1, 1],
  [3.14159265, 3.14159265],
  [3.14159265, { num: '3.14159265' }],
  [{ num: '3.14159265' }, { num: '3.14159265' }],
  [3.14159265, { num: '+3.14159265' }],
  [3.14159265, 3.14159265 + TOLERANCE],
  [7, 7],

  ['Pi', 'Pi'],
  ['Pi', { sym: 'Pi' }],
  [{ sym: 'Pi' }, { sym: 'Pi', wikidata: 'Q167' }],

  [
    ['Add', 1, 'x'],
    ['Add', 'x', 1],
  ],
  [{ fn: ['Add', 'x', 1] }, ['Add', 'x', 1]],
  // [{ dict: { Alpha: 'a', Beta: 'b' } }, { dict: { Alpha: 'a', Beta: 'b' } }],
];

const notSameExprs: [Expression, Expression][] = [
  [1, 0],
  [2, 5],

  [1, 'Pi'],
  ['Pi', 1],

  [1, 'x'],
  ['x', 1],
  ['x', 'y'],
  ['x', ['Foo']],
  [['Foo'], 'x'],

  // [
  //   { sym: 'Pi', wikidata: 'Q168' }, // Greek letter π
  //   { sym: 'Pi', wikidata: 'Q167' }, // 3.14159265...
  // ],

  [
    ['Add', 1],
    ['Add', 1, 2],
  ],
  [
    ['Add', 1, 2, 3],
    ['Add', 1, 2],
  ],
  [
    ['Add', 1, 2, 3],
    ['Add', 1, 2, 4],
  ],
  [
    { dict: { Alpha: 'a', Beta: 'b' } },
    { dict: { Alpha: 'a', Beta: 'b', Gamma: 'g' } },
  ],
  [{ dict: { Alpha: 'a', Beta: 'b' } }, { dict: { Alpha: 'a', Beta: 'c' } }],
  ['Nothing', { dict: { Alpha: 'a', Beta: 'b', Gamma: 'g' } }],
  [['Add', 2, 'x'], { dict: { Alpha: 'a', Beta: 'b', Gamma: 'g' } }],
];

describe('MATCH', () => {
  for (const expr of sameExprs) {
    const lhs = ce.box(expr[0]).canonical;
    const rhs = ce.box(expr[1]).canonical;
    test(`match(${lhs.latex}, ${rhs.latex})`, () => {
      expect(
        ce.pattern(lhs).match(rhs, { numericTolerance: TOLERANCE }) !== null
      ).toBeTruthy();
    });
  }
});

describe('NOT SAME', () => {
  for (const expr of notSameExprs) {
    test(`match(${latex(expr[0])}, ${latex(expr[1])})`, () =>
      expect(
        engine.box(expr[0]).canonical.isSame(engine.box(expr[1]).canonical)
      ).toBeFalsy());
  }
});

describe('WILDCARDS', () => {
  it('should match a wildcard', () => {
    const pattern = ce.pattern('_x');
    const result = pattern.match(ce.box(1));
    expect(result).toMatchInlineSnapshot(`{_x: 1}`);
  });

  it('should match a wildcard', () => {
    const pattern = ce.pattern('_x');
    const result = pattern.match(ce.box('a'));
    expect(result).toMatchInlineSnapshot(`{_x: "a"}`);
  });

  it('should match a wildcard', () => {
    const pattern = ce.pattern('_x');
    const result = pattern.match(ce.box(['Add', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`{_x: ["Add", "a", 1]}`);
  });

  it('should match a wildcard of a commutative function', () => {
    const pattern = ce.pattern(['Add', '_x', 1]);
    const result = pattern.match(ce.box(['Add', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`{_x: "a"}`);
  });

  it('should **NOT** match a wildcard of a commutative function with more arguments', () => {
    const pattern = ce.pattern(['Add', '_x', 1]);
    const result = pattern.match(ce.box(['Add', 'x', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`null`);
  });

  it('should match a sequence wildcard of a commutative function with more argument', () => {
    const pattern = ce.pattern(['Add', '__x', 1]);
    const result = pattern.match(ce.box(['Add', 'x', 1, 'a']));
    expect(result).toMatchInlineSnapshot(`{__x: ["Add", "a", "x"]}`);
  });

  // it('should match a wildcard with a condition', () => {
  //   const pattern = ce.pattern('_x', { condition: '_x > 0' });
  //   const result = pattern.match(1);
  //   expect(result).toMatchInlineSnapshot(`
  //     Object {
  //       "x": 1,
  //     }
  //   `);
  // });
  // it('should not match a wildcard with a condition', () => {
  //   const pattern = ce.pattern('_x', { condition: '_x > 0' });
  //   const result = pattern.match(-1);
  //   expect(result).toBeNull();
  // });
});

// Some operations (add, multiply) can accept variations on patterns.
// For example, "ax+b" can match "ax" or "x+b".
describe('NON EXACT WILDCARDS', () => {
  const match = (pattern, x) =>
    pattern.match(ce.box(x), { substitution: { _x: ce.box('_x') } });

  it('should match x for a + x', () => {
    const pattern = ce.pattern(['Add', '_a', '_x']);
    const result = match(pattern, '_x');
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: 0}`);
  });

  it('should match x - a for a + x', () => {
    const pattern = ce.pattern(['Add', '_a', '_x']);
    const result = match(pattern, ['Subtract', '_x', 5]);
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: -5}`);
  });

  it('should match x for x - a', () => {
    const pattern = ce.pattern(['Subtract', '_x', '_a']);
    const result = match(pattern, '_x');
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: 0}`);
  });

  it('should match -x for a - x', () => {
    const pattern = ce.pattern(['Subtract', '_a', '_x']);
    const result = match(pattern, ['Negate', '_x']);
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: 0}`);
  });

  it('should match x for ax', () => {
    const pattern = ce.pattern(['Multiply', '_a', '_x']);
    const result = match(pattern, '_x');
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: 1}`);
  });

  it('should match x/a for ax', () => {
    const pattern = ce.pattern(['Multiply', '_a', '_x']);
    const result = match(pattern, ['Divide', '_x', '2']);
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: ["Divide", 1, 2]}`);
  });

  it('should match -x for ax', () => {
    const pattern = ce.pattern(['Multiply', '_a', '_x']);
    const result = match(pattern, ['Negate', '_x']);
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: -1}`);
  });

  it('should match x/a for x', () => {
    const pattern = ce.pattern(['Divide', '_x', '_a']);
    const result = match(pattern, '_x');
    expect(result).toMatchInlineSnapshot(`{_x: "_x"; _a: 1}`);
  });

  it('should match a sequence with multiple potential zeros', () => {
    const pattern = ce.pattern(['Add', '_a', ['Multiply', '_a', '_b']]);
    const result = pattern.match(ce.One);
    expect(result).toMatchInlineSnapshot(`{_a: 1; _b: 0}`);
  });

  it('should match a sequence with multiple potential zeros', () => {
    const pattern = ce.pattern(['Add', '___b', ['Multiply', '_a', '_b']]);
    const result = pattern.match(ce.One);
    expect(result).toMatchInlineSnapshot(`{_a: 1; _b: 0; ___b: 1}`);
  });
});
