import { ComputeEngine } from '../../src/compute-engine';
import type { Scope } from '../../src/compute-engine/global-types';

// Two defects of the pop of a scope:
//
// - Two scope objects can hold one value definition (the local scopes of two
//   lazy comprehensions that two calls of one function return, or one scope
//   pushed twice by a recursive call). The pop of the inner context disposed
//   the definition while the outer context still read it. A disposed
//   definition is treated as dead by the assumptions and by the caches keyed
//   on its change counter. Each live context that holds a definition is now
//   counted on it, and only the pop of the last one disposes it. The
//   temporary context of `inScope` is not counted, and the `ce.contextStack`
//   setter counts the frames that it adds and stops counting the ones that it
//   drops.
// - An asynchronous evaluation of a `Sum` pushes a copy of the local scope of
//   the `Sum` (an activation), not the local scope itself. Its pop did not put
//   a tombstone on the definitions of the local scope, to which the symbols
//   of the body are bound. With the debug check of dead bindings
//   (`ce._debugBindings`) on, a read of such a symbol after the evaluation was
//   reported after `evaluate()`, but not after `evaluateAsync()`. The pop of
//   any evaluation now puts the tombstones back; an evaluation of the same
//   node still suspended on its own copy of the stack reads the definitions
//   of its own copy, and the check reads those.

function engine(debug = true): ComputeEngine {
  const ce = new ComputeEngine();
  ce._debugBindings = debug;
  return ce;
}

/**
 * Declare `probe(x, ...)`, which gives `x` and records whether a live
 * context is counted as a holder of the value definition that `name` has in
 * the current context when it is called. Its other operands are evaluated
 * before it is called.
 *
 * The `disposed` flag cannot show this for a binder index: the pop at the
 * end of the canonicalization of the binder disposes it, and a later push of
 * the scope does not undo that.
 */
function declareProbe(ce: ComputeEngine, name: string): boolean[] {
  const seen: boolean[] = [];
  ce.declare('probe', {
    signature: '(any, any) -> any',
    evaluate: (ops, { engine: e }) => {
      const def = e.lookupDefinition(name);
      if (def !== undefined && 'value' in def)
        seen.push(holders(def.value) > 0);
      return ops[0];
    },
  });
  return seen;
}

/** The number of live contexts counted as holders of `def`. */
function holders(def: object): number {
  return (def as { _holders: number })._holders;
}

/** Assign `u := l => [probe(l[ceil(i/2)], i) for i in 1..2 * Length(l)]`. */
function declareU(ce: ComputeEngine): void {
  ce.declare('u', 'function');
  ce.assign(
    'u',
    ce.box([
      'Function',
      [
        'Comprehension',
        ['probe', ['At', 'l', ['Ceil', ['Divide', 'i', 2]]], 'i'],
        ['Element', 'i', ['Range', 1, ['Multiply', 2, ['Length', 'l']]]],
      ],
      'l',
    ])
  );
  ce.assign('base', ce.box(['List', 1, 2]));
}

/**
 * A scope that holds the value definition of `x` and that no live context
 * holds: the frame that declared it leaves the stack by the `contextStack`
 * setter, which disposes nothing.
 */
function detachedScope(ce: ComputeEngine) {
  ce.pushScope();
  ce.declare('x', 'integer');
  ce.assign('x', 5);
  const x = ce.symbol('x');
  const def = x.valueDefinition!;
  const owner = ce.context.lexicalScope;
  ce.contextStack = ce.contextStack.slice(0, -1);
  const copy = (): Scope => ({
    parent: owner.parent,
    bindings: new Map(owner.bindings),
  });
  return { x, def, copy };
}

