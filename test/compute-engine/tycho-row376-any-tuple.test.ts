/**
 * A point whose components are typed `any` at an operator that propagates an
 * absent operand (`Dot`, `Cross`, `Norm`, `Distance`).
 *
 * An `any` component can hold an absent value, as a `T | missing` component
 * can. At a position where the operator strips absence before it checks the
 * argument, the component is read as `unknown`, so the point is admitted and
 * the call has the type it has when the components are declared `unknown`.
 * The Tycho importer declares every parameter of a definition `any`, so the
 * `Dot` it builds for `\sin((16.234, 35.4235) \cdot (x, y))` has a
 * `tuple<any, any>` operand (Tycho ledger row 376).
 *
 * An `any` component at a TYPED slot (`tuple<any>` at `tuple<number>`) stays
 * refused; `tycho-item-257-tuple-param-deferral.test.ts` and
 * `partly-annotated-function-validation.test.ts` pin that.
 */

import type { Expression } from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';

const CALLS: [string, unknown][] = [
  ['Dot', ['Dot', ['Tuple', 1, 2], ['Tuple', 'x', 'y']]],
  ['Cross', ['Cross', ['Tuple', 1, 2, 3], ['Tuple', 'x', 'y', 'z']]],
  ['Norm', ['Norm', ['Tuple', 'x', 'y']]],
  ['Distance', ['Distance', ['Tuple', 1, 2], ['Tuple', 'x', 'y']]],
  [
    'Dot of lists of points',
    ['Dot', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 'x', 'y']]],
  ],
];

function engine(t: string): ComputeEngine {
  const ce = new ComputeEngine();
  for (const s of ['x', 'y', 'z']) ce.declare(s, t);
  return ce;
}

function summary(e: Expression): [boolean, string] {
  return [e.isValid, e.type.toString()];
}

describe('BOX ROUTE: an any-typed component is admitted as an unknown one', () => {
  test.each(CALLS)('%s', (_, input) => {
    const withAny = engine('any').box(input as never);
    const withUnknown = engine('unknown').box(input as never);
    expect(withAny.isValid).toBe(true);
    expect(JSON.stringify(withAny.json)).not.toContain('Error');
    expect(summary(withAny)).toEqual(summary(withUnknown));
  });

  test('Dot is typed value', () => {
    expect(
      engine('any')
        .box(CALLS[0][1] as never)
        .type.toString()
    ).toBe('value');
  });

  test('a scope that declares the components any', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ x: 'any', y: 'any' });
    const e = ce.expr(['Dot', ['Tuple', 1, 2], ['Tuple', 'x', 'y']], {
      scope,
    });
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('value');
    expect(JSON.stringify(e.json)).toBe(
      '["Dot",["Tuple",1,2],["Tuple","x","y"]]'
    );
  });

  test('a symbol declared as a tuple of any', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<any, any>');
    expect(summary(ce.box(['Dot', ['Tuple', 1, 2], 'p']))).toEqual([
      true,
      'value',
    ]);
    expect(ce.box(['Norm', 'p']).isValid).toBe(true);
  });
});

