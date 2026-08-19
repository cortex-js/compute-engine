/**
 * `BoxedFunction`'s `_type`, `_sgn` and `_eagerSource` slots once selected a
 * generation-INDEPENDENT cache key when a node's operands were all constant
 * and the node was pure. The premise — "nothing can change such a node's
 * answer" — holds for the operands and not for the OPERATOR: rewriting a user
 * function's definition in place changes what `f(2)` types as while `2` stays
 * every bit as constant, and an entry stamped with no generation is reached by
 * no invalidation counter, so the node answered from the pre-redefinition
 * state for the rest of the engine's life.
 *
 * Two layers of pin below. The BEHAVIORAL one is the witness: `f(2)`'s type
 * read before and after a redefinition, compared against a freshly boxed node,
 * which is the oracle because it has cached nothing. The STRUCTURAL one reads
 * the cache slot's key directly, because only `type` has a user-reachable
 * witness today — `sgn` declines on every node whose operator lacks a sign
 * derivation, and no operator that has one can be redefined in place, while
 * `_eagerSource` is reached only by a lazy collection whose operator offers no
 * `collection.at` handler. Those two slots shared the identical key selection
 * and lost it defensively; asserting on the key is what keeps them pinned
 * without a witness to write.
 *
 * Settled empirically as the exit criterion of stage C1 of the checkpoint
 * work — see "Generation keys and constant nodes" in
 * `docs/CHECKPOINT-MODEL.md`. A restore reaches the
 * same entries the same way, so leaving them unkeyed would have made
 * restore-then-replay serve pre-restore answers.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

describe('all-constant pure nodes key on the engine generation', () => {
  test('`type` follows an in-place redefinition of the operator', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'f(x) = x + 1');

    const node = ce.box(['f', 2]);
    // The premise the removed key rested on: every operand is constant and
    // the node is pure. Both still hold — what changed is the conclusion.
    expect(node.ops!.every((x) => x.isConstant)).toBe(true);
    expect(node.isPure).toBe(true);
    expect(node.type.toString()).toBe('number');

    executeEpsil(ce, 'f(x) = "hello"');

    const fresh = ce.box(['f', 2]);
    expect(fresh.type.toString()).toBe('string');
    expect(node.type.toString()).toBe(fresh.type.toString());
  });

  test('the `type` and `sgn` slots are stamped with a generation, not left unkeyed', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'f(x) = x + 1');

    const node = ce.box(['f', 2]);
    expect(node.ops!.every((x) => x.isConstant)).toBe(true);
    expect(node.isPure).toBe(true);

    // Fill both slots, then read the keys they were stamped with. `undefined`
    // is the unkeyed shape: an entry no counter reaches.
    node.type;
    node.sgn;
    expect(typeof (node as any)._type.generation).toBe('number');
    expect(typeof (node as any)._sgn.generation).toBe('number');
  });

  test('a lazy collection view still tracks an in-place redefinition', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'h(x) = x + 1');

    // `Map(callback, collection)` — the callback comes first.
    const node = ce.box(['Map', 'h', ['List', 10, 20, 30]]);
    expect(node.at(1)?.toString()).toBe('11');

    executeEpsil(ce, 'h(x) = x * 100');

    const fresh = ce.box(['Map', 'h', ['List', 10, 20, 30]]);
    expect(fresh.at(1)?.toString()).toBe('1000');
    expect(node.at(1)?.toString()).toBe(fresh.at(1)?.toString());
  });

  test('a genuinely constant node still answers from cache', () => {
    // Removing the key must not have changed any ANSWER for a node whose
    // operator cannot move: the point of the change is invalidation, not
    // arithmetic.
    const ce = new ComputeEngine();
    const node = ce.parse('2 + 3 \\times 5');
    const before = node.type.toString();
    ce.assign('t', ce.number(1)); // advances the generation
    expect(node.type.toString()).toBe(before);
    expect(node.evaluate().toString()).toBe('17');
  });
});
