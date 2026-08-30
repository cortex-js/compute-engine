/**
 * Every write routine, against every kind of fact.
 *
 * The write half of the fact-store design rests on one claim: a routine that
 * stores a type or a signature derives it with the assumption store hidden, so
 * what it stores is a function of the declarations and the stored values
 * alone. `fact-store-phase3-writes.test.ts` argues that claim case by case.
 * This file argues it SYSTEMATICALLY, as a matrix: every routine in the write
 * audit (`docs/plans/2026-08-30-assumptions-write-audit.md` §1 and §2) is
 * driven twice — once on an engine with a fact in force, once on a twin engine
 * that only declared the subject — and the two stored types must agree. Then
 * the fact is retracted and the first engine must still agree with the twin,
 * which is the property the whole design exists to buy: nothing that a
 * `forget()` can invalidate ever entered a contract.
 *
 * The matrix runs three times, once per CHANNEL a fact can reach a write
 * through: a RANGE fact (`p > 3` on a `real`), a SIGN fact (`p > 0` on a
 * `number`, which decides whether `√p` is real), and an EQUALITY fact
 * (`p = 5`, whose value lives in the assumed-value overlay and whose tier
 * would otherwise narrow the subject to `integer`).
 *
 * A new write routine is one row of `ROUTINES`.
 *
 * This file also holds two things the other fact-store suites leave out: the
 * invariant that no fact-store or overlay mutation happens without a state
 * event (an `_anyVersion` advance, which is what every generation-keyed memo
 * heals on), and the behavior rows of the design's own before/after table
 * (`docs/plans/2026-08-29-assumptions-as-facts-type.md` §4) that
 * `fact-store-phase1`, `-phase2`, `-phase3` and `-phase3-writes` do not
 * already pin.
 */

import { ComputeEngine } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

/** The definition's stored type — its signature when it is callable. */
function storedType(ce: ComputeEngine, name: string): string {
  const def = ce.lookupDefinition(name);
  if (def === undefined) return '<undeclared>';
  const operator = (def as { operator?: { signature: { toString(): string } } })
    .operator;
  if (operator !== undefined) return operator.signature.toString();
  return (
    def as { value: { type: { toString(): string } } }
  ).value.type.toString();
}

/** The type a function literal's body inference left on one parameter. A
 * parameter binding lives in the literal's own Block scope, which is the only
 * place the narrowing an operator's canonical handler performs is visible. */
function parameterType(literal: unknown, name: string): string {
  const scope = (
    literal as { ops?: { localScope?: { bindings?: Map<string, unknown> } }[] }
  ).ops?.[0]?.localScope;
  const def = scope?.bindings?.get(name) as
    | { value?: { declaredType?: { toString(): string } } }
    | undefined;
  return def?.value?.declaredType?.toString() ?? '<none>';
}

/** One write routine: how to drive it, and what stored type to read back. */
type Routine = {
  /** Names the write surface, as the audit artifact names it. */
  name: string;
  /** Performs the write. `p` is declared, and possibly assumed about. */
  store: (ce: ComputeEngine) => void;
  /** Reads back what was stored. */
  read: (ce: ComputeEngine) => string;
};

