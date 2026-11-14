import { ComputeEngine } from '../../src/compute-engine';
import { withStaticTypingView } from '../../src/compute-engine/static-typing-view';

//
// A static type does not depend on a value (decision D16 of
// `docs/plans/2026-11-11-bound-once-spec.md`): in a type computation a
// variable has no value. A memo of an answer that a value can change (a
// sign, an evaluation) is not shared between a type computation and a read
// outside it (`staticViewDiverges()`, `static-typing-view.ts`), and a write
// that changes what a type computation reads moves the type version.
//

describe('A VALUE MEMO IS NOT SHARED WITH A TYPE COMPUTATION', () => {
  test('a sign read outside the view does not narrow a type', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('x', 4);
    const e = ce.box(['Sqrt', ['Add', 'x', 1]]);
    // Warm the sign of `x + 1` outside a type computation: it reads the
    // value 4.
    expect(e.op1.sgn).toBe('positive');
    // `x` is a real with no value in the view, so `x + 1` can be negative.
    expect(e.type.toString()).toBe('complex');
    ce.assign('x', 7);
    expect(e.type.toString()).toBe('complex');
    ce.assign('x', -9);
    expect(e.type.toString()).toBe('complex');
    expect(e.evaluate().toString()).toBe('2sqrt(2)i');
  });

  test('an application evaluated in the view is not served outside it', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 3);
    ce.parse('f(x) := x + k').evaluate();
    // In the view `k` has no value.
    expect(
      withStaticTypingView(ce, () => ce.parse('f(1)').evaluate().toString())
    ).toBe('k + 1');
    expect(ce.parse('f(1)').evaluate().toString()).toBe('4');
  });
});

describe('A VALUE THAT APPEARS OR DISAPPEARS UNDER AN ASSUMPTION', () => {
  // An assumption refines the type of a variable with no value only
  // (`_typeWithFacts`), so the type changes when the variable gets a value
  // or loses it.
  test('an assignment drops the refinement', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 0'));
    const list = ce.box(['List', 'x']);
    expect(list.type.toString()).toBe('list<real<0<..>^1>');
    ce.assign('x', 1);
    expect(ce.box('x').type.toString()).toBe('real');
    expect(list.type.toString()).toBe('vector<real^1>');
  });

  test('a value taken away brings the refinement back', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('x', 1);
    ce.assume(ce.parse('x > 0'));
    const list = ce.box(['List', 'x']);
    expect(list.type.toString()).toBe('vector<real^1>');
    (ce.lookupDefinition('x') as any).value.value = undefined;
    expect(ce.box('x').type.toString()).toBe('real<0<..>');
    expect(list.type.toString()).toBe('list<real<0<..>^1>');
  });

  test('the restore of `withValues()` brings the refinement back', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 0'));
    const list = ce.box(['List', 'x']);
    expect(list.type.toString()).toBe('list<real<0<..>^1>');
    ce.withValues({ x: 1 }, () => {
      expect(list.type.toString()).toBe('vector<real^1>');
    });
    expect(list.type.toString()).toBe('list<real<0<..>^1>');
  });

  test('a value of the other name of `x > y` moves the subject', () => {
    // The fact refines the one of `x` and `y` that has no value
    // (`soleSelfSubject`), so a value given to `y` or taken from it changes
    // the type of `x`, although the fact contributes nothing to `y`.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('y', 'real');
    ce.assume(ce.parse('x > y'));
    const e = ce.box(['Add', 'x', 1]);
    expect(e.type.toString()).toBe('number');
    ce.assign('y', 0);
    expect(e.type.toString()).toBe('real');
    (ce.lookupDefinition('y') as any).value.value = undefined;
    expect(e.type.toString()).toBe('number');
    ce.withValues({ y: 0 }, () => {
      expect(e.type.toString()).toBe('real');
    });
    expect(e.type.toString()).toBe('number');
  });

  test('an assumption about another name moves no type version', () => {
    // Counted with and without the unrelated fact `a > 0`.
    const counts = (assume: boolean) => {
      const ce = new ComputeEngine();
      if (assume) ce.assume(ce.parse('a > 0'));
      ce.assign(
        'f',
        ce.box([
          'Function',
          [
            'Block',
            ['Declare', 'y', "'integer'", ['Add', 'x', 1]],
            ['Multiply', 2, 'y'],
          ],
          'x',
        ])
      );
      ce.declare('z', 'real');
      const v0 = ce._typeVersion;
      for (let i = 1; i <= 5; i++) ce.box(['f', i]).evaluate();
      const v1 = ce._typeVersion;
      for (let i = 1; i <= 5; i++)
        ce.withValues({ z: i }, () => ce.box(['Add', 'z', 1]).evaluate());
      return [v1 - v0, ce._typeVersion - v1];
    };
    expect(counts(true)).toEqual(counts(false));
  });
});
