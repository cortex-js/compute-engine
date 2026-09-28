import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A user binding shadows a library name, whichever spelling the name has
// (user decision 2026-09-27; `src/epsil/docs/naming.md`, "User names and
// shadowing"). Two groups of capitalized names ignored the binding, with no
// diagnostic:
//
// - The interned constants (`Pi`, `ExponentialE`, …): the engine hands out
//   one shared symbol per name, bound at startup to the library definition,
//   and returned it without looking the name up
//   (`createSymbolExpression`, `engine-expression-entrypoints.ts`).
// - The heads canonicalization folds by name (`Square(3)` → `9`, `Divide(3,
//   4)` → `3/4`): the short path skips the definition lookup
//   (`makeNumericFunction` and the literal fold in `boxFunction`,
//   `boxed-expression/box.ts`).
//
function run(source: string): string {
  const r = executeEpsil(new ComputeEngine(), source);
  return r.value.toString();
}

describe('a user binding shadows an interned library constant', () => {
  test.each([
    ['let Pi = 3\nPi', '3'],
    ['let Pi = 3\nPi + 1', '4'],
    ['do { let Pi = 3; Pi }', '3'],
    ['let ExponentialE = 3\nExponentialE', '3'],
    ['let Missing = 3\nMissing', '3'],
    ['let Undefined = 3\nUndefined', '3'],
  ])('%j', (source, value) => {
    expect(run(source)).toBe(value);
  });

  test('the library constant is unchanged where nothing shadows it', () => {
    const ce = new ComputeEngine();
    expect(ce.box('Pi')).toBe(ce.Pi);
    expect(run('let x = 3\nsin(Pi / 2)')).toBe('1');
    // A binding in one engine does not leak into another.
    const other = new ComputeEngine();
    executeEpsil(other, 'let Pi = 3');
    expect(new ComputeEngine().box('Pi').N().re).toBeCloseTo(Math.PI, 12);
  });
});

describe('a user function shadows a head that canonicalization folds', () => {
  test.each([
    ['function Square(x) { x + 100 }\nSquare(3)', '103'],
    ['Square(x) = x + 100\nSquare(3)', '103'],
    ['function Sqrt(x) { x + 100 }\nSqrt(4)', '104'],
    ['function Negate(x) { x + 100 }\nNegate(3)', '103'],
    ['function Exp(x) { x + 100 }\nExp(1)', '101'],
    ['function Ln(x) { x + 100 }\nLn(1)', '101'],
    ['function Divide(x, y) { x + y + 100 }\nDivide(3, 4)', '107'],
    ['function Power(x, y) { 100 }\nPower(3, 4)', '100'],
  ])('%j', (source, value) => {
    expect(run(source)).toBe(value);
  });

  test('the library operator folds where nothing shadows it', () => {
    expect(run('Square(3)')).toBe('9');
    expect(run('Negate(3)')).toBe('-3');
    expect(run('Divide(3, 4)')).toBe('3/4');
    expect(run('sqrt(4)')).toBe('2');
  });

  test('a parameter named like a folded head is the argument', () => {
    // The parameter is declared on its first reference, so the body is boxed
    // while the lookup still finds the library `Square`.
    expect(run('((Square) => Square(3))(x => x + 100)')).toBe('103');
  });

  test('compiled code falls back to the interpreter for a shadowed head', () => {
    // The target lowers `Square` as the library operator (`y * y`), which is
    // not what the interpreter calls; compilation fails closed and `compile()`
    // falls back to interpreting the user function.
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.box([
      'DefineFunction',
      'Square',
      ['Function', ['Add', 'x', 100], 'x'],
    ]).evaluate();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const f = compile(ce.box(['Square', 'y']));
      expect(f.success).toBe(false);
      expect(f.run!({ y: 2 })).toBe(102);
    } finally {
      warn.mockRestore();
    }
    const plain = new ComputeEngine();
    plain.declare('y', 'real');
    expect(compile(plain.box(['Square', 'y'])).success).toBe(true);
  });

  test('the box route agrees', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DefineFunction',
      'Square',
      ['Function', ['Add', 'x', 100], 'x'],
    ]).evaluate();
    expect(ce.box(['Square', 3]).evaluate().toString()).toBe('103');
  });
});