// The frames below are popped as the engine pops an evaluation frame (a
// block, a loop): such a pop disposes the definitions that no other live
// context holds. `ce.popScope()` keeps the definitions of its scope.
describe('A pop leaves a definition that another live context holds', () => {
  for (const debug of [true, false]) {
    const flag = debug ? 'debug check on' : 'debug check off';

    test(`two scopes that hold one definition (${flag})`, () => {
      const ce = engine(debug);
      const { x, def, copy } = detachedScope(ce);
      expect(def.disposed).toBe(false);
      ce.pushScope(copy());
      ce.pushScope(copy());
      ce._popEvalContext();
      expect(def.disposed).toBe(false);
      expect(x.evaluate().toString()).toBe('5');
      // The pop of the last context that holds the definition ends it.
      ce._popEvalContext();
      expect(def.disposed).toBe(true);
      if (debug) expect(() => x.evaluate()).toThrow(/discarded scope/);
    });

    test(`a copy of the scope of the declaring frame, popped (${flag})`, () => {
      // The definition is declared after the push of its frame.
      const ce = engine(debug);
      ce.pushScope();
      ce.declare('x', 'integer');
      ce.assign('x', 5);
      const x = ce.symbol('x');
      const def = x.valueDefinition!;
      const S = ce.context.lexicalScope;
      ce.pushScope({ parent: S, bindings: new Map(S.bindings) });
      ce._popEvalContext();
      expect(def.disposed).toBe(false);
      expect(x.evaluate().toString()).toBe('5');
      ce._popEvalContext();
      expect(def.disposed).toBe(true);
      if (debug) expect(() => x.evaluate()).toThrow(/discarded scope/);
    });

    test(`a definition removed from the scope of a live frame keeps no count (${flag})`, () => {
      const ce = engine(debug);
      const { def, copy } = detachedScope(ce);
      ce.pushScope(copy());
      expect(holders(def)).toBe(1);
      ce.context.lexicalScope.bindings.delete('x');
      ce._popEvalContext();
      expect(holders(def)).toBe(0);
      // The pop does not dispose a definition that its scope no longer holds.
      expect(def.disposed).toBe(false);
      ce.pushScope(copy());
      ce._popEvalContext();
      expect(def.disposed).toBe(true);
    });

    test(`a definition replaced in the scope of a live frame keeps no count (${flag})`, () => {
      const ce = engine(debug);
      const first = detachedScope(ce);
      const second = detachedScope(ce);
      const old = first.def;
      const replacement = second.def;
      ce.pushScope(first.copy());
      expect([holders(old), holders(replacement)]).toEqual([1, 0]);
      // A route other than a declaration replaces the binding.
      ce.context.lexicalScope.bindings.set(
        'x',
        second.copy().bindings.get('x')!
      );
      ce._popEvalContext();
      expect([holders(old), holders(replacement)]).toEqual([0, 0]);
      // The pop disposes the definition that its scope holds, not the one
      // that was replaced.
      expect(old.disposed).toBe(false);
      expect(replacement.disposed).toBe(true);
    });

    test(`the setter drops the last holder of a definition a pop kept (${flag})`, () => {
      const ce = engine(debug);
      const { x, def, copy } = detachedScope(ce);
      const below = ce.contextStack;
      ce.pushScope(copy());
      ce.pushScope(copy());
      ce._popEvalContext();
      expect(def.disposed).toBe(false);
      ce.contextStack = below;
      expect(holders(def)).toBe(0);
      expect(def.disposed).toBe(true);
      if (debug) expect(() => x.evaluate()).toThrow(/discarded scope/);
    });

    test(`the setter does not count again a discarded frame (${flag})`, () => {
      const ce = engine(debug);
      const { def, copy } = detachedScope(ce);
      ce.pushScope(copy());
      const saved = ce.contextStack;
      ce._popEvalContext();
      expect(def.disposed).toBe(true);
      ce.contextStack = saved;
      expect(holders(def)).toBe(0);
      ce.contextStack = saved.slice(0, -1);
      expect(holders(def)).toBe(0);
    });

    test(`declarations and removals keep the record of the global frame bounded (${flag})`, () => {
      const ce = engine(debug);
      const global = ce.contextStack.find((c) => c.name === 'global')!;
      const before = global._countedDefs?.size ?? 0;
      for (let i = 0; i < 50; i++) {
        ce.declare('v', 'integer');
        ce.assign('v', i);
        ce.undeclare('v');
      }
      expect(global._countedDefs?.size ?? 0).toBe(before);
    });

    test(`a definition under two names in one scope counts once (${flag})`, () => {
      const ce = engine(debug);
      const { def, copy } = detachedScope(ce);
      const scope = copy();
      scope.bindings.set('y', scope.bindings.get('x')!);
      ce.pushScope(scope);
      expect(holders(def)).toBe(1);
      ce._popEvalContext();
      expect(holders(def)).toBe(0);
      expect(def.disposed).toBe(true);
    });

    test(`the setter does not count the temporary context of inScope (${flag})`, () => {
      const ce = engine(debug);
      const { def, copy } = detachedScope(ce);
      const outside = ce.contextStack;
      let inside: typeof outside = [];
      ce._inScope(copy(), () => {
        inside = ce.contextStack;
      });
      ce.contextStack = inside;
      expect(holders(def)).toBe(0);
      ce.contextStack = outside;
      expect(holders(def)).toBe(0);
    });

    test(`a frame dropped by the contextStack setter holds nothing (${flag})`, () => {
      const ce = engine(debug);
      const { def, copy } = detachedScope(ce);
      ce.pushScope(copy());
      const below = ce.contextStack.slice(0, -1);
      ce.pushScope(copy());
      const top = ce.context;
      // Drop the lower frame and keep the upper one: the setter disposes
      // nothing, and the pop of the upper frame ends the definition.
      ce.contextStack = [...below, top];
      expect(def.disposed).toBe(false);
      ce._popEvalContext();
      expect(def.disposed).toBe(true);
    });

    test(`a temporary context of inScope does not hold a definition (${flag})`, () => {
      const ce = engine(debug);
      const { def, copy } = detachedScope(ce);
      ce._inScope(copy(), () => {
        ce.pushScope(copy());
        ce._popEvalContext();
      });
      // `inScope` pops its context without disposing anything, so the pop
      // inside it disposes the definition.
      expect(def.disposed).toBe(true);
    });

    test(`a lazy comprehension returned by a call, read through another call (${flag})`, () => {
      const ce = engine(debug);
      const seen = declareProbe(ce, 'i');
      declareU(ce);
      const r = ce.box(['u', ['u', 'base']]).evaluate();
      expect([...r.each()].map((x) => x.re)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((held) => held)).toBe(true);
    });

    test(`two asynchronous evaluations of u(u(base)) at the same time (${flag})`, async () => {
      const ce = engine(debug);
      const seen = declareProbe(ce, 'i');
      declareU(ce);
      const e = ce.box(['ListFrom', ['u', ['u', 'base']]]);
      const [a, b] = await Promise.all([e.evaluateAsync(), e.evaluateAsync()]);
      expect(a.toString()).toBe('[1,1,1,1,2,2,2,2]');
      expect(b.toString()).toBe('[1,1,1,1,2,2,2,2]');
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((held) => held)).toBe(true);
    });

    test(`a recursive call that runs the same Sum (${flag})`, () => {
      // The body of `f` holds one `Sum` node, so each call pushes the same
      // local scope. The index of the outer call is read after the inner
      // call has popped that scope.
      const ce = engine(debug);
      const seen = declareProbe(ce, 'k');
      ce.declare('f', 'function');
      ce.assign(
        'f',
        ce.box([
          'Function',
          [
            'If',
            ['LessEqual', 'n', 0],
            0,
            [
              'Sum',
              ['probe', 'k', ['f', ['Subtract', 'n', 1]]],
              ['Limits', 'k', 1, 2],
            ],
          ],
          'n',
        ])
      );
      expect(ce.box(['f', 3]).evaluate().toString()).toBe('3');
      expect(seen.length).toBe(14);
      expect(seen.every((held) => held)).toBe(true);
    });
  }

  test.each([false, true])(
    'a host scope that keeps its definitions, popped after another frame of the same scope (debug %s)',
    (debug) => {
      const ce = new ComputeEngine();
      (ce as unknown as { _debugBindings: boolean })._debugBindings = debug;
      const scope: Scope = {
        parent: ce.context.lexicalScope,
        bindings: new Map(),
      };
      ce.pushScope(scope);
      ce.declare('x', { type: 'integer', value: 5 });
      const e = ce.box(['Add', 'x', 1]);
      // A frame of the same scope that does not keep its definitions: its
      // pop leaves the definition to the host scope, which still holds it.
      ce._pushEvalContext(scope);
      ce._popEvalContext();
      ce.popScope();
      const def = (scope.bindings.get('x') as { value: { disposed: boolean } })
        .value;
      expect(def.disposed).toBe(false);
      expect(e.evaluate().json).toBe(6);
    }
  );
});

