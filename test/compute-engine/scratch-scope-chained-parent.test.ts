import { ComputeEngine } from '../../src/compute-engine';
import { withScratchScope } from '../../src/compute-engine/scratch-scopes';
import { withValueShield } from '../../src/compute-engine/boxed-expression/utils';
import type { StateEvent } from '../../src/compute-engine/engine-configuration-lifecycle';

// A scratch scope (`scratch-scopes.ts`) is a scope that a computation
// registers while it runs: a declaration into it, or into a scope created
// under it, advances no engine-wide cache version, because the pop that ends
// the computation discards the binding. `scratchRootOf` decides "created
// under" by walking the parent links. A persistent local scope (the local
// scope of a block, a sum, a comprehension) is chained onto the ambient
// scope while the node evaluates: its parent link is re-pointed for the life
// of the frame (`pushEvalContext`, `engine-scope.ts`). A block boxed outside
// the scratch scope and evaluated inside it then sat under the scratch scope
// through the re-pointed link, and a `Declare` the block runs was classified
// scratch, although the block's scope and the binding outlive the
// computation. The walk now follows the link the scope had before it was
// chained (`chainedScopeOf`, `scope-chaining.ts`).
//
// The two value shields (`simplifyValueBlind` in `simplify.ts`,
// `withValueShield` in `utils.ts`) register their scope only while their
// shadow declarations are made: a name the shielded work declares with a
// value after a cache was filled inside the shield must retire that cache,
// and a scope created inside the shield can escape with the result.

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
// global scope. A `Declare` statement in the body declares into the block's
// local scope when the block runs.
const BLOCK = [
  'Block',
  ['Declare', 't', "'integer'"],
  ['Assign', 't', 3],
  ['Add', 't', 1],
];

describe('a declaration into a scope chained onto a scratch scope', () => {
  test('is not a scratch declaration', () => {
    const ce = new ComputeEngine();
    const block = ce.box(BLOCK);
    const events = trapDeclares(ce);
    ce.pushScope();
    const scratch = ce.context.lexicalScope;
    const result = withScratchScope(ce as any, scratch, () => block.evaluate());
    ce.popScope();
    expect(result.json).toBe(4);
    expect(events).toHaveLength(1);
    expect(events[0].kind === 'declare' && events[0].scratch).toBeUndefined();
    // The binding outlives the scratch computation.
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

describe('a value shield registers its scope for its shadow declarations only', () => {
  test('a block run inside the shield keeps its declaration (not scratch)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const block = ce.box([
      'Block',
      ['Declare', 't', "'integer'"],
      ['Assign', 't', 3],
      ['Add', 't', 'x'],
    ]);
    const events = trapDeclares(ce);
    // The shield hides the value of `x`: the block sees `x` valueless.
    const result = withValueShield(ce, ['x'], () => block.evaluate());
    expect(result.toString()).toBe('x + 3');
    const declaresOfT = events.filter(
      (e) => e.kind === 'declare' && e.scratch === true
    );
    // Only the shield declaration of `x` is scratch; the `Declare` of `t`
    // in the block is not.
    expect(declaresOfT).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  test('a name the shielded work declares with a value retires the caches', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('y', 1);
    const e = ce.parse('y+1');
    const events = trapDeclares(ce);
    const signs = withValueShield(ce, ['x'], () => {
      const before = e.sgn;
      // Declared into the shield scope after the sign was cached: not a
      // scratch declaration, so the `any` axis advances and the cached
      // positive sign is not served for the value `-2`.
      ce.declare('y', { type: 'integer', value: -3 });
      return [before, e.sgn, e.evaluate().json];
    });
    expect(signs[0]).toBe('positive');
    expect(signs[1]).not.toBe('positive');
    expect(signs[2]).toBe(-2);
    expect(events).toHaveLength(2);
    expect(events[0].kind === 'declare' && events[0].scratch).toBe(true);
    expect(events[1].kind === 'declare' && events[1].scratch).toBeUndefined();
    // The shield scope is popped: `y` reads its outer value again.
    expect(e.evaluate().json).toBe(2);
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
