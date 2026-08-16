/**
 * `Head` and `Tail` are structural (lazy) operators, but they are NOT
 * value-blind: a symbol operand is resolved through its binding at
 * evaluation time, so `Head(x)` with `x := a + 1` is `Add`, not `Symbol`.
 * Folding a symbol operand at canonicalization would also freeze a user
 * function body `f(e) = Head(e)` to the literal `Symbol` at definition time.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();

describe('Head/Tail on a symbol operand', () => {
  test('a compound operand folds structurally at canonicalization', () => {
    expect(ce.box(['Head', ['Add', 3, 'y']]).json).toBe('Add');
    expect(ce.box(['Head', 4]).json).toBe('Integer');
    expect(ce.box(['Tail', ['Add', 3, 'y']]).json).toEqual([
      'Sequence',
      3,
      'y',
    ]);
  });

  test('a symbol operand stays symbolic at canonicalization', () => {
    expect(ce.box(['Head', 'hdSym']).json).toEqual(['Head', 'hdSym']);
    expect(ce.box(['Tail', 'hdSym']).json).toEqual(['Tail', 'hdSym']);
  });

  test('an unbound symbol has head Symbol and no tail', () => {
    expect(ce.box(['Head', 'hdSym']).evaluate().json).toBe('Symbol');
    expect(ce.box(['Tail', 'hdSym']).evaluate().json).toBe('Nothing');
  });

  test('a bound symbol reports the head/tail of its value', () => {
    ce.assign('hdBound', ce.box(['Multiply', 'a', 'b']));
    expect(ce.box(['Head', 'hdBound']).evaluate().json).toBe('Multiply');
    expect(ce.box(['Tail', 'hdBound']).evaluate().json).toEqual([
      'Sequence',
      'a',
      'b',
    ]);
    // Parse route (held operand arrives unbound — must still resolve)
    expect(
      ce.parse('\\operatorname{Head}(\\mathrm{hdBound})').evaluate().json
    ).toBe('Multiply');
  });

  test('a user function body Head(e) is not frozen at definition time', () => {
    const ce2 = new ComputeEngine();
    const run = (src: string) => executeEpsil(ce2, src).value?.json;
    expect(run('f(e) = Head(e); f(4)')).toBe('Integer');
    expect(run('f(3 + y)')).toBe('Add');
    expect(run('f(y)')).toBe('Symbol');
    expect(run('let x = y + 1; Head(x)')).toBe('Add');
    expect(run('Tail(x)')).toEqual(['Sequence', 'y', 1]);
  });

  test('the binding is looked up, not evaluated', () => {
    const ce2 = new ComputeEngine();
    const run = (src: string) => executeEpsil(ce2, src).value?.json;
    // `x` is bound to the EXPRESSION `y + 1`; giving `y` a value afterwards
    // does not change what `x` is bound to, so its head is still `Add`
    // (evaluating would answer `Integer`).
    expect(run('let x = y + 1; y = 3; Head(x)')).toBe('Add');
    expect(run('Tail(x)')).toEqual(['Sequence', 'y', 1]);
    // A store evaluates its right-hand side, so `z` is bound to `4`.
    expect(run('let z = x; Head(z)')).toBe('Integer');
    // Constants and operator names are not chased.
    expect(run('Head(Pi)')).toBe('Symbol');
    expect(run('Head(Sin)')).toBe('Symbol');
    // A self-referential binding reads as unbound.
    expect(run('let w = w + 1; Head(w)')).toBe('Symbol');
  });

  test('a symbol-to-symbol cycle stops where it closes', () => {
    const ce2 = new ComputeEngine();
    // Bindings created on the scope directly (no evaluate-collapsing setter):
    // `u` is bound to the symbol `v`, and `v` to the symbol `u`.
    ce2.declare('cu', { value: ce2.symbol('cv'), inferred: true });
    ce2.declare('cv', { value: ce2.symbol('cu'), inferred: true });
    expect(ce2.box(['Head', 'cu']).evaluate().json).toBe('Symbol');
    expect(ce2.box(['Tail', 'cu']).evaluate().json).toBe('Nothing');
  });
});
