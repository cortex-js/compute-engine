import { ComputeEngine } from '../../src/compute-engine';
import { withScratchScope } from '../../src/compute-engine/scratch-scopes';
import { withValueShield } from '../../src/compute-engine/boxed-expression/utils';
import type { StateEvent } from '../../src/compute-engine/engine-configuration-lifecycle';

// A scratch scope (`scratch-scopes.ts`) is a scope that a computation
// registers while it runs: a declaration into it, or into a scope created
// under it, advances no engine-wide cache version, because the pop that ends
// the computation discards the binding. `scratchRootOf` decides "created
// under" by walking the parent links. An evaluation of a block runs in an
// activation of its scope, linked to the scope it is evaluated in (`docs/plans/2026-11-11-bound-once-spec.md`, section 11): a `Declare` that the run
// makes is a declaration of the run, which ends with it, and under a scratch
// scope it is scratch. The static scope of the block keeps its binding.
//
// The two value shields (`simplifyValueBlind` in `simplify.ts`,
// `withValueShield` in `utils.ts`) hide values without a scope and without a
// declaration (`withHiddenValues()`): a write that the shielded work makes
// after a cache was filled inside the shield retires that cache.

function trapDeclares(ce: ComputeEngine): StateEvent[] {
  const events: StateEvent[] = [];
  const lifecycle = (ce as any)._configurationLifecycle;
  const proto = Object.getPrototypeOf(lifecycle);
  const original = proto.noteStateEvent;
  proto.noteStateEvent = function (e: StateEvent) {
    if (e.kind === 'declare') events.push(e);
    return original.call(this, e);
  };
  return events;
}

// Boxed in the global scope: the block's local scope is created under the
// global scope. The local of the `Declare` statement is declared when the
// block is boxed; a run of the block writes its value and declares nothing.
const BLOCK = [
  'Block',
  ['Declare', 't', "'integer'", 3],
  ['Add', 't', 1],
];

describe('a declaration into a scope chained onto a scratch scope', () => {
  test('a run of a block evaluated in the scratch scope declares nothing', () => {
    const ce = new ComputeEngine();
    const block = ce.box(BLOCK);
    const events = trapDeclares(ce);
    ce.pushScope();
    const scratch = ce.context.lexicalScope;
    const result = withScratchScope(ce as any, scratch, () => block.evaluate());
    ce.popScope();
    expect(result.json).toBe(4);
    expect(events).toHaveLength(0);
    // The static binding of the block outlives the scratch computation.
    expect((block as any).localScope.bindings.has('t')).toBe(true);
  });

  test('a declaration into the scratch scope itself is scratch', () => {
    const ce = new ComputeEngine();
    const events = trapDeclares(ce);
    ce.pushScope();
    const scratch = ce.context.lexicalScope;
    const before = ce._anyVersion;
    withScratchScope(ce as any, scratch, () => ce.declare('u', 'integer'));
    expect(ce._anyVersion - before).toBe(0);
    ce.popScope();
    expect(events).toHaveLength(1);
    expect(events[0].kind === 'declare' && events[0].scratch).toBe(true);
  });

  test('the chained scope has its own parent link back after the evaluation', () => {
    const ce = new ComputeEngine();
    const block = ce.box(BLOCK);
    const parent = (block as any).localScope.parent;
    ce.pushScope();
    const scratch = ce.context.lexicalScope;
    withScratchScope(ce as any, scratch, () => block.evaluate());
    ce.popScope();
    expect((block as any).localScope.parent).toBe(parent);
  });
});

describe('a value shield declares nothing', () => {
  test('a block run inside the shield declares nothing', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const block = ce.box([
      'Block',
      ['Declare', 't', "'integer'", 3],
      ['Add', 't', 'x'],
    ]);
    const events = trapDeclares(ce);
    // The shield hides the value of `x`: the block sees `x` valueless.
    const result = withValueShield(ce, ['x'], () => block.evaluate());
    expect(result.toString()).toBe('x + 3');
    const declaresOfT = events.filter(
      (e) => e.kind === 'declare' && e.scratch === true
    );
    // The shield declares nothing, and the run of the block declares
    // nothing either.
    expect(declaresOfT).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test('a value the shielded work assigns retires the caches', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('y', 1);
    const e = ce.parse('y+1');
    const events = trapDeclares(ce);
    const signs = withValueShield(ce, ['x'], () => {
      const before = e.sgn;
      // Assigned after the sign was cached: the `any` axis advances and the
      // cached positive sign is not served for the value `-2`.
      ce.assign('y', -3);
      return [before, e.sgn, e.evaluate().json];
    });
    expect(signs[0]).toBe('positive');
    expect(signs[1]).not.toBe('positive');
    expect(signs[2]).toBe(-2);
    expect(events).toHaveLength(0);
    // The assignment is not undone by the shield.
    expect(e.evaluate().json).toBe(-2);
  });

  test('simplify still hides the assigned value and keeps the caches', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const abs = ce.box(['Abs', ['Add', 'x', 1]]);
    const before = ce._anyVersion;
    expect(abs.simplify().toString()).toBe('|x + 1|');
    expect(ce._anyVersion - before).toBe(0);
    ce.assign('x', -5);
    expect(abs.simplify().toString()).toBe('|x + 1|');
    expect(abs.evaluate().json).toBe(4);
  });
});
