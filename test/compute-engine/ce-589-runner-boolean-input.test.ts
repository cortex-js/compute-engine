import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-589: the `run()` of a `javascript` compilation accepts a boolean for a
// symbol declared `boolean`, a string for a symbol declared `string`, and
// lists of them, and its TypeScript type admits these values (no cast).
// `scripts/typecheck.sh` type-checks this file (ts-jest does not), so
// `npm run typecheck` fails if the type refuses one of these calls.
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
});
