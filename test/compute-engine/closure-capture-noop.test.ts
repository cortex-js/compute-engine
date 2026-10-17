import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

// The closure capture at the end of a call (`captureClosures`,
// `function-utils.ts`) re-roots every function literal in the call's result
// onto the call frame. A literal that reads nothing the re-rooting would
// change — one that an argument's value brings into the result, whose own
// chain and the frame's chain resolve all its names to the same bindings — is
// kept as it is, and so is every node above it (`rerootingIsNoop`). A
// literal that reads a parameter of the call is re-rooted as before.

describe('the closure capture keeps a literal that the re-rooting would not change', () => {
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

  test('a literal that reads a parameter of the call is re-rooted', () => {
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

  test('a nested literal of a returned closure is re-rooted on the frame of that closure', () => {
    // `make = a ↦ (b ↦ { let r = b; c ↦ r + c })`: the middle literal is a
    // closure that `make(0)` returned, so its body scope is one the capture
    // made. While `make(0)(2)` runs, that scope is re-parented on the frame
    // of the call (which holds `r = 2`) and its parameter is hidden, so a
    // chain through it is not the chain the inner literal would keep once
    // the call ends: the inner literal must be re-rooted on the frame.
    const ce = new ComputeEngine();
    ce.assign(
      'make',
      ce.box([
        'Function',
        [
          'Function',
          [
            'Block',
            ['Declare', 'r'],
            ['Assign', 'r', 'b'],
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
          ['Declare', 'r'],
          ['Assign', 'r', ['Add', ['Range', 1, 'N'], 'w']],
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
});
