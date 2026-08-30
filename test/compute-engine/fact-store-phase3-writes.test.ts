/**
 * A WRITE never sees the assumptions.
 *
 * An assumption is a fact about the current state; a definition's type, its
 * signature and its stored value are contracts. So every routine that writes
 * one runs its whole derive-and-write phase inside a fact-blind bracket
 * (`ce._withoutFacts`): the type it stores, and the decisions that chose it,
 * are a function of the declarations and the stored values alone, and they
 * stay true when the next statement retracts the fact.
 *
 * A READ is the opposite: a fact in force is merged in at the moment of the
 * read and disappears again when it is forgotten. So `(p > 2).type` still
 * answers `true` under `assume(p > 3)` while `f := x ↦ (p > 2)` stores
 * `(unknown) -> boolean`.
 *
 * These tests pin the write half. The memo half is
 * `fact-store-phase3.test.ts`, the store's mechanics `fact-store-phase1`, and
 * what a fact contributes to a type `fact-store-phase2`.
 */

import { ComputeEngine } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

/** The signature (or type) stored on `name`'s definition, as text. */
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

/** `x ↦ body`, as an unparsed MathJSON function literal — LaTeX would read a
 * two-character name such as `p2` as a juxtaposition. */
function lambda(body: unknown, param = 't'): unknown {
  return ['Function', body, param];
}

describe('a stored signature never carries a proof over an assumption', () => {
  test('Ruling A: an assumed bound is invisible through an assigned function', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    expect(ce.assume(ce.parse('p > 3'))).toBe('ok');

    // The DIRECT read still sees the proof: that is what an assumption is for.
    expect(ce.box(['Greater', 'p', 2]).type.toString()).toBe('true');
    // The STORED signature does not.
    ce.assign('f', ce.box(lambda(['Greater', 'p', 2])));
    expect(storedType(ce, 'f')).toBe('(unknown) -> boolean');

    // ... and it is unchanged by the retraction, because it never depended on
    // the fact.
    ce.forget('p');
    expect(storedType(ce, 'f')).toBe('(unknown) -> boolean');
    expect(ce.box('p').type.toString()).toBe('real');
  });

  test('Ruling B: a DECLARED range still bakes', () => {
    const ce = new ComputeEngine();
    ce.declare('p2', 'real<3<..>');
    ce.assign('g', ce.box(lambda(['Greater', 'p2', 2])));
    // A declaration is a contract, so a proof taken over it is one too.
    expect(storedType(ce, 'g')).toBe('(unknown) -> true');
  });

  test('the SIGN channel is hidden at a write too', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'number');
    expect(ce.assume(ce.parse('q > 0'))).toBe('ok');
    // `√q` of a positive `q` is real; of a `number` it is not.
    ce.assign('r', ce.box(lambda(['Sqrt', 'q'])));
    expect(storedType(ce, 'r')).toBe('(unknown) -> number');
    ce.forget('q');
    expect(storedType(ce, 'r')).toBe('(unknown) -> number');
  });

  test('a generic instantiation reached from a write inherits the hiding', () => {
    // `First` is generic: instantiating it reads the source's ELEMENT type,
    // which is the assumed symbol's effective type. The dispatch read carries
    // no bracket of its own — it inherits the one the write opened — so the
    // signature derived under the fact is the one derived without it.
    const derive = (assumed: boolean): string => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      if (assumed) ce.assume(ce.parse('x > 3'));
      ce.assign('gen', ce.box(lambda(['First', ['List', 'x', 'x']])));
      const under = storedType(ce, 'gen');
      if (assumed) ce.forget('x');
      expect(storedType(ce, 'gen')).toBe(under);
      return under;
    };
    expect(derive(true)).toBe(derive(false));
  });
});