const ROUTINES: Routine[] = [
  {
    name: 'the value-definition constructor: declare(name, {type, value})',
    store: (ce) =>
      ce.declare('M', { type: 'list', value: ce.box(['List', 'p']) }),
    read: (ce) => storedType(ce, 'M'),
  },
  {
    name: 'the value-definition constructor: declare(name, {value, isConstant})',
    store: (ce) => ce.declare('K', { value: ce.box('p'), isConstant: true }),
    read: (ce) => storedType(ce, 'K'),
  },
  {
    name: "assign's derive-and-write phase",
    store: (ce) => ce.assign('a', ce.box(['Add', 'p', 1])),
    read: (ce) => storedType(ce, 'a'),
  },
  {
    name: '_setElementRefinement, through a bare-constructor declaration',
    store: (ce) => {
      ce.declare('L', 'list');
      ce.assign('L', ce.box(['List', 'p']));
    },
    read: (ce) => storedType(ce, 'L'),
  },
  {
    name: 'BoxedSymbol.set value',
    store: (ce) => {
      ce.declare('b', 'list');
      ce.symbol('b').value = ce.box(['List', 'p']);
    },
    read: (ce) => storedType(ce, 'b'),
  },
  {
    name: 'BoxedSymbol.set type',
    store: (ce) => {
      ce.declare('c', 'unknown');
      ce.symbol('c').type = 'real';
    },
    read: (ce) => storedType(ce, 'c'),
  },
  {
    name: 'BoxedSymbol.set type, replacing a signature',
    store: (ce) => {
      ce.assign('sfn', ce.box(['Function', ['Add', 'p', 't'], 't']));
      ce.symbol('sfn').type = '(integer) -> integer';
    },
    read: (ce) => storedType(ce, 'sfn'),
  },
  {
    name: "_update's lambda-signature derivation, over the type channel",
    store: (ce) =>
      ce.assign('f', ce.box(['Function', ['Greater', 'p', 2], 't'])),
    read: (ce) => storedType(ce, 'f'),
  },
  {
    name: "_update's lambda-signature derivation, over the sign channel",
    store: (ce) => ce.assign('r', ce.box(['Function', ['Sqrt', 'p'], 't'])),
    read: (ce) => storedType(ce, 'r'),
  },
  {
    name: '_infer: the scalar numeric context of a validated argument list',
    store: (ce) => {
      ce.box(['Multiply', 'p', ['List', 'g1', 'g2']]);
    },
    read: (ce) => `${storedType(ce, 'g1')}/${storedType(ce, 'g2')}`,
  },
  {
    name: "_infer: the Element canonical handler's parameter narrowing",
    store: (ce) => {
      (ce as unknown as { _probe: unknown })._probe = ce.box(
        ['Function', ['Element', 'u', ['List', 'p', 'p']], 'u'],
        { canonical: false }
      ).canonical;
    },
    read: (ce) =>
      parameterType((ce as unknown as { _probe: unknown })._probe, 'u'),
  },
  {
    name: "_infer: Length's operand",
    store: (ce) => {
      ce.box(['Length', 'lenArg']);
    },
    read: (ce) => storedType(ce, 'lenArg'),
  },
  {
    name: '_infer: the collection-parameter narrow against a declared signature',
    store: (ce) => {
      ce.declare('hh', '(list<integer>) -> integer');
      ce.box(['hh', 'zz']);
    },
    read: (ce) => storedType(ce, 'zz'),
  },
  {
    name: 'the dictionary-literal type synthesized at an assignment',
    store: (ce) =>
      ce.assign(
        'd',
        ce.box(['Dictionary', ['KeyValuePair', { str: 'a' }, 'p']])
      ),
    read: (ce) => storedType(ce, 'd'),
  },
];

// The Epsil static pre-pass is the one routine of the audit inventory with no
// row here. It runs in a scratch scope and writes only onto definitions that
// are already inferred, so nothing it stores survives the pass into a scope a
// test can read; a diagnostic is not a stored type either. It brackets itself
// as a whole (`ce._factSuppressionDepth` is raised next to
// `ce._staticTypeCheckDepth`), so every sink it uses inherits the hiding — an
// argument from the code, not a pin.

/** One kind of fact, with the declaration it is asserted against. */
type Channel = {
  name: string;
  declare: (ce: ComputeEngine) => void;
  assume: (ce: ComputeEngine) => unknown;
};

const CHANNELS: Channel[] = [
  {
    name: 'a RANGE fact',
    declare: (ce) => ce.declare('p', 'real'),
    assume: (ce) => ce.assume(ce.box(['Greater', 'p', 3])),
  },
  {
    name: 'a SIGN fact',
    declare: (ce) => ce.declare('p', 'number'),
    assume: (ce) => ce.assume(ce.box(['Greater', 'p', 0])),
  },
  {
    name: 'an EQUALITY fact',
    declare: (ce) => ce.declare('p', 'real'),
    assume: (ce) => ce.assume(ce.box(['Equal', 'p', 5])),
  },
];

