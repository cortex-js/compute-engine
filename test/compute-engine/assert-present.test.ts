import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// `AssertPresent(x)` — the presence assertion (decision P4 of
// `docs/plans/2026-10-21-presence-contracts-and-assertion.md`, Epsil `x?!`).
// It evaluates its operand once and returns it unchanged when present; an
// ABSENT operand (`Missing`, `Undefined`, `NaN`, `NaN`: the set
// `IsMissing` recognizes and `Coalesce` discharges) is an `expected-present`
// error naming the operand as written. `Nothing` is an omission marker, not
// an absent datum, and passes through; an error operand propagates. Its type
// is `Present(T)`: the outcomes of the operand's type that are not absent.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  ce.declare('xs', 'list<string>');
  ce.assign('xs', ce.box(['List', "'a'", "'b'"]));
  ce.declare('i', 'integer');
});

describe('AssertPresent — evaluation', () => {
  test('a present value is returned unchanged', () => {
    expect(ce.box(['AssertPresent', ['At', 'xs', 1]]).evaluate().string).toBe(
      'a'
    );
    expect(ce.box(['AssertPresent', 5]).evaluate().re).toBe(5);
  });

  test('an absent read is an `expected-present` error naming the operand', () => {
    ce.assign('i', 5);
    const v = ce.box(['AssertPresent', ['At', 'xs', 'i']]).evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toBe('Error("expected-present", "At(\\"xs\\", i)")');
  });

  test.each([
    ['Missing', 'Missing'],
    ['NaN', 'NaN'],
    [['Divide', 0, 0], 'NaN'],
  ])('%s fails the assertion', (input, _label) => {
    const v = ce.box(['AssertPresent', input as any]).evaluate();
    expect(v.operator).toBe('Error');
    expect(v.op1.toString()).toBe('"expected-present"');
  });

  test('Undefined is not an absent value: the assertion is held', () => {
    // `Missing` is the one absent symbol (`docs/ERROR-MODEL.md`, "`Missing`
    // is a result only"); `Undefined` is an ordinary symbol with no value.
    expect(ce.box(['AssertPresent', 'Undefined']).evaluate().operator).toBe(
      'AssertPresent'
    );
  });

  test('Nothing passes through: omission is not missing data', () => {
    expect(ce.box(['AssertPresent', 'Nothing']).evaluate().symbol).toBe(
      'Nothing'
    );
  });

  test('an error operand propagates as itself', () => {
    const v = ce
      .box(['AssertPresent', ['RuntimeError', "'boom'"]])
      .evaluate();
    expect(v.toString()).toBe('Error("boom")');
  });

  test('an undecided operand keeps the assertion', () => {
    expect(ce.box(['AssertPresent', 'y']).evaluate().toString()).toBe(
      'AssertPresent(y)'
    );
    // `x + 1` is typed `number`, which admits `nan`: `x := 0/0` would make
    // it absent, so the assertion stays.
    expect(
      ce.box(['AssertPresent', ['Add', 'x', 1]]).evaluate().toString()
    ).toBe('AssertPresent(x + 1)');
  });

  test('a value whose type cannot be absent is present despite free variables', () => {
    // A list stays a list under any substitution of `x`, so it is present.
    const list = ce.box(['AssertPresent', ['List', 'x', 1]]).evaluate();
    expect(list.toString()).toBe('[x,1]');
    expect(list.operator).toBe('List');
    expect(
      ce
        .box(['Length', ['AssertPresent', ['List', 'x', 1]]])
        .evaluate()
        .re
    ).toBe(2);
    expect(
      ce.box(['AssertPresent', ['Tuple', 'x', 1]]).evaluate().operator
    ).toBe('Tuple');
    // `Coalesce` reads the same shape: a list operand is a present value.
    expect(
      ce.box(['Coalesce', ['List', 'x', 1], 2]).evaluate().toString()
    ).toBe('[x,1]');
  });

  test('arity: no argument is a missing argument, a second one is unexpected', () => {
    expect(ce.box(['AssertPresent']).isValid).toBe(false);
    const two = ce.box(['AssertPresent', 1, 2]);
    expect(two.isValid).toBe(false);
    expect(JSON.stringify(two.json)).toContain('unexpected-argument');
  });
});

describe('AssertPresent — type', () => {
  test('a possibly absent read loses its absent member', () => {
    expect(ce.box(['AssertPresent', ['At', 'xs', 'i']]).type.toString()).toBe(
      'string'
    );
  });

  test('a numeric operand loses `nan`, keeps its infinities', () => {
    ce.declare('n', 'number');
    const t = ce.box(['AssertPresent', 'n']).type;
    expect(t.matches('nan')).toBe(false);
    expect(ce.type('signed_infinity').matches(t)).toBe(true);
  });

  test('`nothing` stays: the assertion does not check omission', () => {
    ce.declare('u', 'integer | nothing');
    expect(ce.box(['AssertPresent', 'u']).type.toString()).toBe(
      'integer | nothing'
    );
  });

  test('an unresolved operand stays unresolved', () => {
    expect(ce.box(['AssertPresent', 'y']).type.toString()).toBe('unknown');
  });

  test('a declared user function accepts the asserted read at a strict parameter', () => {
    ce.declare('f', '(string) -> string');
    const call = ce.box(['f', ['AssertPresent', ['At', 'xs', 'i']]]);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('string');
  });
});

describe('AssertPresent — serialization', () => {
  test('LaTeX spells the operator by name', () => {
    expect(ce.box(['AssertPresent', 'y']).latex).toBe(
      '\\mathrm{AssertPresent}(y)'
    );
  });
});

describe('AssertPresent — compiled', () => {
  test('a shader target declines the head (P5)', () => {
    ce.declare('x', 'number');
    for (const to of ['glsl'] as const) {
      const r = compile(ce.box(['Add', ['AssertPresent', 'x'], 1]), { to });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('outside-profile');
    }
  });

  test('an operand that may be Nothing is declined', () => {
    ce.declare('w', 'integer | nothing');
    const r = compile(ce.box(['AssertPresent', 'w']), { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.error ?? '').toContain('AssertPresent');
  });
});
