import { ComputeEngine } from '../../src/compute-engine';
import { _BoxedValueDefinition } from '../../src/compute-engine/boxed-expression/boxed-value-definition';
import { _BoxedOperatorDefinition } from '../../src/compute-engine/boxed-expression/boxed-operator-definition';
import { _provisionalDependentCount } from '../../src/compute-engine/boxed-expression/provisional-application';
import { withScratchScope } from '../../src/compute-engine/scratch-scopes';
import { inferFunctionLiteralEffects } from '../../src/compute-engine/boxed-expression/effects-inference';
import {
  axisMaskOf,
  EngineConfigurationLifecycle,
  type StateEvent,
} from '../../src/compute-engine/engine-configuration-lifecycle';

// Tycho item 336 (2026-09-29): one `ce.assign` of a function body took
// exponential time in the nesting depth of calls to functions declared with
// an `-> unknown` result whose bodies apply names that no scope declares
// (`b` and `T` below): 2 ms at depth 1, 3.5 s at depth 2, more than 60 s at
// depth 3.
//
// A function declared with a placeholder result reports a signature derived
// from its body, memoized in `_deriveSignature`. The derivation boxes the
// body again in a fresh scope, and the boxing declares each undeclared head
// (`b` in `b(x, y)`) as a function in that scope. That declaration re-derived
// every stored definition waiting on the same name (the provisional repair
// that makes definition order irrelevant), although none of them could see a
// binding in the fresh scope. Each re-derivation replaced a stored literal,
// which invalidated the memoized signatures of the other functions, and
// declared the name again in a fresh scope of its own.
//
// Now the repair skips a declaration that no waiting definition can see, and
// the scope of the derivation is registered as scratch, so the writes to the
// bindings it holds advance no version that a memo keys on. These tests
// check that the reported types do not change, that a real change still
// changes them, and that the number of derivations grows linearly with the
// depth.

const LIMIT = 500;

/** Count the calls to `_deriveSignature` of both definition classes. Past
 * `LIMIT` the spy throws, so that without the fix the test fails at once
 * instead of running for minutes. */
function withDerivationCount<T>(
  f: () => T,
  limit = LIMIT
): { result: T; count: number } {
  const protos = [
    _BoxedValueDefinition.prototype as any,
    _BoxedOperatorDefinition.prototype as any,
  ];
  const originals = protos.map((p) => p._deriveSignature);
  let count = 0;
  protos.forEach((p, i) => {
    p._deriveSignature = function (...args: unknown[]) {
      count += 1;
      if (count > limit) throw new Error('too many signature derivations');
      return originals[i].apply(this, args);
    };
  });
  try {
    return { result: f(), count };
  } finally {
    protos.forEach((p, i) => (p._deriveSignature = originals[i]));
  }
}

const POINT = 'tuple<number, number> | list<tuple<number, number>>';
const E_TYPE =
  '(list<tuple<number, number>> | tuple<number, number>) -> broadcastable<number>';
const W_TYPE =
  '(unknown, list<tuple<number, number>> | tuple<number, number>) -> unknown';

/** The reproduction of Tycho item 336. `W_1` … `W_depth` are declared
 * `(unknown, POINT) -> unknown` and assigned a body that applies the
 * undeclared `b` (and, in the full body, the undeclared `T` in a `Sum`).
 * `E` calls them nested `depth` deep. Returns the engine; the assignment of
 * `E` is the step that hung. */
function setup(
  depth: number,
  body: 'full' | 'minimal',
  options?: { eBody?: 'product' | 'calls' }
): ComputeEngine {
  const ce = new ComputeEngine();
  for (let k = 1; k <= depth; k++)
    ce.declare(`W_${k}`, { signature: `(unknown, ${POINT}) -> unknown` });
  ce.declare('E', { signature: `(${POINT}) -> unknown` });
  for (let k = 1; k <= depth; k++) {
    const point = ['Tuple', ['PointX', 'ceArg_1'], ['PointY', 'ceArg_1']];
    const b =
      body === 'full'
        ? [
            'b',
            'ceArg_0',
            'w',
            ['Sum', ['T', point, 'ceArg_2'], ['Limits', 'ceArg_2', -1, 2]],
          ]
        : ['b', 'ceArg_0', 'ceArg_1'];
    ce.assign(
      `W_${k}`,
      ce.box(['Function', ['Block', b], 'ceArg_0', 'ceArg_1'] as any)
    );
  }
  let inner: any = ['Multiply', 'F', 'ceArg_0'];
  for (let k = depth; k >= 1; k--) inner = [`W_${k}`, inner, 'ceArg_0'];
  const eBody = options?.eBody === 'calls' ? inner : ['Multiply', 0.9, inner];
  ce.assign(
    'E',
    ce.box([
      'Function',
      ['Block', eBody],
      [
        'Typed',
        'ceArg_0',
        `'list<tuple<number, number>> | tuple<number, number>'`,
      ],
    ] as any)
  );
  return ce;
}

