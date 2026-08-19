import { parseType } from '../../../src/common/type/parse';
import {
  callbackIncompatibility,
  CallbackIncompatibility,
} from '../../../src/common/type/compatibility';
import type { FunctionSignature, Type } from '../../../src/common/type/types';

/**
 * Phase E0 of Design E
 * (`docs/plans/2026-08-18-compatibility-admission-callbacks.md` §12):
 * direct unit tests for the disjointness half of the compatibility relation
 * (§3 rules 1, 3, 4), as a pure type-algebra function. Rule 2 (arity) and
 * rule 5 (effects) are exercised at the engine layer, not here.
 */

const sig = (s: string): FunctionSignature =>
  parseType(s) as FunctionSignature;

const check = (
  supply: string,
  operand: string
): CallbackIncompatibility | undefined =>
  callbackIncompatibility(sig(supply), parseType(operand) as Type);

describe('rule 1 — not callable', () => {
  it('rejects a non-callable operand type', () => {
    expect(check('(integer) -> boolean', 'string')).toEqual({
      rule: 'not-callable',
      actual: 'string',
    });
  });

  it('rejects a union with no possibly-callable arm', () => {
    expect(check('(integer) -> boolean', 'integer | string')?.rule).toBe(
      'not-callable'
    );
  });

  it('admits a union with a callable arm past rule 1', () => {
    expect(
      check('(integer) -> boolean', 'integer | ((integer) -> boolean)')
    ).toBeUndefined();
  });
});

describe('overlap admits — the messy-data idiom', () => {
  it('admits a callback narrower than the supply (partial overlap)', () => {
    // The `Map(sqrt, mixed-list)` shape: number vs integer|string overlap.
    expect(
      check('(integer | string) -> unknown', '(number) -> number')
    ).toBeUndefined();
  });

  it('admits a callback broader than the supply', () => {
    expect(check('(integer) -> boolean', '(unknown) -> boolean')).toBeUndefined();
  });
});

describe('wildcard and open-slot exemptions', () => {
  it('admits a bare-`function` operand', () => {
    expect(check('(integer) -> boolean', 'function')).toBeUndefined();
  });

  it('admits `unknown`- and `any`-typed operands', () => {
    expect(check('(integer) -> boolean', 'unknown')).toBeUndefined();
    expect(check('(integer) -> boolean', 'any')).toBeUndefined();
  });

  it('admits everything at an `any` (open-slot sentinel) supply position', () => {
    expect(check('(any) -> boolean', '(string) -> boolean')).toBeUndefined();
  });

  it('admits a polymorphic operand at its skeleton', () => {
    expect(check('(integer) -> boolean', '(T) -> T where T')).toBeUndefined();
  });
});

describe('rule 3 — provably disjoint parameter', () => {
  it('rejects a fully disjoint parameter', () => {
    expect(check('(string) -> boolean', '(number) -> boolean')).toEqual({
      rule: 'disjoint-parameter',
      position: 0,
      expected: 'string',
      actual: 'number',
    });
  });

  it('reports the position of the disjoint parameter', () => {
    expect(
      check('(integer, string) -> boolean', '(integer, integer) -> boolean')
    ).toMatchObject({ rule: 'disjoint-parameter', position: 1 });
  });

  it('rejects the callable arm of a mixed union when it is disjoint', () => {
    expect(
      check('(number) -> boolean', 'integer | ((string) -> boolean)')?.rule
    ).toBe('disjoint-parameter');
  });

  it('positions beyond the arm parameters are arity business — admitted here', () => {
    expect(
      check('(integer, string) -> boolean', '(integer) -> boolean')
    ).toBeUndefined();
  });

  it('a variadic operand tail is checked positionally', () => {
    expect(
      check('(integer, integer) -> boolean', '(integer+) -> boolean')
    ).toBeUndefined();
    expect(
      check('(integer, integer) -> boolean', '(string+) -> boolean')
    ).toMatchObject({ rule: 'disjoint-parameter', position: 0 });
  });
});

describe('rule 4 — provably disjoint result', () => {
  it('rejects a provably non-boolean predicate result', () => {
    expect(check('(integer) -> boolean', '(integer) -> integer')).toEqual({
      rule: 'disjoint-result',
      expected: 'boolean',
      actual: 'integer',
    });
  });

  it('admits an `unknown` operand result', () => {
    expect(check('(integer) -> boolean', '(integer) -> unknown')).toBeUndefined();
  });
});

describe('bottom types are vacuously compatible (variance-aware)', () => {
  it('a `never` supply position admits every callback (empty collection)', () => {
    // `ce.box(['List'])` types as `list<never>`: `Filter([], IsPrime)` must
    // stay admitted (Design E §3 notes, probed 2026-08-18).
    expect(check('(never) -> boolean', '(number) -> boolean')).toBeUndefined();
  });

  it('a `nothing` supply position admits too (ruled alongside `never`)', () => {
    expect(check('(nothing) -> boolean', '(number) -> boolean')).toBeUndefined();
  });

  it('a `never` OPERAND result is admissible (non-returning callback)', () => {
    expect(check('(integer) -> boolean', '(integer) -> never')).toBeUndefined();
  });

  it('a `never` OPERAND parameter still rejects — the callback is uninvokable', () => {
    expect(check('(integer) -> boolean', '(never) -> boolean')).toMatchObject({
      rule: 'disjoint-parameter',
      position: 0,
    });
  });
});

describe('mixed unions with COMPOSITE non-callable members', () => {
  it('a composite member does not read as a wildcard — the callable arm decides', () => {
    // `list<number>` is provably not callable; the union's fate rests on its
    // one callable arm, which is parameter-disjoint here. Before the fix the
    // composite member fell to the conservative default and admitted the
    // whole operand.
    expect(
      check('(number) -> boolean', 'list<number> | ((string) -> boolean)')
        ?.rule
    ).toBe('disjoint-parameter');
    // …and with a COMPATIBLE callable arm, the union is admitted.
    expect(
      check('(number) -> boolean', 'list<number> | ((integer) -> boolean)')
    ).toBeUndefined();
  });
});

describe('bottom SUPPLY results are a real contract (review fix)', () => {
  it('a slot requiring `-> never` rejects a callback that returns normally', () => {
    expect(check('(integer) -> never', '(integer) -> integer')).toMatchObject({
      rule: 'disjoint-result',
    });
    // A non-returning operand still satisfies it (operand-side carve-out).
    expect(check('(integer) -> never', '(integer) -> never')).toBeUndefined();
  });
});

describe('operand shapes — overload sets', () => {
  it('admits an overload set with one compatible arm', () => {
    expect(
      check(
        '(integer) -> unknown',
        '((integer) -> integer) & ((string) -> string)'
      )
    ).toBeUndefined();
  });

  it('rejects an overload set with no compatible arm', () => {
    expect(
      check(
        '(boolean) -> unknown',
        '((integer) -> integer) & ((string) -> string)'
      )?.rule
    ).toBe('disjoint-parameter');
  });
});

describe('supply-side effects are irrelevant to the type rules', () => {
  it('an effect-top supply arrow checks types identically', () => {
    expect(
      check('(integer) any -> boolean', '(number) -> boolean')
    ).toBeUndefined();
    expect(
      check('(string) any -> boolean', '(number) -> boolean')?.rule
    ).toBe('disjoint-parameter');
  });
});
