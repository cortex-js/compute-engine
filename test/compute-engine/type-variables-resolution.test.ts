import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { solveArm } from '../../src/compute-engine/boxed-expression/generic-instantiation';
import { resolveOverload } from '../../src/compute-engine/boxed-expression/overload';
import type { FunctionSignature } from '../../src/common/type/types';
import type { Expression } from '../../src/compute-engine/global-types';

//
// Type variables — the RESOLUTION half (overload instantiation, the call-site
// solver's embedding, and the declaration-time gates that read a polytype's
// result).
//
// Regression pins for the review round on
// `docs/plans/2026-08-01-type-variables-design.md`'s phase-3 implementation.
// Each `describe` names the defect it locks out.
//

const fresh = () => new ComputeEngine();

const arm = (s: string) => parseType(s) as FunctionSignature;

describe('the arm-aware `at`-handler check DISTRIBUTES over a union result', () => {
  // The parameterized-`collection<T>` repair (which works around `couldMatch`'s
  // like-with-like kind comparison) used to test the WHOLE result node. A union
  // result answered `false` on its `collection` member — `couldMatch`
  // distributes — and then fell straight through the repair, so a definition
  // with a possibly-indexed arm was rejected outright.
  const handlers = {
    iterator: () => ({ next: () => ({ done: true, value: undefined }) }) as any,
    count: () => 0,
    at: () => undefined,
  };

  const declareWith = (name: string, signature: string) => {
    const ce = fresh();
    ce.declare(name, {
      signature,
      collection: handlers,
      evaluate: () => undefined,
    } as any);
    return ce.lookupDefinition(name);
  };

  test('`collection<number> | set<number>` admits an `at` handler', () => {
    expect(
      declareWith(
        'unionColl',
        '(collection) -> collection<number> | set<number>'
      )
    ).toBeDefined();
  });

  test('the unparameterized and single-member forms are unchanged', () => {
    expect(
      declareWith('plainColl', '(collection) -> collection<number>')
    ).toBeDefined();
    expect(
      declareWith('idxUnion', '(collection) -> list<number> | set<number>')
    ).toBeDefined();
  });

  test('a union that can NEVER be indexed still rejects the handler', () => {
    expect(() =>
      declareWith('scalarUnion', '(collection) -> set<number> | set<string>')
    ).toThrow(/can return an indexed collection/);
  });
});

describe('LAZY-IDLE — the solver never touches a lazy operand', () => {
  // §4.5: a lazy operator's operands arrive UNBOUND, so reading `.type` on them
  // is both meaningless and a canonicalization side trip. The carve-out used to
  // live only in the `skip` predicate, which runs AFTER the actuals array
  // (`ops.map((op) => op.type.type)`) has already forced every operand.
  const tripwire = (): Expression =>
    ({
      get type(): never {
        throw new Error('lazy operand `.type` was read');
      },
      isValid: true,
    }) as any;

  test('no operand `.type` is forced under `lazy`', () => {
    const sig = arm('forall T: number. (list<T>) -> T');
    expect(() => solveArm(sig, [tripwire()], { lazy: true })).not.toThrow();
  });

  test('every variable falls to its S3 declared-bound fallback', () => {
    const sig = arm('forall T: number. (list<T>) -> T');
    const solved = solveArm(sig, [tripwire()], { lazy: true });
    expect(solved.bindings.T).toBe('number');
    expect(solved.failures).toEqual([]);
  });

  test('the end-to-end lazy operator is unaffected', () => {
    const ce = fresh();
    ce.declare('lzr', {
      signature: 'forall T: number. (list<T>) -> T',
      lazy: true,
      evaluate: (ops) => ops[0],
    });
    const bad = ce.box(['lzr', ce.string('not a list')]);
    expect(bad.isValid).toBe(true);
    expect(bad.type.toString()).toBe('number');
  });
});

describe('`OverloadResolution` carries only what a caller consumes', () => {
  // The interface briefly grew `viableDeclared`/`bindings` with no consumer.
  // What survives is `selectedInstance` (the value-arm JOIN needs a GROUND arm)
  // and `selectedSolution` (`validateArguments` reuses it instead of re-solving
  // the same arm against the same operands).
  const ce = fresh();

  test('a generic selected arm exposes its solve, ground arms do not', () => {
    const arms = [arm('forall T: number. (T) -> T'), arm('(string) -> string')];
    const generic = resolveOverload(ce, [ce.number(2)], arms);
    expect(generic.selected?.typeParams?.length).toBe(1);
    // `selectedInstance` is GROUND: the clause is discharged.
    expect(generic.selectedInstance?.typeParams).toBeUndefined();
    expect(generic.selectedSolution?.bindings.T).toBe('finite_integer');

    const ground = resolveOverload(ce, [ce.string('x')], arms);
    expect(ground.selected).toBe(arms[1]);
    expect(ground.selectedInstance).toBe(arms[1]);
    expect(ground.selectedSolution).toBeUndefined();
  });

  test('a call no arm accepts reports nothing selected', () => {
    const arms = [arm('(string) -> string')];
    const r = resolveOverload(ce, [ce.number(2)], arms);
    expect(r.selected).toBeUndefined();
    expect(r.selectedInstance).toBeUndefined();
    expect(r.selectedSolution).toBeUndefined();
    expect(r.viable).toEqual([]);
  });

  test('the retired fields are gone', () => {
    const r: any = resolveOverload(
      ce,
      [ce.number(2)],
      [arm('(number) -> number')]
    );
    expect('viableDeclared' in r).toBe(false);
    expect('bindings' in r).toBe(false);
  });
});

