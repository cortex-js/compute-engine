import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-589: the `run()` of a `javascript` compilation accepts a boolean for a
// symbol declared `boolean`, a string for a symbol declared `string`, and
// lists of them, and its TypeScript type admits these values (no cast).
// `scripts/typecheck.sh` type-checks this file (ts-jest does not), so
// `npm run typecheck` fails if the type refuses one of these calls.
//
// The type does not relate a value to the declared type of its symbol, so
// the entry guards check part of that at run time: a symbol declared with a
// number type refuses a boolean and a string. Before, JavaScript converted
// the value silently: `x + 1` gave 2 for `x = true` and "a1" for `x = "a"`.
// A symbol declared `boolean` accepts any value: a condition on a value that
// is not a boolean is undecided, and the result is NaN
// (`ce-569-when-defects.test.ts`).
describe('CE-589 a boolean or a string argument of run()', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  ce.declare('z', 'complex');
  ce.declare('s', 'string');
  ce.declare('B', 'list<boolean>');
  ce.declare('L', 'list<string>');

  test('a boolean for a symbol declared boolean', () => {
    const r = compile(ce.box(['When', 'x', 'c']));
    expect(r.run!({ x: 2, c: true })).toBe(2);
    expect(r.run!({ x: 2, c: false })).toBeNaN();
    const n = compile(ce.box(['Not', 'c']));
    expect(n.run!({ c: false })).toBe(true);
  });

  test('a string for a symbol declared string', () => {
    const r = compile(ce.parse('\\operatorname{If}(s = "a", 1, 2)'));
    expect(r.run!({ s: 'a' })).toBe(1);
    expect(r.run!({ s: 'b' })).toBe(2);
  });

  test('a list of booleans, and a list of strings', () => {
    const b = compile(ce.box(['If', ['At', 'B', 2], 1, 2]));
    expect(b.run!({ B: [true, false] })).toBe(2);
    const l = compile(ce.box(['At', 'L', 2]));
    expect(l.run!({ L: ['a', 'b'] })).toBe('b');
  });

  test('a boolean argument of a lambda', () => {
    const r = compile(
      ce.parse('(c: boolean, y: real) \\mapsto \\operatorname{If}(c, y, 0)')
    );
    expect(r.calling).toBe('lambda');
    expect(r.run!(true, 3)).toBe(3);
    expect(r.run!(false, 3)).toBe(0);
  });

  test('the concrete javascript target admits a boolean', () => {
    // No cast: `scripts/typecheck.sh` checks that the declared return type
    // of `_getCompilationTarget('javascript')` admits a boolean.
    const target = ce._getCompilationTarget('javascript');
    expect(target).toBeDefined();
    const r = target!.compile(ce.box(['When', 'x', 'c']));
    expect(r.run!({ x: 2, c: true })).toBe(2);
  });

  test('a symbol declared with a number type refuses a boolean and a string', () => {
    const r = compile(ce.parse('x + 1'));
    expect(() => r.run!({ x: true })).toThrow(
      /"x" was compiled as a real number but received a boolean/
    );
    expect(() => r.run!({ x: 'a' })).toThrow(
      /"x" was compiled as a real number but received a string/
    );
    const z = compile(ce.parse('z + 1'), { mode: 'complex' });
    expect(() => z.run!({ z: true })).toThrow(
      /"z" was compiled as a complex number but received a boolean/
    );
  });

  test('a binding that is not declared with a number type accepts a boolean and a string', () => {
    // Only a declared number type refuses them: a wider declared type, a
    // top type, an inferred type and an unannotated parameter do not.
    const local = new ComputeEngine();
    local.declare('u', 'real | boolean');
    local.declare('a', 'any');
    const u = compile(local.box(['If', ['Equal', 'u', 'True'], 1, 2]));
    expect(() => u.run!({ u: true })).not.toThrow();
    expect(() => u.run!({ u: 'a' })).not.toThrow();
    const a = compile(local.box(['If', ['Equal', 'a', 'True'], 1, 2]));
    expect(() => a.run!({ a: true })).not.toThrow();
    expect(() => a.run!({ a: 'a' })).not.toThrow();
    // `w` is not declared: its type is inferred from `w + 1`.
    const w = compile(local.parse('w + 1'));
    expect(w.entryPlan?.scalars ?? []).not.toContain('w');
    expect(() => w.run!({ w: true })).not.toThrow();
    expect(() => w.run!({ w: 'a' })).not.toThrow();
    const f = compile(local.parse('(t) \\mapsto t + 1'));
    expect(f.calling).toBe('lambda');
    expect(() => f.run!(true)).not.toThrow();
    expect(() => f.run!('a')).not.toThrow();
  });

  test('a symbol declared boolean accepts any value', () => {
    // A value that is not a boolean leaves the condition undecided.
    const r = compile(ce.box(['When', 'x', 'c']));
    expect(r.run!({ x: 2, c: 1 })).toBeNaN();
    expect(r.run!({ x: 2, c: 'true' })).toBeNaN();
  });

  test('the parameters of a lambda are checked the same way', () => {
    const r = compile(
      ce.parse('(c: boolean, y: real) \\mapsto \\operatorname{If}(c, y, 0)')
    );
    expect(r.run!(1, 3)).toBeNaN();
    expect(() => r.run!(true, false)).toThrow(
      /argument 2 was compiled as a real number but received a boolean/
    );
    expect(() => r.run!(true, 'a')).toThrow(
      /argument 2 was compiled as a real number but received a string/
    );
  });

  test('entryChecks: false keeps the unchecked behavior', () => {
    const r = compile(ce.parse('x + 1'), { entryChecks: false });
    expect(r.run!({ x: true })).toBe(2);
  });
});
