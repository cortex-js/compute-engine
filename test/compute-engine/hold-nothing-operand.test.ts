/**
 * A held operand keeps `Nothing` as written.
 *
 * `Hold` is the quoting operator: its operand is boxed but not
 * canonicalized. `ce.box()` of a `Hold` boxed the operand with `boxHold()`,
 * which first replaced every operand that was "empty" (`null`, `Nothing` or
 * `Sequence()`) with `Error('missing')`, at every depth. So
 * `ce.box(['Hold', ['List', 1, 'Nothing']])` was
 * `Hold(List(1, Error('missing')))`, while `ce.function('Hold', [raw])` of
 * the same operand kept `Nothing`. Now only an absent operand (`['Hold']`,
 * or a `null` hole) is reported as missing. `Nothing` is erased only when
 * `ReleaseHold` canonicalizes the operand, as it is when the operand is
 * boxed directly.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const INDEFINITE: MathJsonExpression = [
  'Integrate',
  ['Power', 'k', 2],
  ['Limits', 'k', 'Nothing', 'Nothing'],
];

describe('Hold keeps a Nothing operand as written', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('Hold(Nothing)', () => {
    expect(ce.box(['Hold', 'Nothing']).json).toEqual(['Hold', 'Nothing']);
  });

  test('Hold(List(1, Nothing))', () => {
    expect(ce.box(['Hold', ['List', 1, 'Nothing']]).json).toEqual([
      'Hold',
      ['List', 1, 'Nothing'],
    ]);
  });

  test('Hold of an indefinite integral keeps its Nothing bounds', () => {
    expect(ce.box(['Hold', INDEFINITE]).json).toEqual(['Hold', INDEFINITE]);
  });

  test('Hold(Sequence()) is kept as written', () => {
    expect(ce.box(['Hold', ['Sequence']]).json).toEqual([
      'Hold',
      ['Sequence'],
    ]);
  });

  test('the raw and structural forms keep Nothing too', () => {
    expect(ce.box(['Hold', ['List', 1, 'Nothing']], { form: 'raw' }).json)
      .toEqual(['Hold', ['List', 1, 'Nothing']]);
    expect(
      ce.box(['Hold', ['List', 1, 'Nothing']], { form: 'structural' }).json
    ).toEqual(['Hold', ['List', 1, 'Nothing']]);
  });

  test('an absent operand is still reported as missing', () => {
    expect(ce.box(['Hold']).json).toEqual(['Hold', ['Error', "'missing'"]]);
    expect(ce.parse('\\operatorname{Hold}()').json).toEqual([
      'Hold',
      ['Error', "'missing'"],
    ]);
  });
});

describe('controls', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('ce.function of Hold with a raw operand keeps Nothing', () => {
    const held = ce.function('Hold', [
      ce.box(['f', 'Nothing'], { form: 'raw' }),
    ]);
    expect(held.json).toEqual(['Hold', ['f', 'Nothing']]);
  });

  test('canonical boxing keeps Nothing in arguments and lists', () => {
    expect(ce.box(['f', 'Nothing']).json).toEqual(['f', 'Nothing']);
    expect(ce.box(['List', 1, 'Nothing']).json).toEqual([
      'List',
      1,
      'Nothing',
    ]);
  });

  test('canonical Integrate keeps the Nothing bounds', () => {
    const integral = ce.box(INDEFINITE);
    expect(integral.operator).toBe('Integrate');
    expect(integral.ops![1].json).toEqual([
      'Limits',
      'k',
      'Nothing',
      'Nothing',
    ]);
  });

  test('a parsed held integral', () => {
    expect(ce.parse('\\operatorname{Hold}(\\int k^2 dk)').json).toEqual([
      'Hold',
      ['Integrate', ['Power', 'k', 2], 'k'],
    ]);
  });
});

describe('ReleaseHold gives the result of boxing the operand directly', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  const cases: [string, MathJsonExpression][] = [
    ['Nothing', 'Nothing'],
    ['List(1, Nothing)', ['List', 1, 'Nothing']],
    ['f(Nothing)', ['f', 'Nothing']],
    ['indefinite integral', INDEFINITE],
  ];

  test.each(cases)('%s', (_label, operand) => {
    const released = ce.box(['ReleaseHold', ['Hold', operand]]).evaluate();
    const direct = ce.box(operand).evaluate();
    expect(released.json).toEqual(direct.json);
  });

  test('the released list keeps Nothing', () => {
    expect(
      ce.box(['ReleaseHold', ['Hold', ['List', 1, 'Nothing']]]).evaluate().json
    ).toEqual(['List', 1, 'Nothing']);
  });
});

describe('Hold inside a Function literal', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('the function literal keeps Nothing in its held body', () => {
    expect(
      ce.box(['Function', ['Hold', ['List', 'x', 'Nothing']], 'x']).json
    ).toEqual(['Function', ['Block', ['Hold', ['List', 'x', 'Nothing']]], 'x']);
  });

  test('applying it substitutes the argument and keeps Nothing', () => {
    const fn = ce.box(['Function', ['Hold', ['List', 'x', 'Nothing']], 'x']);
    expect(ce.box(['Apply', fn.json, 3]).evaluate().json).toEqual([
      'Hold',
      ['List', 3, 'Nothing'],
    ]);
    expect(
      ce.function('Apply', [
        ce.box(['Function', ['Hold', ['f', 'x', 'Nothing']], 'x']),
        ce.box(3),
      ]).evaluate().json
    ).toEqual(['Hold', ['f', 3, 'Nothing']]);
  });

  test('a held indefinite integral in a function body', () => {
    const fn: MathJsonExpression = [
      'Function',
      ['Hold', ['Integrate', ['Power', 'k', 'n'], ['Limits', 'k', 'Nothing', 'Nothing']]],
      'n',
    ];
    expect(ce.box(['Apply', fn, 2]).evaluate().json).toEqual([
      'Hold',
      INDEFINITE,
    ]);
  });
});

/**
 * `Hold` takes one operand. `boxFunction()` kept only the first one and
 * dropped the others with no error, so `Hold(x, 1)` was the valid `Hold(x)`,
 * on both `ce.box()` and `ce.function()`. Each extra operand is now an
 * `unexpected-argument` error, as for any other operator.
 */