describe.each(CHANNELS)('every write routine is blind to $name', (channel) => {
  test.each(ROUTINES)('$name', (routine) => {
    // The engine that assumes, and the twin that only declares.
    const assumed = new ComputeEngine();
    channel.declare(assumed);
    expect(channel.assume(assumed)).toBe('ok');

    const twin = new ComputeEngine();
    channel.declare(twin);

    routine.store(assumed);
    routine.store(twin);

    const expected = routine.read(twin);
    // A row that stores nothing would agree vacuously.
    expect(expected).not.toBe('<undeclared>');
    expect(expected).not.toBe('<none>');

    // The fact was in force for the whole derive-and-write phase and did not
    // reach the stored type.
    expect(routine.read(assumed)).toBe(expected);

    // Retracting it changes nothing, because nothing depended on it.
    assumed.forget('p');
    expect(routine.read(assumed)).toBe(expected);
  });
});

describe('the fact store mutates only through a state event', () => {
  // Every fact or overlay mutation must advance `_anyVersion`. A memo keyed on
  // that axis would otherwise keep serving an answer computed against a store
  // that has since changed. The check is one-directional on purpose — an event
  // without a mutation is allowed (a conservative bump); a mutation without an
  // event is the bug.
  function mutatingStep(
    ce: ComputeEngine,
    act: () => void
  ): { mutated: boolean; eventful: boolean } {
    const before = {
      any: ce._anyVersion,
      version: ce.context.assumptions.version,
      size: ce.context.assumptions.size,
      overlay: ce.context.assumedValues.size,
    };
    act();
    return {
      mutated:
        ce.context.assumptions.version !== before.version ||
        ce.context.assumptions.size !== before.size ||
        ce.context.assumedValues.size !== before.overlay,
      eventful: ce._anyVersion !== before.any,
    };
  }

  test('every assume outcome, forget, and a checkpoint restore', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');

    const steps: [string, () => void][] = [
      [
        'assume ok',
        () => expect(ce.assume(ce.box(['Greater', 'x', 3]))).toBe('ok'),
      ],
      [
        'assume tautology',
        () => expect(ce.assume(ce.box(['Greater', 'x', 1]))).toBe('tautology'),
      ],
      [
        'assume contradiction',
        () => expect(ce.assume(ce.box(['Less', 'x', 0]))).toBe('contradiction'),
      ],
      [
        'assume not-a-predicate',
        () => expect(ce.assume(ce.box(['Foo', 'x']))).toBe('not-a-predicate'),
      ],
      [
        'assume an equality (the overlay)',
        () => expect(ce.assume(ce.box(['Equal', 'y', 5]))).toBe('ok'),
      ],
      ['forget one name', () => ce.forget('x')],
      ['forget everything', () => ce.forget()],
    ];

    // Collected rather than asserted inline, so a failure names the step.
    const silent: string[] = [];
    let mutations = 0;
    for (const [label, act] of steps) {
      const { mutated, eventful } = mutatingStep(ce, act);
      if (!mutated) continue;
      mutations += 1;
      if (!eventful) silent.push(label);
    }
    expect(silent).toEqual([]);
    // A run where nothing mutated would satisfy the check vacuously.
    expect(mutations).toBeGreaterThan(0);

    // A checkpoint restore refills the maps in place, which the map `version`
    // sees and the axis would not — so it emits an event of its own.
    ce.assume(ce.box(['Greater', 'x', 3]));
    const cp = ce.checkpoint();
    ce.forget();
    const restore = mutatingStep(ce, () => ce.restore(cp));
    expect(restore.mutated).toBe(true);
    expect(restore.eventful).toBe(true);
  });
});

