import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-670: a `List` or `Set` literal that holds a failed cell (an
// `Error` element) evaluates its other cells, and the failed cell stays in
// place (`docs/ERROR-MODEL.md` §3: the error is a failure of that cell, not
// of the container). So `.N()` approximates an integral in another cell of
// the list, as it does in a list with no failed cell. The failed cell itself
// is not evaluated: `[a, ln("b")]` keeps the cell `ln(Error(…))`.
//
// Before the fix, the literal froze before its handler ran: no cell was
// evaluated. `(y·[I, "a"]).N()` gave `[y·I, Error(…)]` with the integral
// `I` unevaluated, and `[a, Error(…)]` stayed `[a, Error(…)]` with `a := 5`.
// A set comprehension with a failed cell still stays as it is.

// An integral that `evaluate()` leaves unevaluated, and `.N()` computes.
const I = ['Integrate', ['Power', 'x', 'x'], ['Limits', 'x', 0, 1]];
const J = ['Integrate', ['Sin', ['Power', 'x', 2]], ['Limits', 'x', 0, 1]];

// The value of the integral of x^x from 0 to 1 (Sophomore's dream).
const I_VALUE = 0.7834305107121344;

const ce = new ComputeEngine();
ce.assign('a', 5);

/** True when `json` holds an unevaluated `Integrate` anywhere. */
function holdsIntegrate(json: unknown): boolean {
  if (!Array.isArray(json)) return false;
  return json[0] === 'Integrate' || json.some((x) => holdsIntegrate(x));
}

/** The first number found in `json`, depth first. */
function firstNumber(json: unknown): number | undefined {
  if (typeof json === 'number') return json;
  if (typeof json === 'object' && json !== null && 'num' in json)
    return Number((json as { num: string }).num);
  if (!Array.isArray(json)) return undefined;
  for (const x of json.slice(1)) {
    const v = firstNumber(x);
    if (v !== undefined) return v;
  }
  return undefined;
}

describe('CE-670: A LIST WITH A FAILED CELL EVALUATES ITS OTHER CELLS', () => {
  test('the control: y·[I, J] approximates both integrals', () => {
    const r = ce.box(['Multiply', 'y', ['List', I, J]]).N().json;
    expect(holdsIntegrate(r)).toBe(false);
  });

  test('y·[I, "a"]: N() approximates I, the string cell is an error', () => {
    const r = ce.box(['Multiply', 'y', ['List', I, "'a'"]]).N().json as any[];
    expect(r[0]).toBe('List');
    expect(holdsIntegrate(r[1])).toBe(false);
    expect(firstNumber(r[1])).toBeCloseTo(I_VALUE, 10);
    expect(r[2][0]).toBe('Error');
  });

  test('[I, "b"]·[2, J]: N() approximates the product of the first cells', () => {
    const r = ce.box(['Multiply', ['List', I, "'b'"], ['List', 2, J]]).N()
      .json as any[];
    expect(r[0]).toBe('List');
    expect(holdsIntegrate(r[1])).toBe(false);
    expect(firstNumber(r[1])).toBeCloseTo(2 * I_VALUE, 10);
    expect(r[2][0]).toBe('Error');
  });

  test('y + [I, "a"]: N() approximates I', () => {
    const r = ce.box(['Add', 'y', ['List', I, "'a'"]]).N().json as any[];
    expect(holdsIntegrate(r[1])).toBe(false);
    expect(r[2][0]).toBe('Error');
  });

  test('[I, Error] under N() and evaluateAsync', async () => {
    const expr = ce.box(['List', I, ['Error', "'x'"]]);
    const n = expr.N().json as any[];
    expect(firstNumber(n[1])).toBeCloseTo(I_VALUE, 10);
    expect(n[2]).toEqual(['Error', "'x'"]);
    const a = (await expr.evaluateAsync({ numericApproximation: true }))
      .json as any[];
    expect(firstNumber(a[1])).toBeCloseTo(I_VALUE, 10);
    expect(a[2]).toEqual(['Error', "'x'"]);
  });

  test('evaluate() evaluates the other cells of a list', () => {
    expect(ce.box(['List', 'a', ['Error', "'x'"]]).evaluate().json).toEqual([
      'List',
      5,
      ['Error', "'x'"],
    ]);
    // A nested list with a failed cell is evaluated too.
    expect(
      ce.box(['List', ['List', 'a', ['Error', "'x'"]], 'a']).evaluate().json
    ).toEqual(['List', ['List', 5, ['Error', "'x'"]], 5]);
  });

  test('a failed cell stays as it is', () => {
    // The cell `ln(Error(…))` is not replaced by the error it would bubble.
    expect(
      ce
        .box(['List', 'a', ['Ln', { str: 'b' }]])
        .evaluate()
        .toString()
    ).toBe(
      '[5,ln(Error(ErrorCode("incompatible-type", "number", "string"), "b"))]'
    );
  });

  test('a list with a failed cell keeps its count', () => {
    expect(
      ce.box(['Length', ['List', 'a', ['Error', "'x'"]]]).evaluate().json
    ).toBe(2);
    // A cell that evaluates to `Nothing` is kept, as in a list with no
    // failed cell.
    expect(
      ce
        .box([
          'Length',
          ['List', ['If', 'True', 'Nothing', 1], ['Error', "'x'"]],
        ])
        .evaluate().json
    ).toBe(2);
  });

  test('a finite lazy cell is listed, as in a list with no failed cell', async () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2]));
    const m = ['Map', ['Function', ['Add', 'u', 1], 'u'], 'xs'];
    const control = ce.box(['List', m, 7]).evaluate();
    const withError = ce.box(['List', m, ['Error', "'x'"]]).evaluate();
    const withErrorAsync = await ce
      .box(['List', m, ['Error', "'x'"]])
      .evaluateAsync();
    // A later assignment of `xs` does not change the values.
    ce.assign('xs', ce.box(['List', 10, 20]));
    expect(control.json).toEqual(['List', ['List', 2, 3], 7]);
    expect(withError.json).toEqual(['List', ['List', 2, 3], ['Error', "'x'"]]);
    expect(withErrorAsync.json).toEqual([
      'List',
      ['List', 2, 3],
      ['Error', "'x'"],
    ]);
  });

  test('a set with a failed cell evaluates its other cells', async () => {
    // `a` and `5` are the same element once `a` is evaluated.
    const set = ['Set', 5, 'a', ['Error', "'x'"]];
    expect(ce.box(set).evaluate().json).toEqual(['Set', 5, ['Error', "'x'"]]);
    expect((await ce.box(set).evaluateAsync()).json).toEqual([
      'Set',
      5,
      ['Error', "'x'"],
    ]);
    expect(
      ce.box(['List', ['Set', 'a', ['Error', "'x'"]], 'a']).evaluate().json
    ).toEqual(['List', ['Set', 5, ['Error', "'x'"]], 5]);
  });

  test('a set comprehension with a failed cell stays as it is', () => {
    // The operands of a comprehension are a body and a condition, not
    // elements: the condition is not evaluated alone with a free `k`.
    // Evaluated alone, `Condition(k > 1)` is `True`, so the result would
    // differ if the condition were read as an element.
    const expr = ce.box([
      'Set',
      ['Add', 'k', { str: 's' }],
      ['Condition', ['Greater', 'k', 1]],
    ]);
    expect(expr.evaluate().json).toEqual(expr.json);
  });
});