// The index of a `Sum` is a static definition; its value belongs to one
// evaluation of the sum (an activation). Read after the sum, it has no
// value, and the pop of the activation does not tombstone it (`docs/plans/2026-11-11-bound-once-spec.md`, section 11).
describe('An index read after its Sum has no value', () => {
  /** A `Sum` and the symbol `k` of its body. */
  function sumAndIndex(ce: ComputeEngine) {
    const e = ce.box(['Sum', ['Multiply', 'k', 2], ['Limits', 'k', 1, 3]]);
    const k = e.op1.ops!.find((x) => x.symbol === 'k')!;
    return { e, k };
  }

  test('a read of the index after evaluate()', () => {
    const ce = engine();
    const { e, k } = sumAndIndex(ce);
    expect(e.evaluate().toString()).toBe('12');
    expect(k.evaluate().toString()).toBe('k');
  });

  test('a read of the index after evaluateAsync()', async () => {
    const ce = engine();
    const { e, k } = sumAndIndex(ce);
    expect((await e.evaluateAsync()).toString()).toBe('12');
    expect(k.evaluate().toString()).toBe('k');
  });

  test('evaluate(), then evaluateAsync(), then evaluate()', async () => {
    const ce = engine();
    const { e, k } = sumAndIndex(ce);
    expect(e.evaluate().toString()).toBe('12');
    expect((await e.evaluateAsync()).toString()).toBe('12');
    expect(e.evaluate().toString()).toBe('12');
    expect(k.evaluate().toString()).toBe('k');
  });

  test('two asynchronous evaluations at the same time, then evaluate()', async () => {
    const ce = engine();
    const { e, k } = sumAndIndex(ce);
    const [a, b] = await Promise.all([e.evaluateAsync(), e.evaluateAsync()]);
    expect([a.toString(), b.toString()]).toEqual(['12', '12']);
    expect(e.evaluate().toString()).toBe('12');
    expect(k.evaluate().toString()).toBe('k');
  });

  test('a Sum with a Block body, evaluated, then evaluated asynchronously', async () => {
    const ce = engine();
    const e = ce.box([
      'Sum',
      ['Block', ['Declare', 't', "'unknown'", ['Multiply', 2, 'k']], 't'],
      ['Tuple', 'k', 1, 3],
    ]);
    expect(e.evaluate().toString()).toBe('12');
    expect((await e.evaluateAsync()).toString()).toBe('12');
    expect((await e.evaluateAsync()).toString()).toBe('12');
  });

  test('a suspended asynchronous evaluation and a synchronous one', async () => {
    const ce = engine();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    ce.declare('slow', {
      signature: '(integer) -> integer',
      evaluateAsync: async (ops, { engine: e }) => {
        await gate;
        return e.number(ops[0].re);
      },
    });
    const e = ce.box(['Sum', ['slow', 'k'], ['Limits', 'k', 1, 3]]);
    const k = e.op1.ops!.find((x) => x.symbol === 'k')!;
    const pending = e.evaluateAsync();
    // The synchronous evaluation ends while the asynchronous one is
    // suspended: a read of the index after it is reported.
    e.evaluate();
    expect(k.evaluate().toString()).toBe('k');
    // The suspended evaluation reads its own index: no report.
    release();
    expect((await pending).toString()).toBe('6');
    expect(k.evaluate().toString()).toBe('k');
  });

  test('an asynchronous evaluation that never ends', () => {
    const ce = engine();
    ce.declare('never', {
      signature: '(integer) -> integer',
      evaluateAsync: () => new Promise(() => {}),
    });
    const e = ce.box(['Sum', ['never', 'k'], ['Limits', 'k', 1, 3]]);
    const k = e.op1.ops!.find((x) => x.symbol === 'k')!;
    void e.evaluateAsync();
    e.evaluate();
    expect(k.evaluate().toString()).toBe('k');
  });

  test('a nested Sum evaluated asynchronously, twice at the same time', async () => {
    const ce = engine();
    const e = ce.box([
      'Sum',
      ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'j', 1, 'k']],
      ['Limits', 'k', 1, 3],
    ]);
    expect(e.evaluate().toString()).toBe('25');
    const [a, b] = await Promise.all([e.evaluateAsync(), e.evaluateAsync()]);
    expect([a.toString(), b.toString()]).toEqual(['25', '25']);
  });
});