describe('behavior rows the other fact-store suites leave unpinned', () => {
  test('a part-subject fact excludes zero from the whole value', () => {
    // A positive imaginary part proves the number is not zero, so the derived
    // `τ ≠ 0` fact contributes an exclusion the type channel can carry.
    const ce = new ComputeEngine();
    ce.declare('tau', 'number');
    expect(ce.assume(ce.box(['Greater', ['Im', 'tau'], 0]))).toBe('ok');
    expect(ce.box('tau').type.toString()).toBe('number & !0');
  });

  test('a stored value wins over a widening membership fact', () => {
    // Both routes now agree: a definition holding a value takes its type from
    // the value, so `v ∈ ℝ` does not widen `integer` back to `real`.
    const ce = new ComputeEngine();
    ce.assign('v', 5);
    expect(ce.assume(ce.box(['Element', 'v', 'RealNumbers']))).toBe('ok');
    expect(ce.box('v').type.toString()).toBe('integer');
  });

  test('a definition written inside a scope dies with the scope', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.pushScope();
    expect(ce.assume(ce.box(['Greater', 'u', 3]))).toBe('ok');
    ce.assign('w', ce.box(['Function', ['Greater', 'u', 1], 't']));
    ce.popScope();
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });

  test('an equation with more than one root installs no value', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.box(['Equal', ['Power', 'x', 2], 4]))).toBe('ok');
    expect(ce.box('x').type.toString()).toBe('real');
    expect(ce.box('x').value).toBeUndefined();
    expect(ce.context.assumedValues.size).toBe(0);
  });

  test('a public type write retracts what was assumed about the symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.box(['Greater', 'x', 3]))).toBe('ok');
    ce.symbol('x').type = 'real';
    expect(ce.ask(ce.box(['Greater', 'x', 3]))).toEqual([]);
    expect(ce.box('x').type.toString()).toBe('real');
  });

  test('a declaration UPGRADES an auto-declaration made by assume', () => {
    // The binding `assume()` creates is inferred, not a contract, so a later
    // `declare` of the same name states the contract rather than colliding
    // with it.
    const ce = new ComputeEngine();
    expect(ce.assume(ce.box(['Greater', 'w', 3]))).toBe('ok');
    expect(ce.box('w').type.toString()).toBe('real<3<..>');
    expect(() => ce.declare('w', 'integer')).not.toThrow();
    expect(ce.box('w').type.toString()).toBe('integer');
  });

  test('an exclusion and the equality it excludes are a contradiction', () => {
    // The exclusion contributes nothing to the TYPE (`√2` is not a machine
    // number), but the transaction's value-versus-fact check still catches
    // the equality that names the excluded value.
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    expect(ce.assume(ce.box(['NotEqual', 's', ['Sqrt', 2]]))).toBe('ok');
    expect(ce.box('s').type.toString()).toBe('real');
    expect(ce.assume(ce.box(['Equal', 's', ['Sqrt', 2]]))).toBe(
      'contradiction'
    );
  });

  test('the two channels of a definition read differently', () => {
    // `type` is the effective read — the declaration merged with the facts.
    // `declaredType` is the contract, and is what a write path reads.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.box(['Greater', 'x', 4]))).toBe('ok');
    const def = ce.lookupDefinition('x') as {
      value: {
        type: { toString(): string };
        declaredType: { toString(): string };
      };
    };
    expect(def.value.type.toString()).toBe('real<4<..>');
    expect(def.value.declaredType.toString()).toBe('real');
  });

  test('an exclusion needs a tier to attach to', () => {
    // `assume(y ≠ 2)` on a `real` gives `real & !2`, but on a subject with no
    // declaration there is no tier for the exclusion to narrow, and a bare
    // `!2` broke the solver's root filter. The fact still serves queries.
    const ce = new ComputeEngine();
    expect(ce.assume(ce.box(['NotEqual', 'yy', 2]))).toBe('ok');
    expect(ce.box('yy').type.toString()).toBe('unknown');
  });
});