describe('TYCHO ITEM 336: NESTED CALLS OF FUNCTIONS DECLARED -> unknown', () => {
  for (const body of ['full', 'minimal'] as const) {
    const counts: Record<number, number> = {};
    for (const depth of [1, 3, 6]) {
      test(`${body} body, depth ${depth}: same types, few derivations`, () => {
        const start = Date.now();
        const { result: ce, count } = withDerivationCount(() =>
          setup(depth, body)
        );
        const elapsed = Date.now() - start;
        counts[depth] = count;
        expect(ce.box('E').type.toString()).toBe(E_TYPE);
        for (let k = 1; k <= depth; k++)
          expect(ce.box(`W_${k}`).type.toString()).toBe(W_TYPE);
        // Measured 2026-09-29: about 20 ms at depth 6. Without the fix the
        // count limit above throws first.
        if (depth === 6) expect(elapsed).toBeLessThan(2000);
      });
    }
    test(`${body} body: the derivations grow linearly with the depth`, () => {
      // Each level adds the same number of derivations: from depth 1 to 3
      // (two levels) and from depth 3 to 6 (three levels).
      const perLevelLow = (counts[3] - counts[1]) / 2;
      const perLevelHigh = (counts[6] - counts[3]) / 3;
      expect(perLevelHigh).toBeLessThanOrEqual(perLevelLow * 1.5 + 1);
    });
  }

  test('a real change after the registration still changes the types', () => {
    const ce = setup(3, 'minimal', { eBody: 'calls' });
    const e = () => ce.box('E').type.toString();
    const w1 = () => ce.box('W_1').type.toString();
    expect(e()).toBe(
      '(list<tuple<number, number>> | tuple<number, number>) -> unknown'
    );
    expect(w1()).toBe(W_TYPE);

    // Declaring the undeclared head in the scope the functions were defined
    // in re-derives their bodies, and the signatures follow.
    ce.declare('b', '(unknown, unknown) -> string');
    expect(w1()).toBe(
      '(unknown, list<tuple<number, number>> | tuple<number, number>) -> list<string> | string'
    );
    expect(e()).toBe(
      '(list<tuple<number, number>> | tuple<number, number>) -> list<string> | string'
    );

    // A new body of the outermost callee.
    ce.assign(
      'W_1',
      ce.box([
        'Function',
        ['Block', ['Add', 1, ['T', 'ceArg_1']]],
        'ceArg_0',
        'ceArg_1',
      ] as any)
    );
    expect(w1()).toBe(
      '(unknown, list<tuple<number, number>> | tuple<number, number>) -> broadcastable<number>'
    );
    expect(e()).toBe(
      '(list<tuple<number, number>> | tuple<number, number>) -> broadcastable<number>'
    );

    // Declaring the undeclared `T` that the new body applies.
    ce.declare('T', '(unknown) -> integer');
    expect(w1()).toBe(
      '(unknown, list<tuple<number, number>> | tuple<number, number>) -> integer | list<integer>'
    );
    expect(e()).toBe(
      '(list<tuple<number, number>> | tuple<number, number>) -> integer | list<integer>'
    );
  });

  test('the scratch scope of a derivation is released', () => {
    const ce = setup(3, 'full');
    expect(ce.box('E').type.toString()).toBe(E_TYPE);
    expect((ce as any)._scratchDeclarationScopes.length).toBe(0);
  });

  test('a write to a scratch binding does not advance the definition version', () => {
    // The `any` axis still advances, so the computation that owns the
    // scratch scope does not keep a type it cached before the write; the
    // axes and the version that caches outliving it key on do not.
    const scratchEvents: StateEvent[] = [
      { kind: 'binding-repair', scratch: true },
      { kind: 'inference', scratch: true },
      { kind: 'inference', symbolSignature: true, scratch: true },
      { kind: 'inference', valueType: true, widening: true, scratch: true },
    ];
    for (const e of scratchEvents) {
      const lifecycle = new EngineConfigurationLifecycle();
      const before = {
        semantic: lifecycle.semanticVersion,
        world: lifecycle.worldVersion,
        definition: lifecycle.definitionVersion,
      };
      lifecycle.noteStateEvent(e);
      expect(axisMaskOf(e).semantic).toBe(false);
      expect(axisMaskOf(e).world).toBe(false);
      expect({
        semantic: lifecycle.semanticVersion,
        world: lifecycle.worldVersion,
        definition: lifecycle.definitionVersion,
      }).toEqual(before);
    }
    // The same events without `scratch` advance the definition version.
    for (const e of [
      { kind: 'binding-repair' },
      { kind: 'inference', symbolSignature: true },
      { kind: 'inference', valueType: true, widening: true },
    ] as StateEvent[]) {
      const lifecycle = new EngineConfigurationLifecycle();
      const before = lifecycle.definitionVersion;
      lifecycle.noteStateEvent(e);
      expect(lifecycle.definitionVersion).toBe(before + 1);
    }
  });
});

