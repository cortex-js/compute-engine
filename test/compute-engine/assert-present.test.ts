import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// `AssertPresent(x)` — the presence assertion (decision P4 of
// `docs/plans/2026-10-21-presence-contracts-and-assertion.md`, Epsil `x?!`).
// It evaluates its operand once and returns it unchanged when present; an
// ABSENT operand (`Missing`, `Undefined`, `NaN`, `Indeterminate`: the set
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
    ['Undefined', 'Undefined'],
    ['NaN', 'NaN'],
    [['Divide', 0, 0], 'Indeterminate'],
  ])('%s fails the assertion', (input, _label) => {
    const v = ce.box(['AssertPresent', input as any]).evaluate();
    expect(v.operator).toBe('Error');
    expect(v.op1.toString()).toBe('"expected-present"');
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

  test('the operand is evaluated once', () => {
    ce.declare('k', 'integer');
    ce.assign('k', 0);
    // `Assign` returns the assigned value, which is present.
    const e = ce.box(['AssertPresent', ['Assign', 'k', ['Add', 'k', 1]]]);
    expect(e.evaluate().re).toBe(1);
    expect(ce.box('k').evaluate().re).toBe(1);
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
    ce.declare('u', 'integer | nothing | missing');
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

describe('AssertPresent — compiled (JavaScript)', () => {
  const js = (expr: any) => {
    const r = compile(expr, { to: 'javascript' });
    if (!r.success) throw new Error(r.error ?? 'not compiled');
    return r;
  };

  test('a present element is returned; an absent one throws at run time', () => {
    const r = js(ce.box(['AssertPresent', ['At', 'xs', 'i']]));
    expect(r.run({ i: 1 })).toBe('a');
    expect(() => r.run({ i: 5 })).toThrow(/expected-present/);
  });

  test('a numeric absent value throws too', () => {
    ce.declare('zs', 'list<number>');
    ce.assign('zs', ce.box(['List', 4, 9]));
    const r = js(ce.box(['Add', ['AssertPresent', ['At', 'zs', 'i']], 1]));
    expect(r.run({ i: 2 })).toBe(10);
    expect(() => r.run({ i: 7 })).toThrow(/expected-present/);
  });

  test('a proved-present operand compiles with no check', () => {
    // A declared length proves the position, and `string` admits no `nan`.
    ce.declare('ys', 'list<string^3>');
    const r = js(ce.box(['AssertPresent', ['At', 'ys', 2]]));
    expect(String(r.code)).not.toContain('expected-present');
  });

  test('a numeric cell keeps the check: `number` admits NaN', () => {
    ce.declare('ns', 'list<number^3>');
    const r = js(ce.box(['AssertPresent', ['At', 'ns', 2]]));
    expect(String(r.code)).toContain('expected-present');
  });

  test('Python raises; a shader target compiles the identity (P5)', () => {
    ce.declare('x', 'number');
    const py = compile(ce.box(['Add', ['AssertPresent', 'x'], 1]), {
      to: 'python',
    });
    expect(py.success).toBe(true);
    expect(String(py.code)).toContain('ValueError("expected-present: x is absent")');
    for (const to of ['glsl', 'wgsl'] as const) {
      const sh = compile(ce.box(['Add', ['AssertPresent', 'x'], 1]), { to });
      expect(sh.success).toBe(true);
      expect(String(sh.code)).toBe('x + 1.0');
    }
    // The identity is not read as a proof: a later absence test on the
    // value keeps its own rule (declined on a shader, kept on JavaScript).
    const later = compile(ce.box(['IsMissing', ['AssertPresent', 'x']]), {
      to: 'javascript',
    });
    expect(later.success).toBe(true);
    expect(String(later.code)).toContain('Number.isNaN');
  });

  test('Python binds the operand once: an effectful operand runs once', () => {
    ce.declare('s', 'string | missing');
    const py = compile(ce.box(['AssertPresent', 's']), { to: 'python' });
    expect(py.success).toBe(true);
    const code = String(py.code);
    expect(code).toContain('expected-present');
    // Outside the error message text, the operand `s` appears once, as the
    // argument of the binding lambda; the test and the result branch read
    // the bound parameter `_c`.
    const outsideMessage = code.replace(/"expected-present[^"]*"/, '""');
    expect(outsideMessage.match(/\bs\b/g)?.length).toBe(1);
  });

  test('the interval target raises too: the assertion is not removed', () => {
    ce.declare('x', 'number');
    const r = compile(ce.box(['AssertPresent', 'x']), { to: 'interval-js' });
    expect(r.success).toBe(true);
    expect(String(r.code)).toContain('expected-present');
    // `run()` turns every thrown error into `{ kind: 'entire' }` by design
    // (`interval-runtime.ts`); the raw call shows the raise itself.
    const raw = (r.run as unknown as { rawCall: (v: unknown) => unknown })
      .rawCall;
    expect(() => raw({ x: { lo: NaN, hi: NaN } })).toThrow(/expected-present/);
    expect(r.run({ x: NaN })).toEqual({ kind: 'entire' });
  });

  test('an operand that may be Nothing is declined', () => {
    ce.declare('w', 'integer | nothing');
    const r = compile(ce.box(['AssertPresent', 'w']), { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.error ?? '').toContain('AssertPresent');
  });
});