// A structural type alias of a point type is read through its definition:
// `p` declared with an alias of `tuple<any, any>` is admitted where `p`
// declared `tuple<any, any>` is, and the call has the same type and value.
describe('A STRUCTURAL ALIAS of a tuple of any or of unknown', () => {
  function aliasEngine(cell: string, viaAlias: boolean): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('pt', `tuple<${cell}, ${cell}>`, { alias: true });
    ce.declareType('pt3', `tuple<${cell}, ${cell}, ${cell}>`, { alias: true });
    ce.declare('p', viaAlias ? 'pt' : `tuple<${cell}, ${cell}>`);
    ce.declare('q', viaAlias ? 'pt3' : `tuple<${cell}, ${cell}, ${cell}>`);
    return ce;
  }
  const ALIAS_CALLS: [string, unknown, string][] = [
    ['Dot', ['Dot', ['Tuple', 1, 2], 'p'], '11'],
    ['Cross', ['Cross', ['Tuple', 1, 2, 3], 'q'], '(-2, 4, -2)'],
    ['Norm', ['Norm', 'p'], '5'],
  ];
  const CASES = ['any', 'unknown'].flatMap((cell) =>
    ALIAS_CALLS.map(
      ([name, input, value]) => [cell, name, input, value] as const
    )
  );

  test.each(CASES)('tuple<%s>: %s', (cell, _, input, value) => {
    const viaAlias = aliasEngine(cell, true);
    const direct = aliasEngine(cell, false);
    const a = viaAlias.box(input as never);
    const d = direct.box(input as never);
    expect(a.isValid).toBe(true);
    expect(JSON.stringify(a.json)).not.toContain('Error');
    expect(a.type.toString()).toBe(d.type.toString());
    for (const ce of [viaAlias, direct]) {
      ce.assign('p', ce.tuple(3, 4));
      ce.assign('q', ce.tuple(3, 4, 5));
    }
    expect(a.evaluate().toString()).toBe(value);
    expect(d.evaluate().toString()).toBe(value);
  });

  test('an alias of a point that can be absent', () => {
    const ce = new ComputeEngine();
    ce.declareType('mpt', 'missing | tuple<number, number>', { alias: true });
    ce.declare('m', 'mpt');
    expect(ce.box(['Dot', ['Tuple', 1, 2], 'm']).isValid).toBe(true);
    expect(ce.box(['Norm', 'm']).isValid).toBe(true);
  });

  // A nominal type is not a subtype of its definition, so a point of a
  // nominal type is refused where a tuple is expected.
  test.each(['any', 'unknown'])('a nominal tuple<%s> stays refused', (cell) => {
    const ce = new ComputeEngine();
    ce.declareType('npt', `tuple<${cell}, ${cell}>`);
    ce.declare('n', 'npt');
    expect(ce.box(['Dot', ['Tuple', 1, 2], 'n']).isValid).toBe(false);
  });
});

// A self-referential alias meets itself inside its definition, through a
// union arm (`cyc`) or through a constructor (`json`, `nest`). The walk that
// reads each `any` cell as `unknown` counts the unfolds of each alias on its
// path, so it stops. Before that count, these operands overflowed the stack
// at boxing. None of these aliases has a point type, so each call is an
// `incompatible-type` error.
describe('A SELF-REFERENTIAL ALIAS at a stripped position', () => {
  function cyclicEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('cyc', 'cyc | 0', { alias: true });
    ce.declareType('json', 'list<json> | integer', { alias: true });
    ce.declareType('nest', 'list<nest> | integer', { alias: true });
    ce.declare('c', 'cyc');
    ce.declare('j', 'json');
    ce.declare('n', 'nest');
    return ce;
  }
  const CYCLIC_CALLS = ['c', 'j', 'n'].flatMap((s) => [
    [`Dot with ${s}`, ['Dot', ['Tuple', 1, 2], s]] as const,
    [`Norm of ${s}`, ['Norm', s]] as const,
  ]);

  test.each(CYCLIC_CALLS)('%s', (_, input) => {
    const ce = cyclicEngine();
    let e: Expression | undefined;
    expect(() => {
      e = ce.box(input as never);
    }).not.toThrow();
    expect(e!.isValid).toBe(false);
    expect(JSON.stringify(e!.json)).toContain('incompatible-type');
  });

  // An alias nested inside a constructor, and an alias of that alias, are
  // read through their definitions as before.
  test('an alias of a list of an alias of tuple<any, any> is admitted', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<any, any>', { alias: true });
    ce.declareType('pts', 'list<pt>', { alias: true });
    ce.declareType('wrap', 'pts', { alias: true });
    ce.declare('l', 'pts');
    ce.declare('w', 'wrap');
    for (const s of ['l', 'w']) {
      expect(summary(ce.box(['Dot', ['Tuple', 1, 2], s]))).toEqual([
        true,
        'value',
      ]);
      expect(summary(ce.box(['Norm', s]))).toEqual([true, 'list<number>']);
    }
  });
});

describe('FUNCTION ROUTE', () => {
  test.each(['any', 'unknown'])('components declared %s', (t) => {
    const ce = engine(t);
    const [x, y, z] = ['x', 'y', 'z'].map((s) => ce.symbol(s));
    const dot = ce.function('Dot', [ce.tuple(1, 2), ce.tuple(x, y)]);
    const cross = ce.function('Cross', [ce.tuple(1, 2, 3), ce.tuple(x, y, z)]);
    const norm = ce.function('Norm', [ce.tuple(x, y)]);
    expect(summary(dot)).toEqual([true, 'value']);
    expect(summary(cross)).toEqual([true, 'tuple<number, number, number>']);
    expect(summary(norm)).toEqual([true, '+oo | nan | real']);
  });
});