/** A scope created under the current lexical scope, as
 * `resultUnderDeclaredParameters` creates one. */
function newScope(ce: ComputeEngine): any {
  return { parent: ce.context.lexicalScope, bindings: new Map() };
}

/** Run `f` in `scope`, registered as a scratch scope. */
function inScratch<T>(ce: ComputeEngine, scope: any, f: () => T): T {
  return withScratchScope(ce, scope, () => ce._inScope(scope, f));
}

/** The state events `ce` emits while `f` runs. */
function eventsOf(ce: ComputeEngine, f: () => void): StateEvent[] {
  const events: StateEvent[] = [];
  const engine = ce as any;
  const original = engine._noteStateEvent;
  engine._noteStateEvent = (e: StateEvent) => {
    events.push(e);
    original.call(engine, e);
  };
  try {
    f();
  } finally {
    delete engine._noteStateEvent;
  }
  return events;
}

/** The `Function` literal the definition of `name` holds. */
function storedLiteral(ce: ComputeEngine, name: string): unknown {
  const def = ce.lookupDefinition(name) as any;
  return def?.operator?._lambdaLiteral ?? def?.value?.value;
}

describe('TYCHO ITEM 336: WRITES TO SCRATCH BINDINGS', () => {
  test('a type cached before a scratch symbol is widened is not kept', () => {
    // The typed copy of a derivation can cache a type while one of its
    // bindings has a narrow type, and a later write can widen that binding.
    // The `any` axis must then advance, as for any other binding, or the
    // derivation reads the narrow type it cached.
    const ce = new ComputeEngine();
    inScratch(ce, newScope(ce), () => {
      ce.declare('t', { type: 'unknown', inferred: true } as any);
      const t = ce.box('t') as any;
      t._infer(() => 'integer');
      const sum = ce.box(['Add', 't', 1]);
      expect(sum.type.toString()).toBe('integer');
      t._infer(() => 'real', 'widen');
      expect(t.type.toString()).toBe('real');
      expect(sum.type.toString()).toBe('real');
    });
  });

  test('a declaration re-derives only the definitions that can see it', () => {
    // `fA` is defined in a nested scope, `fB` in the enclosing one. Both
    // apply the undeclared `g`. A declaration of `g` in the nested scope is
    // visible to `fA` only: `fA` is re-derived, and `fB` keeps its literal
    // and stays registered for a later declaration of `g` that it can see.
    const ce = new ComputeEngine();
    const nested = newScope(ce);
    ce._inScope(nested, () =>
      ce.assign('fA', ce.box(['Function', ['g', 'x'], 'x'] as any))
    );
    ce.assign('fB', ce.box(['Function', ['g', 'x'], 'x'] as any));
    expect(_provisionalDependentCount(ce, 'g')).toBe(2);
    const literalA = ce._inScope(nested, () => storedLiteral(ce, 'fA'));
    const literalB = storedLiteral(ce, 'fB');

    ce._inScope(nested, () => ce.declare('g', '(real) -> string'));

    expect(ce._inScope(nested, () => storedLiteral(ce, 'fA'))).not.toBe(
      literalA
    );
    expect(ce._inScope(nested, () => ce.box('fA').type.toString())).toBe(
      '(unknown) -> string'
    );
    expect(storedLiteral(ce, 'fB')).toBe(literalB);
    expect(_provisionalDependentCount(ce, 'g')).toBe(1);

    // A declaration that `fB` can see still re-derives it.
    ce.declare('g', '(real) -> integer');
    expect(storedLiteral(ce, 'fB')).not.toBe(literalB);
    expect(ce.box('fB').type.toString()).toBe('(unknown) -> integer');
  });

  test('an update of a scratch binding by any route is a scratch repair', () => {
    // `ce.assign` updates the binding through `updateDef` without naming its
    // scope. The binding was declared in a scratch scope, so the repair
    // event is flagged `scratch` all the same.
    const ce = new ComputeEngine();
    const events = eventsOf(ce, () =>
      inScratch(ce, newScope(ce), () => {
        ce.declare('h', { signature: '(real) -> real' });
        ce.assign('h', ce.box(['Function', ['Add', 'x', 1], 'x'] as any));
      })
    );
    const repairs = events.filter((e) => e.kind === 'binding-repair');
    expect(repairs.length).toBeGreaterThan(0);
    for (const e of repairs) expect(e).toMatchObject({ scratch: true });
  });

  test('the matrix repair of scratch bindings is a scratch inference', () => {
    // `\det(P + 2Q)` retypes the fresh `P` and `Q` as matrices. In a scratch
    // scope both bindings are scratch bindings; outside one, they are not.
    const scratch = new ComputeEngine();
    const inside = eventsOf(scratch, () =>
      inScratch(scratch, newScope(scratch), () =>
        expect(scratch.parse('\\det(P+2Q)').isValid).toBe(true)
      )
    );
    const plain = new ComputeEngine();
    const outside = eventsOf(plain, () =>
      expect(plain.parse('\\det(P+2Q)').isValid).toBe(true)
    );
    const matrixInference = (events: StateEvent[]) =>
      events.filter(
        (e) =>
          e.kind === 'inference' && e.valueType !== true && !e.symbolSignature
      );
    expect(matrixInference(inside).length).toBeGreaterThan(0);
    for (const e of matrixInference(inside))
      expect(e).toMatchObject({ scratch: true });
    expect(matrixInference(outside).length).toBeGreaterThan(0);
    for (const e of matrixInference(outside))
      expect((e as { scratch?: boolean }).scratch).toBeUndefined();
  });

  test('a fresh declaration advances the definition version only through a rebuild', () => {
    const ce = new ComputeEngine();
    // Nothing waits on `h`, and no binding of `h` existed: nothing that a
    // memoized signature was derived from has changed.
    let version = ce._definitionVersion;
    ce.declare('h', '(real) -> real');
    expect(ce._definitionVersion).toBe(version);

    // A new definition of an EXISTING binding advances it.
    version = ce._definitionVersion;
    ce.assign('h', ce.box(['Function', ['Add', 'x', 1], 'x'] as any));
    expect(ce._definitionVersion).toBeGreaterThan(version);

    // A fresh declaration that re-derives a waiting definition advances it:
    // a signature derived from the old literal may be wrong.
    ce.assign('k', ce.box(['Function', ['g', 'x'], 'x'] as any));
    const literal = storedLiteral(ce, 'k');
    version = ce._definitionVersion;
    ce.declare('g', '(real) -> string');
    expect(storedLiteral(ce, 'k')).not.toBe(literal);
    expect(ce._definitionVersion).toBeGreaterThan(version);
    expect(ce.box('k').type.toString()).toBe('(unknown) -> string');
  });

  test('a free name of a derived body leaves no binding in the home scope', () => {
    const ce = new ComputeEngine();
    const home = ce.context.lexicalScope;
    const body = ['Block', ['Add', 'freeZ', ['PointX', 'ceArg_1']]];
    ce.declare('W', { signature: `(unknown, ${POINT}) -> unknown` });
    const before = new Set(home.bindings.keys());
    ce.assign('W', ce.box(['Function', body, 'ceArg_0', 'ceArg_1'] as any));
    const derived = ce.box('W').type.toString();
    expect([...home.bindings.keys()].filter((k) => !before.has(k))).toEqual([]);
    // The same result as the boxing of the body directly under the home
    // scope, which is what the derivation did before it used a scratch
    // scope.
    const direct = ce._inScope(home, () =>
      ce.box([
        'Function',
        body,
        ['Typed', 'ceArg_0', "'unknown'"],
        ['Typed', 'ceArg_1', `'${POINT}'`],
      ] as any)
    );
    const result = (t: string) => t.slice(t.lastIndexOf('->') + 3);
    expect(result(derived)).toBe(result(direct.type.toString()));
    expect(result(derived)).toBe('list<number> | missing | number');
  });
});