describe('a stored TYPE never carries a proof over an assumption', () => {
  test('an assigned dictionary literal', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    expect(ce.assume(ce.parse('q > 3'))).toBe('ok');
    ce.assign('d', ce.box(['Dictionary', ['KeyValuePair', { str: 'a' }, 'q']]));
    expect(storedType(ce, 'd')).toBe('record{a: real}');
    ce.forget('q');
    expect(storedType(ce, 'd')).toBe('record{a: real}');
  });

  test('a placeholder skeleton refined by an assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list');
    ce.declare('r0', 'real');
    // MathJSON, not LaTeX: `r0` in LaTeX is the juxtaposition `r·0`.
    expect(ce.assume(ce.box(['Greater', 'r0', 3]))).toBe('ok');
    ce.assign('L', ce.box(['List', 'r0']));
    expect(storedType(ce, 'L')).toBe('list<real>');
    ce.forget('r0');
    expect(storedType(ce, 'L')).toBe('list<real>');
  });

  test('the value-definition CONSTRUCTOR: declare(name, {type, value})', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    expect(ce.assume(ce.parse('q > 3'))).toBe('ok');
    ce.declare('M', { type: 'list', value: ce.box(['List', 'q']) });
    expect(storedType(ce, 'M')).toBe('list<real>');
    // Healing on `forget` is trivial here precisely because nothing was baked.
    ce.forget('q');
    expect(storedType(ce, 'M')).toBe('list<real>');
  });

  test('the value-definition CONSTRUCTOR: declare(name, {value, isConstant})', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    expect(ce.assume(ce.parse('q > 3'))).toBe('ok');
    ce.declare('c', { value: ce.box('q'), isConstant: true });
    expect(storedType(ce, 'c')).toBe('real');
    ce.forget('q');
    expect(storedType(ce, 'c')).toBe('real');
  });
});

describe('a guard that CHOOSES a type is bracketed with the write', () => {
  /** The type a function literal's body inference left on one parameter. The
   * parameter's binding lives in the literal's own Block scope. */
  function parameterType(literal: unknown, name: string): string {
    const scope = (
      literal as {
        ops?: { localScope?: { bindings?: Map<string, unknown> } }[];
      }
    ).ops?.[0]?.localScope;
    const def = scope?.bindings?.get(name) as
      | { value?: { declaredType?: { toString(): string } } }
      | undefined;
    return def?.value?.declaredType?.toString() ?? '<none>';
  }

  test("the Element handler reads the collection's element type fact-blind", () => {
    // `u ∈ [q, q]` narrows the parameter `u` to the list's ELEMENT type. That
    // element type is read off the collection's EFFECTIVE type, so with the
    // guard outside the bracket the parameter's stored type was `real<3<..>`
    // — a contract built on a fact the next statement can retract.
    const narrowedTo = (assumed: boolean): string => {
      const ce = new ComputeEngine();
      ce.declare('q', 'real');
      if (assumed) expect(ce.assume(ce.box(['Greater', 'q', 3]))).toBe('ok');
      const f = ce.box(
        ['Function', ['Element', 'u', ['List', 'q', 'q']], 'u'],
        { canonical: false }
      ).canonical;
      return parameterType(f, 'u');
    };
    expect(narrowedTo(false)).toBe('real');
    expect(narrowedTo(true)).toBe('real');
  });

  test('the scalar numeric context is chosen fact-blind', () => {
    // The scan that picks `real` or `number` reads every operand's EFFECTIVE
    // type. With `c: number` the answer is `number`; an assumption that
    // narrows `c` out of the complex tier made it `real`, and that constant
    // was then stored on the OTHER operands — which is the leak, since those
    // operands never mentioned `c`.
    const inferredOnto = (assumed: boolean): string => {
      const ce = new ComputeEngine();
      ce.declare('c', 'number');
      if (assumed) expect(ce.assume(ce.box(['Greater', 'c', 0]))).toBe('ok');
      ce.box(['Multiply', 'c', ['List', 'g1', 'g2']]);
      return storedType(ce, 'g1');
    };
    expect(inferredOnto(false)).toBe('number');
    expect(inferredOnto(true)).toBe('number');
  });
});

