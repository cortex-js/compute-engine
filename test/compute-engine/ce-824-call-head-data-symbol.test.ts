import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// ROADMAP CE-824: a call `g(x)` that is boxed while `g` has no definition is
// valid. When `g` is then declared as a data symbol, the same call boxed again
// is the `expected-function` error. `D`, `Limit` and `NIntegrate` read their
// first operand without evaluating it, so they gave a value for the call that
// was boxed before the declaration. They now give the value of the same
// expression boxed after the declaration.

type Operator = 'D' | 'Limit' | 'NIntegrate';
type Route = 'parse' | 'box' | 'function';
type Json = Parameters<ComputeEngine['box']>[0];

const OPERATORS: Operator[] = ['D', 'Limit', 'NIntegrate'];

const LATEX: Record<Operator, string> = {
  D: '\\frac{d}{dx} g(x)',
  Limit: '\\lim_{x\\to 0} g(x)',
  NIntegrate: '\\operatorname{NIntegrate}(x \\mapsto g(x), 0, 1)',
};

const JSON_FORM: Record<Operator, unknown> = {
  D: ['D', ['g', 'x'], 'x'],
  Limit: ['Limit', ['Function', ['g', 'x'], 'x'], 0],
  NIntegrate: ['NIntegrate', ['Function', ['g', 'x'], 'x'], 0, 1],
};

function build(ce: ComputeEngine, op: Operator, route: Route): Expression {
  if (route === 'parse') return ce.parse(LATEX[op]);
  if (route === 'box') return ce.box(JSON_FORM[op] as Json);
  const call = ce.box(['g', 'x']);
  const literal = ce.box(['Function', ['g', 'x'], 'x']);
  if (op === 'D') return ce.function('D', [call, ce.symbol('x')]);
  if (op === 'Limit') return ce.function('Limit', [literal, ce.number(0)]);
  return ce.function('NIntegrate', [literal, ce.number(0), ce.number(1)]);
}

function errorCode(e: Expression): unknown {
  const json = e.json as unknown[];
  expect(json[0]).toBe('Error');
  return json[1];
}

const EXPECTED_FUNCTION = ['ErrorCode', "'expected-function'", "'g'", "'real'"];