describe('Hold reports an extra operand', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('control: Sin(1, 2)', () => {
    expect(ce.box(['Sin', 1, 2]).json).toEqual([
      'Sin',
      1,
      ['Error', "'unexpected-argument'", "'2'"],
    ]);
  });

  test('ce.box(Hold(x, 1))', () => {
    const e = ce.box(['Hold', 'x', 1]);
    expect(e.json).toEqual([
      'Hold',
      'x',
      ['Error', "'unexpected-argument'", "'1'"],
    ]);
    expect(e.isValid).toBe(false);
  });

  test('ce.function(Hold, [x, 1])', () => {
    const e = ce.function('Hold', [ce.symbol('x'), ce.number(1)]);
    expect(e.json).toEqual([
      'Hold',
      'x',
      ['Error', "'unexpected-argument'", "'1'"],
    ]);
    expect(e.isValid).toBe(false);
  });

  test('Hold(Nothing, 1) keeps Nothing and reports the 1', () => {
    expect(ce.box(['Hold', 'Nothing', 1]).json).toEqual([
      'Hold',
      'Nothing',
      ['Error', "'unexpected-argument'", "'1'"],
    ]);
  });

  test('one operand is valid', () => {
    expect(ce.box(['Hold', 'x']).isValid).toBe(true);
    expect(ce.box(['Hold', ['f', 'Nothing', 2]]).isValid).toBe(true);
  });
});

/**
 * A `Hold` with an extra operand stays not valid through `evaluate()`,
 * equality and the structural rebind. Its handlers read only the first
 * operand, so `Hold(x, 1).evaluate()` was the valid `Hold(x)`, and
 * `Hold(x, 1)` was equal to `Hold(x)`.
 */
describe('a Hold with an extra operand stays not valid', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('evaluate() keeps the error', () => {
    const e = ce.box(['Hold', 'x', 1]).evaluate();
    expect(e.isValid).toBe(false);
    expect(e.json).toEqual([
      'Hold',
      'x',
      ['Error', "'unexpected-argument'", "'1'"],
    ]);
  });

  test('control: a valid Hold evaluates to itself', () => {
    expect(ce.box(['Hold', ['Add', 1, 2]]).evaluate().json).toEqual([
      'Hold',
      ['Add', 1, 2],
    ]);
  });

  test('isEqual() is false against the valid Hold', () => {
    expect(ce.box(['Hold', 'x', 1]).isEqual(ce.box(['Hold', 'x']))).toBe(
      false
    );
    expect(ce.box(['Hold', 'x']).isEqual(ce.box(['Hold', 'x', 1]))).toBe(
      false
    );
    expect(ce.box(['Hold', 'x']).isEqual(ce.box(['Hold', 'x']))).toBe(true);
  });

  test('the structural form keeps the held content as written', () => {
    const json: MathJsonExpression = [
      'Hold',
      ['Add', 'x', ['Multiply', 2, 'x']],
      1,
    ];
    const e = ce.box(json, { form: 'structural' });
    expect(e.op1.isStructural).toBe(false);
    expect(e.json).toEqual(ce.box(e.json, { form: 'structural' }).json);
  });
});