describe('the value-arm JOIN runs on INSTANTIATED arms (§4.2)', () => {
  // `triStateSelect`/`armAdmission`/`isMoreSpecific` compare parameters, and the
  // `blocked` branch WIDENS results. Handed the DECLARED arms, a generic arm's
  // open `T` reached `provablyDisjoint`/`typeCategory`/`widen` — all three §4.2
  // tripwires — and the joined result was the undeclarable `T | string`.
  const setup = () => {
    const ce = fresh();
    ce.declare('vg', {
      signature: '((0) -> string) & (forall T: number. (T) -> T)',
      evaluate: (ops) => ops[0],
    } as any);
    ce.declare('n', 'integer');
    return ce;
  };

  test("dispatch DECIDED by the value arm keeps that arm's result", () => {
    expect(setup().box(['vg', 0]).type.toString()).toBe('string');
  });

  test('dispatch decided by the generic arm keeps its INSTANCE result', () => {
    expect(setup().box(['vg', 2]).type.toString()).toBe('finite_integer');
  });

  test('a BLOCKED dispatch joins GROUND results, never an open one', () => {
    const t = setup().box(['vg', 'n']).type;
    expect(t.toString()).toBe('integer | string');
    // The §4.2 leak used to surface as an undeclarable type; declaring the
    // joined result is the sharpest witness that it is ground.
    expect(() => fresh().declare('joined', t.toString())).not.toThrow();
  });

  test('the blocked call stays valid', () => {
    expect(setup().box(['vg', 'n']).isValid).toBe(true);
  });
});

describe('D7 names a function-literal body only when there IS one', () => {
  const D7 = /generic declaration cannot take a function-literal body/;

  test('a `Function` literal still gets the D7 diagnostic on `ce.assign`', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (T) -> T');
    expect(() => ce.assign('f', ce.parse('x \\mapsto x'))).toThrow(D7);
  });

  test('…and on the `Assign` OPERATOR route, as an error value', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (T) -> T');
    const v = ce
      .box(['Assign', 'f', ['Function', ['Add', 'x', 1], 'x']])
      .evaluate();
    expect(v.toString()).toContain('incompatible-type');
    expect(v.toString()).toMatch(D7);
  });

  test('a GROUND function symbol gets a plain `incompatible-type` instead', () => {
    const ce = fresh();
    ce.declare('g', '(integer) -> string');
    let caught: any;
    try {
      ce.declare('f', {
        type: 'forall T. (T) -> T',
        value: ce.symbol('g'),
      } as any);
    } catch (e) {
      caught = e;
    }
    expect(caught?.name).toBe('TypeCompatibilityError');
    expect(caught.message).not.toMatch(D7);
    expect(caught.message).toMatch(/is not compatible with the type/);
  });

  test('a violated declared BOUND on a ground function symbol, likewise', () => {
    const ce = fresh();
    ce.declare('g', '(integer) -> integer');
    let caught: any;
    try {
      ce.declare('f', {
        type: 'forall T: string. (T) -> T',
        value: ce.symbol('g'),
      } as any);
    } catch (e) {
      caught = e;
    }
    expect(caught?.name).toBe('TypeCompatibilityError');
    expect(caught.message).not.toMatch(D7);
  });

  // An INSTANCE-SHAPED ground function is the trap: the D12 existential
  // `matches` answers true for it (`(integer) -> integer` IS an instantiation
  // of `forall T. (T) -> T`), but a declaration promises EVERY instantiation
  // (`Ground <: Poly` false, D3). The declaration boundary must use subtype
  // semantics, not the query probe — without that, this assignment succeeds
  // silently.
  test('an INSTANCE-shaped ground function is still rejected (D3, not D12)', () => {
    const ce = fresh();
    ce.declare('g', '(integer) -> integer');
    expect(() =>
      ce.declare('f', {
        type: 'forall T. (T) -> T',
        value: ce.symbol('g'),
      } as any)
    ).toThrow(/is not compatible with the type/);
    const ce2 = fresh();
    ce2.declare('g', '(integer) -> integer');
    ce2.declare('f', 'forall T. (T) -> T');
    expect(() => ce2.assign('f', ce2.symbol('g'))).toThrow(
      /is not compatible with the type/
    );
  });
});