describe('CE-824: a call head defined later as a data symbol', () => {
  for (const op of OPERATORS) {
    for (const route of ['parse', 'box', 'function'] as const) {
      test(`${op} reports expected-function (${route} route)`, () => {
        const ce = new ComputeEngine();
        const e = build(ce, op, route);
        ce.declare('g', 'real');
        ce.assign('g', 5);
        expect(errorCode(e.evaluate())).toEqual(EXPECTED_FUNCTION);
        expect(errorCode(e.N())).toEqual(EXPECTED_FUNCTION);
      });
    }

    test(`${op} gives the value of the expression boxed after the declaration`, () => {
      const before = new ComputeEngine();
      const e = build(before, op, 'box');
      before.declare('g', 'real');
      before.assign('g', 5);

      const after = new ComputeEngine();
      after.declare('g', 'real');
      after.assign('g', 5);
      const reference = build(after, op, 'box');

      expect(e.evaluate().json).toEqual(reference.evaluate().json);
      expect(e.N().json).toEqual(reference.N().json);
    });

    test(`${op} reports the error for a head declared with no value`, () => {
      const ce = new ComputeEngine();
      const e = build(ce, op, 'box');
      ce.declare('g', 'real');
      expect(errorCode(e.evaluate())).toEqual(EXPECTED_FUNCTION);
      expect(errorCode(e.N())).toEqual(EXPECTED_FUNCTION);
    });
  }

  test('D reports the error after it gave a derivative for the undefined head', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['D', ['g', 'x'], 'x']);
    expect(e.evaluate().json).toEqual(['Apply', ['Derivative', 'g', 1], 'x']);
    ce.declare('g', 'real');
    expect(errorCode(e.evaluate())).toEqual(EXPECTED_FUNCTION);
  });

  test('the call can be a term of the operand', () => {
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Add', ['g', 'x'], ['Sin', 'x']], 'x']);
    const limit = ce.parse('\\lim_{x\\to 0} (g(x) + x)');
    ce.declare('g', 'real');
    expect(errorCode(d.evaluate())).toEqual(EXPECTED_FUNCTION);
    expect(errorCode(limit.evaluate())).toEqual(EXPECTED_FUNCTION);
  });

  // `Limit` and `NIntegrate` read the operand at sample points, and the call
  // is in a branch that no sample reaches. The expression boxed after the
  // declaration holds the error in that branch and still has a value, so the
  // expression boxed before the declaration keeps it too.
  test('Limit and NIntegrate keep the value when no sample reaches the call', () => {
    const ce = new ComputeEngine();
    const branch = ['If', ['Greater', 'x', 2], ['g', 'x'], ['Power', 'x', 'x']];
    const integral = ce.box(['NIntegrate', ['Function', branch, 'x'], 0, 1]);
    const limit = ce.box(['Limit', ['Function', branch, 'x'], 0]);
    ce.declare('g', 'real');
    ce.assign('g', 5);
    expect(integral.evaluate().re).toBeCloseTo(0.7834305107, 8);
    expect(integral.N().re).toBeCloseTo(0.7834305107, 8);
    expect(limit.N().re).toBeCloseTo(1, 8);
  });

  // The call `h(x)` is bound to the function `h` of the scope where it was
  // boxed. A data symbol `h` declared in a scope pushed later is another
  // binding, and does not make the call an error.
  test('a data symbol of the same name in a later scope does not change a call', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Multiply', 't', 't'], 't']));
    const d = ce.box(['D', ['h', 'x'], 'x']);
    ce.pushScope();
    try {
      ce.declare('h', 'real');
      expect(d.evaluate().json).toEqual(['Multiply', 2, 'x']);
    } finally {
      ce.popScope();
    }
  });

  test('a head that becomes a function is called', () => {
    const ce = new ComputeEngine();
    const d = build(ce, 'D', 'box');
    const limit = build(ce, 'Limit', 'box');
    const integral = build(ce, 'NIntegrate', 'box');
    ce.assign('g', ce.box(['Function', ['Multiply', 't', 't'], 't']));
    expect(d.evaluate().json).toEqual(['Multiply', 2, 'x']);
    expect(limit.evaluate().json).toEqual(0);
    expect(integral.evaluate().re).toBeCloseTo(1 / 3, 10);
  });

  // An assignment with no declaration gives the head an inferred type, and
  // a call of such a head is not an error when it is boxed.
  test('a head with an inferred type is not an error', () => {
    const ce = new ComputeEngine();
    const d = build(ce, 'D', 'box');
    ce.assign('g', 5);
    expect(d.evaluate().json).toEqual(['Apply', ['Derivative', 'g', 1], 'x']);
  });

  // A collection can be applied (`S(B)` with `S` declared `set<number>`), so
  // the call boxed after the declaration is valid.
  test('a head declared as a collection is not an error', () => {
    const ce = new ComputeEngine();
    const d = build(ce, 'D', 'box');
    ce.declare('g', 'set<number>');
    expect(d.evaluate().json).toEqual(['Apply', ['Derivative', 'g', 1], 'x']);
  });

  test('an engine that is not strict reports no error', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    const d = build(ce, 'D', 'box');
    ce.declare('g', 'real');
    expect(d.evaluate().json).toEqual(['Apply', ['Derivative', 'g', 1], 'x']);
  });

  // The parameter `g` of the inner function literal is bound in the literal:
  // the declaration of a global `g` does not change the call of the parameter.
  test('a call of a parameter with the name of the data symbol is kept', () => {
    const ce = new ComputeEngine();
    const d = ce.box([
      'D',
      ['Apply', ['Function', ['g', 'x'], 'g'], 'Sin'],
      'x',
    ]);
    ce.declare('g', 'real');
    ce.assign('g', 5);
    expect(d.evaluate().json).toEqual(['Cos', 'x']);
  });
});