describe('The debug check and overlapping asynchronous evaluations', () => {
  test('evaluate(), then a pending evaluateAsync(): the index has no value', () => {
    const ce = engine();
    ce.declare('never', {
      signature: '(integer) -> integer',
      evaluateAsync: () => new Promise(() => {}),
    });
    const e = ce.box(['Sum', ['never', 'k'], ['Limits', 'k', 1, 3]]);
    const k = e.op1.ops!.find((x) => x.symbol === 'k')!;
    e.evaluate();
    void e.evaluateAsync();
    expect(k.evaluate().toString()).toBe('k');
  });

  test('two overlapping evaluateAsync() of a node that reads a constant', async () => {
    const ce = engine();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    ce.declare('wait', {
      signature: '(integer) -> integer',
      evaluateAsync: async (ops, { engine: e }) => {
        calls += 1;
        if (calls === 1) await gate;
        return e.number(ops[0].re);
      },
    });
    // `const c = 2` in a block of the body of the `Sum`.
    const e = ce.box([
      'Sum',
      [
        'Block',
        [
          'Declare',
          'c',
          [
            'Dictionary',
            ['KeyValuePair', "'value'", 2],
            ['KeyValuePair', "'constant'", 'True'],
          ],
        ],
        ['Multiply', 'c', ['wait', 'k']],
      ],
      ['Limits', 'k', 1, 2],
    ]);
    // The first evaluation is suspended in its first `wait`; the second one
    // ends, and its pop tombstones the definitions of the local scopes.
    const first = e.evaluateAsync();
    expect((await e.evaluateAsync()).toString()).toBe('6');
    release();
    expect((await first).toString()).toBe('6');
  });
});
