import { ComputeEngine } from '../../src/compute-engine';

//
// A collection-first callback operator (`Filter`, `Reduce`, `TakeWhile`,
// ...) called with a function as its first operand (the callback first, the
// collection second) refuses the function at the collection slot, as the
// eager `Sort(x ↦ x, xs)` does: the call is canonical, invalid, and typed
// `error`. Before, the call was kept as written, not canonical. As an
// operand of a canonical `Add` it reached `toNumericValue()`, whose
// `console.assert` requires a canonical expression, and in the body of a
// function it was broadcast over the elements of the list bound to `xs`.
//

const P = ['Function', ['Greater', 'x', 0], 'x'];
const R = ['Function', ['Add', 'a', 'x'], 'a', 'x'];

let failedAssertions: string[] = [];
const originalAssert = console.assert;
beforeEach(() => {
  failedAssertions = [];
  console.assert = (condition?: boolean, ...data: unknown[]) => {
    if (!condition) failedAssertions.push(data.map(String).join(' '));
  };
});
afterEach(() => {
  console.assert = originalAssert;
});

const errorOf = (json: unknown): unknown =>
  Array.isArray(json) && json[0] === 'Error' ? json[1] : undefined;

describe('A COLLECTION-FIRST CALLBACK OPERATOR WITH ITS OPERANDS IN THE WRONG ORDER', () => {
  test('`Apply(xs ↦ 1 + Filter(p, xs), [1, 4])` is a type error, with no failed assertion', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box([
        'Apply',
        ['Function', ['Add', 1, ['Filter', P, 'xs']], 'xs'],
        ['List', 1, 4],
      ])
      .evaluate();
    expect(failedAssertions).toEqual([]);
    expect(errorOf(v.json)).toEqual([
      'ErrorCode',
      "'incompatible-type'",
      "'collection'",
      "'(x: unknown) -> boolean'",
    ]);
  });

  test('`Filter(p, [1, 4])` is canonical and refuses the function at the collection slot', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Filter', P, ['List', 1, 4]]);
    expect(e.isCanonical).toBe(true);
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toBe(
      'Filter(Error(ErrorCode("incompatible-type", "collection", "(x: unknown) -> boolean"), (x) => 0 < x), [1,4])'
    );
    expect(failedAssertions).toEqual([]);
  });

  const calls: Record<string, unknown[]> = {
    Filter: ['Filter', P, 'xs'],
    Reduce: ['Reduce', R, 'xs', 0],
    Scan: ['Scan', R, 'xs'],
    TakeWhile: ['TakeWhile', P, 'xs'],
    DropWhile: ['DropWhile', P, 'xs'],
    FlatMap: ['FlatMap', ['Function', ['List', 'x'], 'x'], 'xs'],
    MaxBy: ['MaxBy', P, 'xs'],
  };
  for (const [op, call] of Object.entries(calls)) {
    test(`\`1 + ${op}(callback, xs)\` in the body of a function is a type error`, () => {
      const ce = new ComputeEngine();
      const e = ce.box([
        'Apply',
        ['Function', ['Add', 1, call], 'xs'],
        ['List', 1, 4],
      ] as Parameters<typeof ce.box>[0]);
      expect(e.isValid).toBe(false);
      const v = e.evaluate();
      expect(failedAssertions).toEqual([]);
      const code = errorOf(v.json) as unknown[] | undefined;
      expect(code?.[1]).toBe("'incompatible-type'");
      expect(String(code?.[2])).toMatch(/collection/);
    });
  }

  test('`1 + Fold(xs, 0, f)` in the body of a function refuses the function at the collection slot', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box([
        'Apply',
        ['Function', ['Add', 1, ['Fold', 'xs', 0, R]], 'xs'],
        ['List', 1, 4],
      ])
      .evaluate();
    expect(failedAssertions).toEqual([]);
    expect(errorOf(v.json)).toEqual([
      'ErrorCode',
      "'incompatible-type'",
      "'collection'",
      "'(a: unknown, x: unknown) -> number'",
    ]);
  });

  test('`1 + Map(t, f)` with `t` undeclared refuses the function at the collection slot', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box(['Add', 1, ['Map', 't', ['Function', ['Multiply', 'x', 2], 'x']]])
      .evaluate();
    expect(failedAssertions).toEqual([]);
    expect((errorOf(v.json) as unknown[])[2]).toBe("'collection'");
  });

  // A function is never a collection: the refusal does not depend on the
  // operand at the callback slot, or on when a symbol there is declared.
  test('`1 + Map(Sin, Cos)` refuses `Cos` at the collection slot', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Add', 1, ['Map', 'Sin', 'Cos']]);
    expect(e.isCanonical).toBe(true);
    expect(e.isValid).toBe(false);
    const v = e.evaluate();
    expect(failedAssertions).toEqual([]);
    expect((errorOf(v.json) as unknown[])[2]).toBe("'collection'");
  });

  test('`Map(h, h)` and `Fold(R, 0, Cos)` refuse the function at the collection slot', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(real) -> real');
    for (const call of [
      ['Map', 'h', 'h'],
      ['Fold', R, 0, 'Cos'],
    ]) {
      const e = ce.box(call as Parameters<typeof ce.box>[0]);
      expect(e.isCanonical).toBe(true);
      expect(e.isValid).toBe(false);
    }
  });

  test('`Map(t, Cos)` has the same canonical form before and after `t` is declared a function', () => {
    const ce = new ComputeEngine();
    const before = ce.box(['Map', 't', 'Cos']).toString();
    ce.declare('t', '(real) -> real');
    const after = ce.box(['Map', 't', 'Cos']).toString();
    expect(after).toBe(before);
    expect(after).toMatch(/^Map\(t, Error\(ErrorCode\("incompatible-type", "collection"/);
  });

  test('parse route: a misordered `Filter` with a lambda refuses the lambda', () => {
    const ce = new ComputeEngine();
    const e = ce.parse(
      '\\operatorname{Filter}(x\\mapsto x>0, \\lbrack 1,4\\rbrack)'
    );
    expect(e.operator).toBe('Filter');
    expect(e.isValid).toBe(false);
    expect(e.isCanonical).toBe(true);
    expect(String(e.op1.json)).toMatch(/Error/);
    expect(JSON.stringify(e.op1.json)).toContain("'collection'");
    e.evaluate();
    expect(failedAssertions).toEqual([]);
  });

  test('a callback-first operator keeps its own report: `Map([1, 4], f)`', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Map', ['List', 1, 4], ['Function', ['Add', 'x', 1], 'x']]);
    expect(e.toString()).toBe(
      'Map(Error(ErrorCode("incompatible-type", "function", "vector<integer^2>"), [1,4]), (x) => x + 1)'
    );
    expect(failedAssertions).toEqual([]);
  });

  // `ArgMax(f, domain)` and `ArgMin(f, domain)` are the optimization form:
  // a function and a set (or a domain whose type is not decided yet). They
  // stay inert, the same for a function literal and for a function symbol.
  test('the optimization form `ArgMax(Sin, RealNumbers)` stays valid and inert', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['ArgMax', 'Sin', 'RealNumbers']);
    expect(e.isCanonical).toBe(true);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().isSame(e)).toBe(true);
    expect(failedAssertions).toEqual([]);
  });

  test('the optimization form with a declared function and set: `ArgMax(g, D)`, `ArgMin(g, D)`', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real) -> real');
    ce.declare('D', 'set<real>');
    for (const op of ['ArgMax', 'ArgMin']) {
      const e = ce.box([op, 'g', 'D']);
      expect(e.isCanonical).toBe(true);
      expect(e.isValid).toBe(true);
      expect(e.evaluate().isSame(e)).toBe(true);
    }
    expect(failedAssertions).toEqual([]);
  });

  test('the optimization form with an undeclared domain: `ArgMax(x ↦ x², T)` does not declare `T`', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['ArgMax', ['Function', ['Square', 'x'], 'x'], 'T']);
    expect(e.isCanonical).toBe(true);
    expect(e.isValid).toBe(true);
    expect(ce.lookupDefinition('T')).toBeUndefined();
    expect(failedAssertions).toEqual([]);
  });

  test('the optimization form with a function variable that holds an operator: `g := Sin`, `ArgMax(g, RealNumbers)`', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.symbol('Sin'));
    const e = ce.box(['ArgMax', 'g', 'RealNumbers']);
    expect(e.isValid).toBe(true);
    const v = e.evaluate();
    expect(v.isValid).toBe(true);
    expect(v.operator).toBe('ArgMax');
    expect(failedAssertions).toEqual([]);
  });

  test('parse route: the optimization form `ArgMax(\\sin, \\R)` stays valid and inert', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\operatorname{ArgMax}(\\sin, \\R)');
    expect(e.json).toEqual(['ArgMax', 'Sin', 'RealNumbers']);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().isSame(e)).toBe(true);
    expect(failedAssertions).toEqual([]);
  });

  test('the optimization form with a function-valued call: `ArgMax(Derivative(Sin), RealNumbers)`', () => {
    const ce = new ComputeEngine();
    for (const op of ['ArgMax', 'ArgMin']) {
      const e = ce.box([op, ['Derivative', 'Sin'], 'RealNumbers']);
      expect(e.isCanonical).toBe(true);
      expect(e.isValid).toBe(true);
      expect(e.evaluate().isSame(e)).toBe(true);
    }
    expect(failedAssertions).toEqual([]);
  });

  test("parse route: the optimization form `ArgMax(\\sin', \\R)` stays valid", () => {
    const ce = new ComputeEngine();
    const e = ce.parse("\\operatorname{ArgMax}(\\sin', \\R)");
    expect(e.json).toEqual(['ArgMax', ['Derivative', 'Sin'], 'RealNumbers']);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().isSame(e)).toBe(true);
  });

  test('a symbol whose function type is inferred from its value is not the optimization form', () => {
    // `h` is declared `unknown`: `ArgMax(h, x ↦ -x)` is the collection
    // form. After `h` is assigned `Sin`, the evaluation reads `h` as the
    // source of the collection form and refuses it, as `ArgMax(h)` does.
    const ce = new ComputeEngine();
    ce.declare('h', 'unknown');
    const e = ce.box(['ArgMax', 'h', ['Function', ['Negate', 'x'], 'x']]);
    ce.assign('h', ce.symbol('Sin'));
    for (const v of [e.evaluate(), ce.box(['ArgMax', 'h']).evaluate()]) {
      const code = errorOf(v.json) as unknown[] | undefined;
      expect(code?.[1]).toBe("'incompatible-type'");
    }
  });

  test('the collection form of `ArgMax` still evaluates', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['ArgMax', ['List', 3, 1, 2]]).evaluate().toString()).toBe('1');
  });

  test('the operands in the right order still evaluate', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box(['Filter', ['List', -1, 4, 2], P])
      .evaluate({ materialization: true });
    expect(v.toString()).toBe('[4,2]');
    expect(failedAssertions).toEqual([]);
  });
});
