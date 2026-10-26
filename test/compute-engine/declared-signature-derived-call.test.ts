/**
 * The type of a call of a function symbol, on the three routes: the boxed
 * call (`ce.box`), the parsed call (`ce.parse`), and the derivation from
 * operand types (`deriveApplicationType`, which types a call in the body of
 * another function).
 *
 * - with `k` declared `(tuple<number, number>) -> number`,
 *   the boxed `k(3)` is typed `error`, because the call checks its argument
 *   against the declared signature, but the derived `k(3)` was `number`.
 * - the boxed `k(P)` for a list of points `P` maps over the
 *   points and is a `list<number>`, but the derived `k(P)` was `number`.
 * - with `h(a, t) := a[1] + a[2] + t`, a partial application
 *   evaluates the body with the given argument. When that body is an error,
 *   the value is the error, and the type is now `error` too, not the
 *   function of `t`. The map over a list of points before the partial
 *   application is kept: `h([(1, 2), (3, 4)])` is a list of two functions.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

function derived(ce: ComputeEngine, op: string, types: string[]): string {
  const t = deriveApplicationType(
    ce,
    op,
    types.map((x) => describeType(parseType(x)))
  );
  return t === undefined ? 'undefined' : typeToString(t);
}

function engineWithK(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('k', '(tuple<number, number>) -> number');
  ce.assign('k', ce.parse('(p) \\mapsto p[1] + p[2]'));
  return ce;
}

describe('A DERIVED CALL CHECKS A DECLARED SIGNATURE', () => {
  const ce = engineWithK();

  test.each([
    'integer',
    'real',
    'boolean',
    'nan',
    'string',
    'list<integer>',
    'vector<integer^2>',
    'tuple<number, number, number>',
    'missing',
    'integer | missing',
    'real | boolean',
    'set<tuple<integer, integer>>',
  ])('k over %s is error on the derived route', (t) => {
    expect(derived(ce, 'k', [t])).toBe('error');
  });

  test.each([
    ['tuple<integer, integer>', 'number'],
    ['tuple<integer, integer> | missing', 'number'],
    ['number | tuple<integer, integer>', 'number'],
    ['unknown', 'number'],
  ])('k over %s is not refused on the derived route', (t, expected) => {
    expect(derived(ce, 'k', [t])).toBe(expected);
  });

  test('the box and the parse routes agree', () => {
    expect(ce.box(['k', 3]).type.toString()).toBe('error');
    expect(ce.box(['k', 'True']).type.toString()).toBe('error');
    expect(ce.parse('k(3)').type.toString()).toBe('error');
    expect(ce.parse('k([1, 2])').type.toString()).toBe('error');
    expect(ce.parse('k((1, 2))').type.toString()).toBe('number');
  });

  test('a call in the body of another function is refused', () => {
    // `F(3)` is typed from the body of `F`, where `k(q)` is derived with `q`
    // typed `integer`. Its value is the error of `k(3)`.
    ce.box([
      'Assign',
      'F',
      ['Function', ['Add', ['k', 'q'], 1], 'q'],
    ]).evaluate();
    const call = ce.parse('F(3)');
    expect(call.type.toString()).toBe('error');
    expect(call.evaluate().type.toString()).toBe('error');
    expect(ce.parse('F((1, 2))').type.toString()).toBe('number');
    expect(ce.parse('F((1, 2))').evaluate().toString()).toBe('4');
  });

  test('a scalar parameter refuses a value of another kind', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('g', '(real) -> real');
    ce2.assign('g', ce2.parse('(x) \\mapsto x + 1'));
    expect(derived(ce2, 'g', ['boolean'])).toBe('error');
    expect(derived(ce2, 'g', ['list<string>'])).toBe('error');
    expect(derived(ce2, 'g', ['tuple<boolean, boolean>'])).toBe('error');
    // A number, a list of numbers and a union with a number arm are not
    // refused.
    expect(derived(ce2, 'g', ['complex'])).toBe('real');
    expect(derived(ce2, 'g', ['list<integer>'])).toBe('list<real>');
    expect(derived(ce2, 'g', ['real | boolean'])).toBe('real');
    expect(ce2.box(['g', 'True']).type.toString()).toBe('error');
  });

  test('an inferred signature is not a contract', () => {
    // `d` has no declared signature: its parameter type
    // `tuple<number, number>` was inferred from the index reads, and the
    // call binds the argument whole (`inferredCallSignature`).
    const ce2 = new ComputeEngine();
    ce2.parse('d(a) \\coloneq a[1] + a[2]').evaluate();
    expect(derived(ce2, 'd', ['list<integer>'])).not.toBe('error');
    expect(ce2.parse('d([1, 2])').evaluate().toString()).toBe('3');
  });
});

describe('A DERIVED CALL MAPS A LIST OF POINTS AT A DECLARED POINT PARAMETER', () => {
  const ce = engineWithK();
  ce.declare('P', 'list<tuple<integer, integer>>');

  test.each([
    ['list<tuple<integer, integer>>', 'list<number>'],
    ['list<list<tuple<integer, integer>>>', 'list<list<number>>'],
    ['list<tuple<integer, integer> | missing>', 'list<missing | number>'],
    [
      'tuple<integer, integer> | list<tuple<integer, integer>>',
      'list<number> | number',
    ],
  ])('k over %s is %s on the derived route', (t, expected) => {
    expect(derived(ce, 'k', [t])).toBe(expected);
  });

  test('the derived route agrees with the box and parse routes', () => {
    expect(ce.box(['k', 'P']).type.toString()).toBe('list<number>');
    expect(derived(ce, 'k', ['list<tuple<integer, integer>>'])).toBe(
      ce.box(['k', 'P']).type.toString()
    );
    const call = ce.parse('k([(1, 2), (3, 4)])');
    expect(call.type.toString()).toBe('list<number>');
    expect(call.evaluate().toString()).toBe('[3,7]');
  });

  test('with a second parameter', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('m', '(tuple<number, number>, real) -> real');
    ce2.assign('m', ce2.parse('(p, t) \\mapsto p[1] + t'));
    expect(derived(ce2, 'm', ['list<tuple<integer, integer>>', 'real'])).toBe(
      'list<real>'
    );
    expect(derived(ce2, 'm', ['integer', 'real'])).toBe('error');
    expect(ce2.parse('m([(1, 2), (3, 4)], 10)').evaluate().toString()).toBe(
      '[11,13]'
    );
  });

  test('a function literal with an annotated point parameter', () => {
    // The literal is held by an operator definition whose signature is not
    // inferred: the derived route maps over the points, as the boxed one.
    const ce2 = new ComputeEngine();
    ce2
      .box([
        'Assign',
        'w',
        [
          'Function',
          ['Add', ['At', 'p', 1], ['At', 'p', 2]],
          ['Typed', 'p', "'tuple<number, number>'"],
        ],
      ])
      .evaluate();
    ce2.declare('P', 'list<tuple<integer, integer>>');
    expect(ce2.box(['w', 'P']).type.toString()).toBe('list<number>');
    expect(derived(ce2, 'w', ['list<tuple<integer, integer>>'])).toBe(
      'list<number>'
    );
    expect(derived(ce2, 'w', ['list<list<tuple<integer, integer>>>'])).toBe(
      'list<list<number>>'
    );
    expect(derived(ce2, 'w', ['integer'])).toBe('error');
  });
});

describe('A PARTIAL APPLICATION WHOSE BODY IS AN ERROR IS TYPED ERROR', () => {
  const ce = new ComputeEngine();
  ce.parse('h(a, t) \\coloneq a[1] + a[2] + t').evaluate();

  test('the box route', () => {
    // `h("ab")` evaluates `"a" + "b" + t`, which is an error.
    const call = ce.box(['h', { str: 'ab' }]);
    expect(call.type.toString()).toBe('error');
    expect(call.evaluate().type.toString()).toBe('error');
  });

  test('the parse route', () => {
    const call = ce.parse('h(\\text{ab})');
    expect(call.type.toString()).toBe('error');
    expect(call.evaluate().type.toString()).toBe('error');
  });

  test('the derived route', () => {
    expect(derived(ce, 'h', ['string'])).toBe('error');
    // A call in the body of another function.
    ce.box(['Assign', 'G', ['Function', ['h', 's'], 's']]).evaluate();
    const call = ce.box(['G', { str: 'ab' }]);
    expect(call.type.toString()).toBe('error');
    expect(call.evaluate().type.toString()).toBe('error');
  });

  test('a partial application that is a function keeps its type', () => {
    expect(ce.parse('h((1, 2))').type.toString()).toBe(
      '(t: unknown) -> number'
    );
    expect(ce.parse('h((1, 2))').evaluate().toString()).toBe('(_) => _ + 3');
    expect(derived(ce, 'h', ['tuple<integer, integer>'])).toBe(
      '(t: unknown) -> number'
    );
  });

  test('the point-list map before the partial application stays', () => {
    const call = ce.parse('h([(1, 2), (3, 4)])');
    expect(call.type.toString()).toBe('list<(t: unknown) -> number>');
    expect(call.evaluate().toString()).toBe('[(_) => _ + 3,(_) => _ + 7]');
    expect(derived(ce, 'h', ['list<tuple<integer, integer>>'])).toBe(
      'list<(t: unknown) -> number>'
    );
  });

  test('a body with an effect is not evaluated by a partial application', () => {
    // The partial application of a function with an effect does not run the
    // body: its value is a function, whatever the argument.
    const ce2 = new ComputeEngine();
    ce2
      .box([
        'Assign',
        'eff',
        [
          'Function',
          ['Block', ['Print', 't'], ['Add', ['At', 'a', 1], 't']],
          'a',
          't',
        ],
      ])
      .evaluate();
    const call = ce2.box(['eff', { str: 'ab' }]);
    expect(call.type.toString()).not.toBe('error');
    expect(call.evaluate().operator).toBe('Function');
  });
});