describe('§4.5 parity on the VALUE-definition route', () => {
  // A function symbol declared with a plain type STRING resolves through the
  // value-definition route (`box.ts`'s `isValueDef` branch and the value-def
  // arm of `computeFunctionType`), not the operator route. Both halves of that
  // route used to disagree with their operator-route twins on a polytype:
  //
  //  (ii) the declared BOUND was not enforced — `paramsAreScalar` read a bare
  //       `T` as scalar whatever its bound, so the broadcast-lift gate admitted
  //       ANY collection at a `T: indexed_collection` parameter.
  // (iii) a D10 lift-echo was wrapped TWICE — the result already IS the full
  //       actual, and the broadcast wrapper lifted it again.
  const setup = () => {
    const ce = fresh();
    // The same signature on all three routes.
    ce.declare('vecho', 'forall T: indexed_collection. (T) -> T'); // value
    ce.declare('oecho', {
      signature: 'forall T: indexed_collection. (T) -> T',
    }); // operator
    ce.declare('gecho', '(indexed_collection) -> indexed_collection'); // ground
    return ce;
  };

  const M22 = ['List', ['List', 1, 2], ['List', 3, 4]];

  test('(ii) a `set` operand is rejected identically on all three routes', () => {
    const ce = setup();
    for (const f of ['vecho', 'oecho', 'gecho']) {
      const e = ce.box([f, ['Set', 1, 2]]);
      expect(e.isValid).toBe(false);
      // §8: the reported expected type is the ground BOUND, never variable
      // syntax — and it is the same string on every route.
      expect(JSON.stringify(e.json)).toBe(
        `["${f}",["Error",["ErrorCode","'incompatible-type'","'indexed_collection'","'set<finite_integer>'"]]]`
      );
    }
  });

  test('(ii) a scalar operand is still rejected on the value route', () => {
    const ce = setup();
    expect(ce.box(['vecho', 5]).isValid).toBe(false);
    expect(ce.box(['oecho', 5]).isValid).toBe(false);
  });

  test('(ii) a matrix operand is admitted and echoed verbatim', () => {
    const ce = setup();
    const e = ce.box(['vecho', M22]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix<finite_integer^(2x2)>');
    expect(e.type.toString()).toBe(e.op1.type.toString());
    // Route parity: the operator route says the same thing.
    expect(ce.box(['oecho', M22]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
  });

  test('(iii) a D10 lift-echo is NOT wrapped a second time', () => {
    const ce = fresh();
    ce.declare('vid', 'forall T. (T) -> T'); // value route
    ce.declare('oid', { signature: 'forall T. (T) -> T' }); // operator route
    expect(ce.box(['vid', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['oid', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['vid', M22]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
    // A scalar operand is unaffected.
    expect(ce.box(['vid', 5]).type.toString()).toBe('finite_integer');
  });

  test('(iii) a scalar-bounded polytype echoes the actual, as on the operator route', () => {
    const ce = fresh();
    ce.declare('vnum', 'forall T: number. (T) -> T');
    ce.declare('onum', {
      signature: 'forall T: number. (T) -> T',
      broadcastable: true,
    });
    // D10: the lift binds the FULL actual, so both routes echo the operand's
    // own type (this is what the migrated `Conjugate`/`Chop` handlers produce).
    expect(ce.box(['vnum', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['onum', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['vnum', 2]).type.toString()).toBe('finite_integer');
  });

  test('a migrated broadcastable operator still evaluates elementwise', () => {
    const ce = fresh();
    // `Chop`: `forall T: number. (T) -> T`, broadcastable.
    expect(ce.box(['Chop', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(
      ce
        .box(['Chop', ['List', 1e-12, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[0,2,3]');
    expect(
      ce
        .box(['Conjugate', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
  });

  test('GROUND value-route rows are unchanged', () => {
    const ce = fresh();
    // The `(any) -> any` single-wrap convention of the ground value route.
    ce.declare('ga', '(any) -> any');
    expect(ce.box(['ga', ['List', 1, 2, 3]]).type.toString()).toBe(
      'list<any^3>'
    );
    ce.declare('gn', '(number) -> number');
    expect(ce.box(['gn', ['List', 1, 2, 3]]).type.toString()).toBe('vector<3>');
    ce.declare('gc', '(indexed_collection) -> indexed_collection');
    expect(ce.box(['gc', ['Set', 1, 2]]).isValid).toBe(false);
    expect(ce.box(['gc', ['List', 1, 2, 3]]).type.toString()).toBe(
      'indexed_collection'
    );
  });
});