describe('scopes', () => {
  test('a definition written in the scope that assumed stores no proof', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.pushScope();
    expect(ce.assume(ce.parse('u > 3'))).toBe('ok');
    // The READ inside the scope still proves the bound...
    expect(ce.box('u').type.toString()).toBe('real<3<..>');
    // ... and the write inside the scope still does not.
    ce.assign('w', ce.box(lambda(['Greater', 'u', 1])));
    expect(storedType(ce, 'w')).toBe('(unknown) -> boolean');
    ce.popScope();
  });

  test('an OUTER definition written from an inner scope stores no proof', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('h', 'unknown');
    ce.pushScope();
    expect(ce.assume(ce.parse('x > 4'))).toBe('ok');
    ce.assign('h', ce.box(lambda(['Greater', 'x', 2])));
    ce.popScope();
    // `h` outlives the scope that assumed; its signature must outlive it too.
    expect(storedType(ce, 'h')).toBe('(unknown) -> boolean');
  });
});

describe('the fact-blind bracket itself', () => {
  test('is re-entrant and restores the depth, an exception included', () => {
    const ce = new ComputeEngine();
    expect(ce._factSuppressionDepth).toBe(0);
    ce._withoutFacts(() => {
      expect(ce._factSuppressionDepth).toBe(1);
      ce._withoutFacts(() => expect(ce._factSuppressionDepth).toBe(2));
      expect(ce._factSuppressionDepth).toBe(1);
    });
    expect(ce._factSuppressionDepth).toBe(0);

    expect(() =>
      ce._withoutFacts(() => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(ce._factSuppressionDepth).toBe(0);
  });

  test('hides the store from every query reader', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 3'));
    expect(ce.box('x').type.toString()).toBe('real<3<..>');
    ce._withoutFacts(() => {
      expect(ce.box('x').type.toString()).toBe('real');
    });
    expect(ce.box('x').type.toString()).toBe('real<3<..>');
  });

  test('refuses a thunk that returns a promise', () => {
    const ce = new ComputeEngine();
    expect(() => ce._withoutFacts(() => Promise.resolve(1))).toThrow(
      /synchronous/
    );
    // The depth is restored before the refusal, so the engine is usable.
    expect(ce._factSuppressionDepth).toBe(0);
  });

  test('refuses a fact mutation made from inside it', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(() =>
      ce._withoutFacts(() => ce.assume(ce.parse('x > 3')))
    ).toThrow();
    expect(() => ce._withoutFacts(() => ce.forget('x'))).toThrow();
    expect(() => ce._withoutFacts(() => ce.forget())).toThrow();
    expect(ce._factSuppressionDepth).toBe(0);
  });
});

describe('the public accessors keep their type-valued shape', () => {
  test('a function handed to the type setter is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'real');
    const def = ce.lookupDefinition('v')!;
    expect(() => {
      // A thunk handed to the public accessor instead of to `_setType`.
      (def as unknown as { value: { type: unknown } }).value.type = () =>
        'integer';
    }).toThrow(/_setType/);
    expect(storedType(ce, 'v')).toBe('real');
  });

  test('a signature written through the symbol type setter is a BoxedType', () => {
    // The signature accessor stores what it is handed, so a caller passing a
    // raw type node leaves the slot holding an object with no `matches`,
    // `toString` or `type` member, and every later read of the symbol's type
    // fails on it.
    const ce = new ComputeEngine();
    ce.assign('fn2', ce.box(lambda(['Add', 't', 1])));
    ce.symbol('fn2').type = '(integer) -> integer';
    expect(storedType(ce, 'fn2')).toBe('(integer) -> integer');
    expect(ce.symbol('fn2').type.toString()).toBe('(integer) -> integer');
    expect(ce.symbol('fn2').type.matches('function')).toBe(true);
  });

  test('a function handed to the signature setter is refused', () => {
    const ce = new ComputeEngine();
    ce.assign('fn', ce.box(lambda(['Add', 't', 1])));
    const def = ce.lookupDefinition('fn')!;
    expect(() => {
      (
        def as unknown as { operator: { signature: unknown } }
      ).operator.signature = () => 'integer';
    }).toThrow(/_setSignature/);
  });
});