// A chain of functions declared `-> unknown` whose bodies each call the next
// one TWICE. The effects inference walked a stored callee literal once per
// call, so the last function was walked 2^depth times: 89 794 reads of the
// declared signatures at depth 12 (measured 2026-10-01). A stored literal
// already walked into the same accumulator at the same depth or a smaller one
// is now skipped (`expandedLiterals`, `effects-inference.ts`), and the reads
// grow polynomially.
describe('A CHAIN OF FUNCTIONS THAT EACH CALL THE NEXT TWICE', () => {
  function chain(depth: number, last: unknown[]): ComputeEngine {
    const ce = new ComputeEngine();
    for (let k = 1; k <= depth; k++)
      ce.declare(`W_${k}`, { signature: '(unknown) -> unknown' });
    for (let k = depth; k >= 1; k--) {
      const body =
        k === depth
          ? last
          : ['Add', [`W_${k + 1}`, 'x'], [`W_${k + 1}`, ['Add', 'x', 1]]];
      ce.assign(`W_${k}`, ce.box(['Function', ['Block', body], 'x'] as any));
    }
    return ce;
  }

  test('the reads do not double with each level', () => {
    // The limit stops a regression at once instead of running for seconds.
    const counts = [6, 12].map(
      (depth) =>
        withDerivationCount(() => chain(depth, ['b', 'x']), 20_000).count
    );
    // Measured 2026-10-01: 850 at depth 6 and 5 666 at depth 12 (89 794 at
    // depth 12 before). A doubling per level would multiply by 64.
    expect(counts[1]).toBeLessThan(counts[0] * 16);
  });

  test.each([
    [['Add', ['Random'], 'x'], '(unknown) random -> number', false],
    [['b', 'x'], '(unknown) any -> broadcastable<number>', false],
    [['Add', 'x', 1], '(unknown) -> number', true],
  ])('the effects of %j still reach the first function', (last, type, pure) => {
    const ce = chain(5, last);
    const f = ce.box(['Function', ['Add', ['W_1', 'y'], ['W_2', 'y']], 'y']);
    expect(f.type.toString()).toBe(type);
    expect(ce.box(['W_1', 2]).isPure).toBe(pure);
  });

  test('a callee first reached past the depth guard still contributes', () => {
    // `H_1` … `H_8` each call the next, and `H_8` calls `G`: through the
    // chain, `G` is reached past the depth guard, which records `any` and
    // stops. The direct call `G(y)` that follows must still walk `G` and
    // record that it draws.
    const ce = new ComputeEngine();
    const names = ['H_1', 'H_2', 'H_3', 'H_4', 'H_5', 'H_6', 'H_7', 'H_8', 'G'];
    for (const n of names) ce.declare(n, { signature: '(unknown) -> unknown' });
    ce.assign('G', ce.box(['Function', ['Add', ['Random'], 'x'], 'x'] as any));
    for (let k = 8; k >= 1; k--)
      ce.assign(
        `H_${k}`,
        ce.box(['Function', [k === 8 ? 'G' : `H_${k + 1}`, 'x'], 'x'] as any)
      );
    for (const body of [
      ['Block', ['H_1', 'y'], ['G', 'y']],
      ['Block', ['G', 'y'], ['H_1', 'y']],
    ]) {
      const f = ce.box(['Function', body, 'y'] as any);
      const inferred = inferFunctionLiteralEffects(ce as any, f);
      expect(inferred.draws).toBe(true);
    }
  });
});

