import { ComputeEngine } from '../../src/compute-engine';

// CE-1122: the arithmetic code selects a call by its operator name (`Sqrt`,
// `Abs`, ...). A call bound to a user function with a library name is a
// value, not a square root or an absolute value: its coefficient is 1, and it
// is not folded into the numeric coefficient of a product
// (`shadowsLibraryOperator()`). A library call that the arithmetic code
// builds again (`Sqrt(u)` from `Sqrt(4u)`) stays bound to the library
// operator, also in a scope where a user function of its name shadows it.

/** Declare `name` as a function held as a value, and assign `fn` to it. */
function define(ce: ComputeEngine, name: string, fn: unknown): void {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(fn as any));
}

describe('CE-1122: arithmetic with a user function named Sqrt', () => {
  test('add() and mul() of calls of the library and of the user Sqrt', () => {
    const ce = new ComputeEngine();
    const L = ce.box(['Sqrt', 'y']);
    ce.pushScope();
    define(ce, 'Sqrt', ['Function', ['Add', 'x', 100], 'x']);
    const U = ce.box(['Sqrt', 'y']);
    const U4 = ce.box(['Sqrt', 4]);
    ce.popScope();
    // √4 + (4 + 100)
    expect(L.add(U).subs({ y: 4 }).N().re).toBe(106);
    // 2·(4 + 100)
    expect(U.mul(ce.number(2)).subs({ y: 4 }).N().re).toBe(208);
    expect(U4.mul(ce.number(2)).N().re).toBe(208);
    expect(U4.mul(ce.number(2)).json).toEqual(['Multiply', 2, ['Sqrt', 4]]);
  });

  test('the canonical product and quotient in the scope of the user Sqrt', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    define(ce, 'Sqrt', ['Function', 1000, 'u']);
    expect(ce.box(['Multiply', 2, ['Sqrt', 4]]).N().re).toBe(2000);
    expect(ce.box(['Divide', ['Sqrt', 4], 4]).N().re).toBe(250);
    expect(ce.box(['Divide', 5, ['Sqrt', 4]]).N().re).toBe(0.005);
    expect(ce.box(['Divide', ['Sqrt', 4], ['Sqrt', 9]]).N().re).toBe(1);
    ce.popScope();
  });

  test('a library call built again keeps the library binding', () => {
    const ce = new ComputeEngine();
    const L = ce.box(['Sqrt', ['Multiply', 4, 'y']]);
    const A = ce.box(['Abs', ['Multiply', -3, 'y']]);
    const L1 = ce.box(['Sqrt', 'y']);
    ce.pushScope();
    define(ce, 'Sqrt', ['Function', ['Add', 'x', 100], 'x']);
    define(ce, 'Abs', ['Function', ['Add', 'x', 100], 'x']);
    const m = L.mul(ce.number(3));
    const a = A.mul(ce.number(2));
    // A product splits `Sqrt(y)` into `y^½`: it must not write it again as
    // a call of the user `Sqrt`.
    expect(L1.mul(ce.number(3)).subs({ y: 4 }).N().re).toBe(6);
    expect(L1.mul(ce.box('y')).subs({ y: 4 }).N().re).toBe(8);
    // 3·√(4y) = 6·√y, and 2·|−3y| = 6·|y|
    expect(m.subs({ y: 4 }).N().re).toBe(12);
    expect(a.subs({ y: 4 }).N().re).toBe(24);
    ce.popScope();
    expect(m.subs({ y: 4 }).N().re).toBe(12);
    expect(a.subs({ y: 4 }).N().re).toBe(24);
  });

  test('a user Root with the index 2 is not a square root', () => {
    const ce = new ComputeEngine();
    const R = ce.box(['Root', ['Multiply', 8, 'y'], 3]);
    ce.pushScope();
    define(ce, 'Root', ['Function', ['Add', 'a', 'b', 100], 'a', 'b']);
    // 3·(4 + 2 + 100)
    expect(ce.box(['Multiply', 3, ['Root', 4, 2]]).N().re).toBe(318);
    // 3·∛(8y) = 6·∛y, with the library Root
    const m = R.mul(ce.number(3));
    expect(m.subs({ y: 8 }).N().re).toBe(12);
    ce.popScope();
    expect(m.subs({ y: 8 }).N().re).toBe(12);
  });

  test('the library Sqrt is still folded and factored', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', 2, ['Sqrt', 4]]).json).toBe(4);
    expect(ce.box(['Sqrt', ['Multiply', 4, 'y']]).mul(ce.number(3)).json).toEqual(
      ['Multiply', 6, ['Sqrt', 'y']]
    );
  });
});
