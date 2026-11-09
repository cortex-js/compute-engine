import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// CE-1102: when a name gains a definition, the engine re-derives the stored
// function bodies that applied the name while it had no definition
// (`repairProvisionalDependents()`, `function-utils.ts`). Only a body that
// can see the new binding needs this: one made in the scope that holds the
// binding, or in a scope under it, or a function that assigns the name as a
// local of its own body (`closure-reroot-frames.test.ts` has that case).
// Three callers ran the repair without the
// scope of the binding (`setSymbolValue()`, the repair that follows a
// rebuild, the deferred repair), and then every waiting body was re-derived,
// also the bodies of a scope that the host had popped and discarded. A host
// that pops and pushes a scope at each edit of a document declares the same
// names again each time, so each edit re-derived the bodies of all the
// earlier scopes, until the collector freed them.
//
// The tests hold the definitions of the discarded scopes, so the collector
// cannot free them, and the result does not depend on a collection. They
// observe a re-derivation by the identity of the stored literal: a
// re-derivation installs a new literal. The identities are compared with
// `===`, not with `toBe()`: for two different expressions, Jest prints the
// difference of the two objects, and that walk does not end.

type Definition = {
  operator?: { _lambdaLiteral?: Expression };
  value?: { value?: Expression };
};

/** The `Function` literal that the definition `def` holds now. */
function literalOf(def: unknown): Expression | undefined {
  const d = def as Definition;
  return d.operator?._lambdaLiteral ?? d.value?.value;
}

/** `x ↦ head(x) + 1`. With `head` undeclared, the body applies `head`
 * provisionally, and the definition that holds it waits on `head`. */
function applying(ce: ComputeEngine, head: string): Expression {
  return ce.box(['Function', ['Add', [head, 'x'], 1], 'x'] as any);
}

/** `x ↦ 2x` */
function doubling(ce: ComputeEngine): Expression {
  return ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any);
}

/** Give `name` a function value through `setSymbolValue()`: the name is
 * declared first, so the assignment writes the value of an existing
 * definition. */
function declareThenAssign(ce: ComputeEngine, name: string): void {
  ce.declare(name, 'function');
  ce.assign(name, doubling(ce));
}

describe('CE-1102: a repair re-derives only the definitions that see the new binding', () => {
  test('a definition of a discarded scope is not re-derived', () => {
    const ce = new ComputeEngine();
    const discarded: { def: unknown; literal: Expression | undefined }[] = [];
    for (let pass = 0; pass < 5; pass++) {
      ce.pushScope();
      ce.assign('f', applying(ce, 'h'));
      const def = ce.lookupDefinition('f');
      discarded.push({ def, literal: literalOf(def) });
      ce.popScope();

      ce.pushScope();
      declareThenAssign(ce, 'h');
      ce.popScope();

      for (const entry of discarded)
        expect(literalOf(entry.def) === entry.literal).toBe(true);
    }
  });

  test('a definition in the scope of the new binding is re-derived', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('f', applying(ce, 'h'));
    const before = literalOf(ce.lookupDefinition('f'));
    declareThenAssign(ce, 'h');
    expect(literalOf(ce.lookupDefinition('f')) === before).toBe(false);
    expect(ce.box(['f', 2]).evaluate().json).toEqual(5);
    ce.popScope();
  });

  test('a definition in a kept scope under the scope of the new binding is re-derived', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('f', applying(ce, 'h'));
    const kept = ce.context.lexicalScope;
    ce.popScope();

    declareThenAssign(ce, 'h');

    ce.pushScope(kept);
    expect(ce.box(['f', 2]).evaluate().json).toEqual(5);
    ce.popScope();
  });

  test('a definition in a scope that shares the binding is re-derived', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const base = ce.context.lexicalScope;
    ce.pushScope();
    ce.declare('h', 'function');
    const shared = ce.lookupDefinition('h')!;
    ce.popScope();

    // Two scopes with the same parent hold the binding of `h`. Neither is
    // above the other.
    const first = ce.createScope({ h: shared }, base);
    ce.pushScope(first);
    ce.assign('f', applying(ce, 'h'));
    const def = ce.lookupDefinition('f');
    const before = literalOf(def);
    ce.popScope();

    const second = ce.createScope({ h: shared }, base);
    ce.pushScope(second);
    ce.assign('h', doubling(ce));
    ce.popScope();

    expect(literalOf(def) === before).toBe(false);
    ce.popScope();
  });

  test('the repair that follows a rebuild skips a discarded scope', () => {
    const ce = new ComputeEngine();
    // Discarded scope: `outer` waits on `mid`.
    ce.pushScope();
    ce.assign('outer', applying(ce, 'mid'));
    const deadOuter = ce.lookupDefinition('outer');
    const deadLiteral = literalOf(deadOuter);
    ce.popScope();

    // New scope: `outer` waits on `mid`, and `mid` waits on `base`. The
    // definition of `base` rebuilds `mid`, and the rebuild of `mid` is
    // followed by a repair of the definitions that wait on `mid`.
    ce.pushScope();
    ce.assign('mid', applying(ce, 'base'));
    ce.assign('outer', applying(ce, 'mid'));
    declareThenAssign(ce, 'base');
    // base(2) = 4, mid(2) = 5, outer(2) = 6
    expect(ce.box(['outer', 2]).evaluate().json).toEqual(6);
    ce.popScope();

    expect(literalOf(deadOuter) === deadLiteral).toBe(true);
  });
});
