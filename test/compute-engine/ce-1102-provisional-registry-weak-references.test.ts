import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { ComputeEngine } from '../../src/compute-engine';
import {
  _provisionalDependentCount,
  _provisionalReferenceCount,
} from '../../src/compute-engine/boxed-expression/provisional-application';

// CE-1102: the registry of the definitions whose body applies a name that
// has no definition yet (`provisional-application.ts`) held each definition
// strongly for the life of the engine. A host that pushed a scope, defined
// such functions and popped the scope kept every definition, with its
// literal, and each later declaration of one of those names walked them
// all. The registry now holds weak references: a definition that nothing
// else reaches is collected, and its reference is removed at the next read
// of the name or at the next sweep. A definition that something still
// reaches, such as one in a popped scope that the host keeps and pushes
// again, stays registered and is re-derived as before.

// `--expose-gc` set at run time gives a real collector to a fresh context,
// so the test needs no flag on the command line.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** Yield to the event loop, then collect. A `WeakRef` keeps its target
 * alive until the end of the job that made or dereferenced it, so a
 * collection in the same job frees none of the definitions. */
async function collect(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  gc();
}

/** Collect until the definition that waits on `probe` is collected, at most
 * 20 times. One collection does not always free the definitions of a popped
 * scope when many test workers load the machine, so a test that counts the
 * references of another name must first see a definition of the same scope
 * collected. The read of `probe` removes only the references of `probe`, so
 * the references of the other names stay as the test left them. */
async function collectUntilProbeGone(
  ce: ComputeEngine,
  probe: string
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await collect();
    if (_provisionalDependentCount(ce, probe) === 0) return;
  }
  throw new Error(`the definition that waits on "${probe}" was not collected`);
}

/** Define `fnName := x ↦ head(x) + 1`, with `head` undeclared: the body
 * applies `head` provisionally, and the definition waits on `head`. */
function defineApplying(ce: ComputeEngine, fnName: string, head: string) {
  ce.assign(
    fnName,
    ce.box(['Function', ['Add', [head, 'x'], 1], 'x'] as any)
  );
}

/** The static typing view memoizes the innermost context of the last type
 * read (`innermostFrameMemo`, `static-typing-view.ts`), which keeps the
 * LAST popped scope in memory until a type read under another context. A
 * push, a definition without a provisional reading, and a pop move the memo
 * off the scope under test (CE-1152 records the retention). */
function moveTypingMemo(ce: ComputeEngine): void {
  ce.pushScope();
  ce.assign('memoMover', ce.box(['Function', 1, 'x'] as any));
  ce.popScope();
}

describe('CE-1102: the registry of waiting definitions holds weak references', () => {
  test('the definitions of a discarded scope leave the registry', async () => {
    const ce = new ComputeEngine();
    for (let pass = 0; pass < 6; pass++) {
      ce.pushScope();
      for (let i = 0; i < 20; i++) defineApplying(ce, `f_${i}`, `h_${i}`);
      ce.popScope();
      await collect();
      // One per name at most: the definitions of the earlier passes were
      // collected. Before the fix, `pass + 1` definitions waited on `h_0`.
      expect(_provisionalDependentCount(ce, 'h_0')).toBeLessThanOrEqual(1);
    }
    moveTypingMemo(ce);
    await collect();
    expect(_provisionalDependentCount(ce, 'h_0')).toBe(0);
    expect(_provisionalDependentCount(ce, 'h_19')).toBe(0);
    // A declaration of a name that only collected bodies applied has
    // nothing to re-derive and throws nothing.
    expect(() => ce.declare('h_0', '(real) -> real')).not.toThrow();
  });

  test('a kept scope that is pushed again is still re-derived', async () => {
    // The pattern of a notebook: a group pushes a scope, keeps it, leaves it,
    // and enters it again later. A declaration made while the scope is off
    // the stack must still re-derive the definitions of the scope.
    const ce = new ComputeEngine();
    ce.pushScope();
    const scope = ce.context.lexicalScope;
    defineApplying(ce, 'f', 'h');
    ce.popScope();
    moveTypingMemo(ce);
    await collect();
    // Reachable through `scope`, so still registered.
    expect(_provisionalDependentCount(ce, 'h')).toBe(1);

    ce.declare('h', '(real) -> real');
    expect(_provisionalDependentCount(ce, 'h')).toBe(0);

    ce.pushScope(scope);
    const result = ce.box(['f', 2]).evaluate().toString();
    ce.popScope();

    const control = new ComputeEngine();
    control.declare('h', '(real) -> real');
    defineApplying(control, 'f', 'h');
    expect(result).toBe(control.box(['f', 2]).evaluate().toString());
    expect(result).toBe('1 + h(2)');
  });

  test('a collected definition is skipped and a live one is re-derived', async () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const kept = ce.context.lexicalScope;
    defineApplying(ce, 'fKept', 'h');
    ce.popScope();
    ce.pushScope();
    defineApplying(ce, 'fDropped', 'h');
    ce.popScope();
    moveTypingMemo(ce);
    await collect();
    expect(_provisionalDependentCount(ce, 'h')).toBe(1);

    ce.declare('h', '(real) -> real');
    expect(_provisionalDependentCount(ce, 'h')).toBe(0);
    ce.pushScope(kept);
    expect(ce.box(['fKept', 2]).evaluate().toString()).toBe('1 + h(2)');
    ce.popScope();
  });

  test('withValues() accepts a value for a name that only collected bodies applied', async () => {
    // The one effect of the time of collection: `withValues()` refuses a
    // value for a name that a stored body applies, because the value would
    // rewrite that body for good. A body that nothing reaches cannot be
    // rewritten, so the refusal ends with its collection.
    const ce = new ComputeEngine();
    ce.pushScope();
    defineApplying(ce, 'f', 'k');
    ce.popScope();
    expect(() => ce.withValues({ k: 2 }, () => 1)).toThrow(
      /the body of a function applies "k"/
    );
    moveTypingMemo(ce);
    await collect();
    expect(ce.withValues({ k: 2 }, () => 1)).toBe(1);
  });

  test('a registration sweeps the collected references of a name that is never read', async () => {
    // An undeclared name that the host applies in each edit and never
    // declares is never read, so its collected references are removed by a
    // sweep at a registration, when the set reaches twice its size after
    // the last sweep (at least 16).
    const ce = new ComputeEngine();
    ce.pushScope();
    for (let i = 0; i < 40; i++) defineApplying(ce, `f_${i}`, 'h');
    defineApplying(ce, 'probeFn', 'probeHead');
    ce.popScope();
    moveTypingMemo(ce);
    await collectUntilProbeGone(ce, 'probeHead');
    // No read of `h` yet: the 40 collected references are still there.
    expect(_provisionalReferenceCount(ce, 'h')).toBe(40);

    ce.pushScope();
    for (let i = 0; i < 24; i++) defineApplying(ce, `g_${i}`, 'h');
    // The sweeps of the first pass ran at 16 and at 32 references, when
    // every reference was live, and set the next sweep at 64. The 64th
    // registration swept the 40 collected references.
    expect(_provisionalReferenceCount(ce, 'h')).toBe(24);
    expect(_provisionalDependentCount(ce, 'h')).toBe(24);
    ce.popScope();
  });

  test('a redefinition still removes the superseded definition', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    ce.parse('g(t)\\coloneq 3a(t)').evaluate();
    expect(_provisionalDependentCount(ce, 'a')).toBe(1);
    expect(_provisionalReferenceCount(ce, 'a')).toBe(1);
  });
});