describe('PARSE ROUTE', () => {
  test.each([
    ['\\operatorname{Dot}((1,2),(x,y))', 'value'],
    ['\\operatorname{Cross}((1,2,3),(x,y,z))', 'tuple<number, number, number>'],
    ['\\Vert(x,y)\\Vert', '+oo | nan | real'],
    [
      '\\sin(\\operatorname{Dot}((16.234,35.4235),(x,y)))',
      'broadcastable<number>',
    ],
  ])('%s', (latex, type) => {
    const withAny = engine('any').parse(latex);
    expect(summary(withAny)).toEqual([true, type]);
    expect(summary(withAny)).toEqual(summary(engine('unknown').parse(latex)));
  });

  // `\cdot` between two points is a `Multiply`, which has no product of two
  // points: the parser answers an error that names `Dot`. The `any`
  // components get the same answer as `unknown` ones.
  test('a \\cdot between two points is the same error as with unknown', () => {
    const latex = '(1,2)\\cdot(x,y)';
    const withAny = engine('any').parse(latex);
    expect(JSON.stringify(withAny.json)).toContain('no-product-between-points');
    expect(JSON.stringify(withAny.json)).toBe(
      JSON.stringify(engine('unknown').parse(latex).json)
    );
  });
});

describe('EVALUATION', () => {
  // `Distance` with a free coordinate is an `expected-value` error whatever
  // the declared type of the coordinate (`exact-ordering-and-complex-parts.
  // test.ts` pins it), so it is compared with the `unknown` result only.
  test.each(CALLS)(
    'with no values, %s evaluates as with unknown',
    (_, input) => {
      const withAny = engine('any')
        .box(input as never)
        .evaluate();
      const withUnknown = engine('unknown')
        .box(input as never)
        .evaluate();
      expect(JSON.stringify(withAny.json)).toBe(
        JSON.stringify(withUnknown.json)
      );
    }
  );

  test('with no values, the call stays symbolic', () => {
    const ce = engine('any');
    for (const [name, input] of CALLS) {
      if (name === 'Distance') continue;
      const v = ce.box(input as never).evaluate();
      expect(v.isValid).toBe(true);
      expect(JSON.stringify(v.json)).not.toContain('Error');
    }
    expect(
      JSON.stringify(
        ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 'x', 'y']]).evaluate().json
      )
    ).toBe('["Dot",["Tuple",1,2],["Tuple","x","y"]]');
  });

  test('with assigned values, the call has a value', () => {
    const ce = engine('any');
    const dot = ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 'x', 'y']]);
    const cross = ce.box([
      'Cross',
      ['Tuple', 1, 2, 3],
      ['Tuple', 'x', 'y', 'z'],
    ]);
    const norm = ce.box(['Norm', ['Tuple', 'x', 'y']]);
    const dots = ce.box([
      'Dot',
      ['List', ['Tuple', 1, 2]],
      ['List', ['Tuple', 'x', 'y']],
    ]);
    const parsed = ce.parse('\\operatorname{Dot}((1,2),(x,y))');
    const distance = ce.box(['Distance', ['Tuple', 1, 2], ['Tuple', 'x', 'y']]);
    ce.assign('x', 3);
    ce.assign('y', 4);
    ce.assign('z', 5);
    expect(dot.evaluate().toString()).toBe('11');
    expect(parsed.evaluate().toString()).toBe('11');
    expect(cross.evaluate().toString()).toBe('(-2, 4, -2)');
    expect(norm.evaluate().toString()).toBe('5');
    expect(dots.evaluate().toString()).toBe('[11]');
    expect(distance.evaluate().toString()).toBe('2sqrt(2)');
  });

  test('an absent component makes the inner product NaN', () => {
    const ce = engine('any');
    const dot = ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 'x', 'y']]);
    ce.assign('x', ce.box('Missing'));
    ce.assign('y', 4);
    expect(dot.evaluate().toString()).toBe('NaN');
  });
});
