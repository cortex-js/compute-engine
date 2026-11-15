import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

// The result of a call is not rebuilt when the call ends: a function literal
// that an argument brings into the result, or that the body built, is the
// same node in the result. A function literal that reads a parameter or a
// local of the call became a function value when it was evaluated
// (`captureNestedLocals`, `function-utils.ts`), and keeps the activation of
// that call.

describe('the end of a call keeps the function literals of its result', () => {
  test('a lazy map an argument brings into the result is the same node', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    ce.assign('L', ce.box(['Add', ['Range', 1, 'N'], 1]));
    const stored = ce.box('L').evaluate();
    expect(isFunction(stored, 'Map')).toBe(true);
    // A parameter typed as a list binds the whole value (a bare parameter
    // would map `k` over the elements).
    ce.assign(
      'k',
      ce.box(['Function', 'w', ['Typed', 'w', { str: 'list<integer>' }]])
    );
    // `k(L)` returns the value of `L`: a lazy `Map` view, which evaluates to
    // a new view node each time (an evaluated result is never its own
    // value), holding the SAME function literal and source. The literal was
    // created in the global scope and reads `N` there; the call frame binds
    // only `w`, so the capture keeps the literal as it is.
    const result = ce.box(['k', 'L']).evaluate();
    if (!isFunction(result, 'Map') || !isFunction(stored, 'Map'))
      throw new Error('expected two lazy maps');
    expect(result.op1).toBe(stored.op1);
    expect(result.op2).toBe(stored.op2);
  });

  test('a literal that reads a parameter of the call keeps the activation of that call', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'm',
      ce.box(['Function', ['Function', ['Add', 'x', 'n'], 'x'], 'n'])
    );
    const inner = ce.box(['m', 5]).evaluate();
    expect(isFunction(inner, 'Function')).toBe(true);
    expect(ce.box(['Apply', inner, 1]).evaluate().json).toBe(6);
    // Two activations give two closures over two values.
    const other = ce.box(['m', 10]).evaluate();
    expect(ce.box(['Apply', other, 1]).evaluate().json).toBe(11);
    expect(ce.box(['Apply', inner, 1]).evaluate().json).toBe(6);
  });

  test('a nested literal of a returned closure keeps the frame of the call of that closure', () => {
    // `make = a ↦ (b ↦ { let r = b; c ↦ r + c })`: the middle literal is a
    // closure that `make(0)` returned. The inner literal is evaluated while
    // `make(0)(2)` runs, and keeps the frame of that call, which holds
    // `r = 2`.
    const ce = new ComputeEngine();
    ce.assign(
      'make',
      ce.box([
        'Function',
        [
          'Function',
          [
            'Block',
            ['Declare', 'r', "'unknown'", 'b'],
            ['Function', ['Add', 'r', 'c'], 'c'],
          ],
          'b',
        ],
        'a',
      ])
    );
    const middle = ce.box(['make', 0]).evaluate();
    const inner = ce.box(['Apply', middle, 2]).evaluate();
    expect(ce.box(['Apply', inner, 3]).evaluate().json).toBe(5);
    // Two activations of the middle closure give two inner closures.
    const other = ce.box(['Apply', middle, 10]).evaluate();
    expect(ce.box(['Apply', other, 3]).evaluate().json).toBe(13);
    expect(ce.box(['Apply', inner, 3]).evaluate().json).toBe(5);
  });

  test('a literal built during the call at the level of the frame is kept', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'real');
    // The body builds a lazy map (a literal whose parent is the call frame)
    // and returns it twice in a tuple: the two mentions are one node.
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'r', "'unknown'", ['Add', ['Range', 1, 'N'], 'w']],
          ['Tuple', 'r', 'r'],
        ],
        'w',
      ])
    );
    const t = ce.box(['g', 2]).evaluate();
    expect(t.operator).toBe('Tuple');
    if (!isFunction(t)) throw new Error('expected a tuple');
    expect(isFunction(t.op1, 'Map')).toBe(true);
    expect(t.op1).toBe(t.op2);
    ce.assign('N', 2);
    expect(t.op1.evaluate().toString()).toBe('[3,4]');
  });

  test('a call declines when a literal that it did not evaluate writes a parameter', () => {
    // `mk = n ↦ If(c > 0, () ↦ Block(n := n + 1, n), 0)`: while `c` has no
    // value the branch is not evaluated, so its literal is not a function
    // value and keeps no activation of the call. The call stays as it is,
    // and gives the counter when it is evaluated with `c` decided.
    const ce = new ComputeEngine();
    ce.declare('c', 'real');
    ce.assign(
      'mk',
      ce.box([
        'Function',
        [
          'If',
          ['Greater', 'c', 0],
          ['Function', ['Block', ['Assign', 'n', ['Add', 'n', 1]], 'n']],
          0,
        ],
        'n',
      ])
    );
    const undecided = ce.box(['mk', 5]).evaluate();
    expect(undecided.json).toEqual(['mk', 5]);
    ce.assign('c', 1);
    const counter = undecided.evaluate();
    const other = ce.box(['mk', 8]).evaluate();
    expect(ce.box(['Apply', counter]).evaluate().json).toBe(6);
    expect(ce.box(['Apply', other]).evaluate().json).toBe(9);
    expect(ce.box(['Apply', counter]).evaluate().json).toBe(7);
  });

  test('the callback of a lazy collection of the result writes a parameter of the call', () => {
    // `n ↦ Map(x ↦ Block(n := n + x, n), [1, 2])`: the `Map` keeps the
    // activation of the call, and its callback reads and writes `n` there.
    const ce = new ComputeEngine();
    const acc = [
      'Function',
      [
        'Map',
        ['Function', ['Block', ['Assign', 'n', ['Add', 'n', 'x']], 'n'], 'x'],
        ['List', 1, 2],
      ],
      'n',
    ];
    const view = ce.box(['Apply', acc, 5]).evaluate();
    expect(view.operator).toBe('Map');
    expect(ce.box(['ListFrom', view]).evaluate().json).toEqual(['List', 6, 8]);
  });
});
