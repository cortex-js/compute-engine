import { ComputeEngine } from '../../src/compute-engine';

// Phase E of slice 1 of binding units, with the engine flag `_bindingUnits`
// on: the identity and the resolution of a free name made in a scope that
// another scope encloses (rules 3, 7 and 8 of
// `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). Each answer is the
// answer of the engine with the flag off.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._bindingUnits = true;
  return ce;
}

describe('BINDING UNITS: A FREE NAME MADE IN A SCOPE THAT AN OPERATION PUSHED', () => {
  test('explain("solve") is an operation: the root is the `x` of the equation', () => {
    const ce = engine();
    const ex = ce.parse('2x+1=5').explain('solve');
    // A root `x` made in the scope that the solver pushes is the same
    // binding as the `x` of the equation, so no step repeats the last one.
    expect(ex.steps.map((s) => s.id)).toEqual([
      'solve.move-terms',
      'solve.linear',
    ]);
    expect(ex.steps[1].value.isSame(ce.parse('x = 2'))).toBe(true);
  });
});

describe('BINDING UNITS: THE FREE NAME OF THE BODY OF A FUNCTION LITERAL', () => {
  test('an argument with the name of a free name of the body', () => {
    const ce = engine();
    const r = ce
      .box(['Apply', ['Function', ['Multiply', 'a', 'x'], 'x'], 'a'])
      .evaluate();
    expect(r.isSame(ce.parse('a^2'))).toBe(true);
  });
});

describe('BINDING UNITS: A FREE NAME IN THE ARGUMENT OF A CALL IS NOT A PARAMETER', () => {
  test('D(x·y, x) at (3, x) is x', () => {
    const ce = engine();
    const literal = [
      'Function',
      ['D', ['Multiply', 'x', 'y'], 'x'],
      'x',
      'y',
    ] as const;
    // `y` holds the `x` of the caller, a free name: it does not vary with
    // the variable `x` of the `D`.
    expect(ce.box(['Apply', literal, 3, 'x']).evaluate().toString()).toBe('x');
    expect(
      ce.box(['EvaluateAt', literal, ['Tuple', 3, 'x']]).evaluate().toString()
    ).toBe('x');
  });
});

describe('BINDING UNITS: A NAME DOES NOT READ THE LOCAL OF A BLOCK IT WAS NOT WRITTEN IN', () => {
  test('a free name of a stored value reads past a Block local', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    const block = () =>
      ce
        .box(['Block', ['Declare', 'x', "'real'", 7], ['Add', 'a', 5]])
        .evaluate()
        .toString();
    expect(block()).toBe('106');
    ce.box(['Assign', 'x', 200]).evaluate();
    expect(block()).toBe('206');
  });

  test('a free name of a stored value with no definition stays symbolic', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    const r = ce
      .box(['Block', ['Declare', 'x', "'real'", 99], ['Add', 'a', 5]])
      .evaluate();
    expect(r.isSame(ce.parse('x + 6'))).toBe(true);
  });

  test('a free name that is an operand of a Block reads its local', () => {
    // The host builds the block from boxed operands: the `b` of `h(b)` is
    // in the block, and reads the local `b`.
    const ce = engine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Multiply', 2, 'u'], 'u']));
    const block = ce.function('Block', [
      ce.box(['Declare', 'b', "'unknown'", 3]),
      ce.function('h', [ce.symbol('b')]),
    ]);
    expect(block.evaluate().json).toBe(6);
  });

  test('the type of a free name of a stored value is not the type of a Block local', () => {
    // `k` has no definition when `a` is assigned. In the block, the value
    // of `a` reads the outer `k`, and its type is not the type of the
    // local `k`: `Abs` keeps its bars.
    const ce = engine();
    ce.box(['Assign', 'a', ['Abs', 'k']]).evaluate();
    const r = ce
      .box(['Block', ['Declare', 'k', "'real<0..>'", 3], ['Add', 'a', 1]])
      .evaluate();
    ce.box(['Assign', 'k', -5]).evaluate();
    expect(r.evaluate().json).toBe(6);
  });

  test('the type of the body of a function called in a Block', () => {
    // `p` reads the global `k`, which holds `i`. The local `k` of the block
    // is an integer: the call is read with the type of the global `k`.
    const ce = engine();
    ce.declare('x', 'real');
    ce.assign('k', ce.parse('\\imaginaryI'));
    ce.declare('p', { signature: '(unknown) -> unknown' });
    ce.assign('p', ce.parse('P \\mapsto P.x + k'));
    const block = ce.box([
      'Block',
      ['Declare', 'k', "'integer'", 2],
      ['Add', ['p', ['Tuple', 'x', 1]], 'k'],
    ]);
    const value = block.subs({ x: 2 }).N();
    expect(value.re).toBe(4);
    expect(value.im).toBe(1);
  });
});
