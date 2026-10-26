// Value kinds, steps 1 and 2: the kind registry, the declaration checks,
// the subtype and disjointness rules of a nominal type defined as exactly
// `value`, and the recognition of kind values
// (`docs/plans/2026-10-26-value-kinds.md`, sections 4.1, 4.1.1, 4.1.2 and
// 4.6). Admission beyond the arithmetic operators, dispatch and compilation
// are not wired yet: the hooks below are stubs.

import { ComputeEngine, compile } from '../../src/compute-engine';
import type {
  ArithmeticDefinition,
  BoxedOperatorDefinition,
  Expression,
} from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { provablyDisjoint } from '../../src/common/type/subtype';
import {
  arithmeticOf,
  engineHasKindDeclarations,
  engineHasKindValues,
  engineHasKindValuesAssigned,
  isKindType,
  kindGeneration,
  kindTypeHasHook,
  kindTypeInfo,
  kindTypesOf,
  noteKindValueAssigned,
} from '../../src/compute-engine/boxed-expression/value-kinds';
import {
  holdsKindValue,
  holdsKindValueForCertain,
} from '../../src/compute-engine/boxed-expression/residue-class';

/** Stub hooks: a kind that gives `add` must give `negate`. */
const gf8Arithmetic = (
  extra: Partial<ArithmeticDefinition> = {}
): ArithmeticDefinition => ({
  add: () => undefined,
  negate: () => undefined,
  multiply: () => undefined,
  ...extra,
});

/** An engine with the user nominal kind type `gf8`. */
function gf8Engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('gf8', 'value', { mint: false });
  return ce;
}

/** An engine with `gf8` and its head `GF8: (integer) -> gf8`. */
function gf8EngineWithHead(
  extra: Partial<ArithmeticDefinition> = {}
): ComputeEngine {
  const ce = gf8Engine();
  ce.declare('GF8', {
    signature: '(integer) -> gf8',
    arithmetic: gf8Arithmetic(extra),
  });
  return ce;
}

function operatorDef(ce: ComputeEngine, name: string): BoxedOperatorDefinition {
  const def = ce.lookupDefinition(name);
  if (def === undefined || !('operator' in def))
    throw new Error(`"${name}" is not an operator`);
  return def.operator;
}

/** An engine whose bootstrap installs a LIBRARY head of the kind primitive
 * `residue`, as the library's own kind heads will be. */
function engineWithLibraryKind(): ComputeEngine {
  return new ComputeEngine({
    libraries: [
      ...ComputeEngine.getStandardLibrary(),
      {
        name: 'value-kinds-test-library',
        definitions: {
          LibMod: {
            signature: '(integer, integer) -> residue',
            arithmetic: { negate: () => undefined },
          },
        },
      },
    ],
  });
}

describe('VALUE KINDS: a nominal type defined as exactly `value`', () => {
  test('is a subtype of value and expression, not of number', () => {
    const ce = gf8Engine();
    const t = ce.type('gf8');
    expect(t.matches('value')).toBe(true);
    expect(t.matches('expression')).toBe(true);
    expect(t.matches('any')).toBe(true);
    expect(t.matches('number')).toBe(false);
    expect(t.matches('integer')).toBe(false);
  });

  test('is disjoint from the numbers, booleans, strings and collections', () => {
    const ce = gf8Engine();
    const t = ce.type('gf8').type;
    for (const other of [
      'number',
      'integer',
      'boolean',
      'string',
      'list<integer>',
      'residue',
      'tuple<integer, integer>',
    ])
      expect([other, provablyDisjoint(t, ce.type(other).type)]).toEqual([
        other,
        true,
      ]);
  });

  test('is not disjoint from value, expression, any, unknown, itself', () => {
    const ce = gf8Engine();
    const t = ce.type('gf8').type;
    for (const other of ['value', 'expression', 'any', 'unknown', 'gf8'])
      expect([other, provablyDisjoint(t, ce.type(other).type)]).toEqual([
        other,
        false,
      ]);
    expect(provablyDisjoint(t, ce.type('integer | gf8').type)).toBe(false);
  });

  test('two such types of different names are disjoint', () => {
    const ce = gf8Engine();
    ce.declareType('gf9', 'value', { mint: false });
    expect(provablyDisjoint(ce.type('gf8').type, ce.type('gf9').type)).toBe(
      true
    );
  });

  test('a value of the kind is assigned to a symbol declared `value`', () => {
    const ce = gf8EngineWithHead();
    ce.declare('s', 'value');
    const v = ce.box(['GF8', 1]);
    expect(v.type.toString()).toBe('gf8');
    expect(() => ce.assign('s', v)).not.toThrow();
    expect(ce.box('s').evaluate().toString()).toBe('GF8(1)');
  });
});

describe('VALUE KINDS: the declaration check', () => {
  const refused: [string, string][] = [
    ['(integer) -> integer', 'integer'],
    ['(integer) -> value', 'value'],
    ['(integer) -> any', 'any'],
    ['(integer) -> expression', 'expression'],
    ['(integer) -> boolean', 'boolean'],
    ['(integer) -> residue | integer', 'integer'],
  ];
  test.each(refused)('a kind on `%s` is refused', (signature, arm) => {
    const ce = gf8Engine();
    expect(() =>
      ce.declare('Bad', { signature, arithmetic: gf8Arithmetic() })
    ).toThrow(`the result type has the arm \`${arm}\``);
    // A refused declaration installs nothing.
    expect(ce.lookupDefinition('Bad')).toBeUndefined();
  });

  test('a kind on a nominal type defined as integer is refused', () => {
    const ce = new ComputeEngine();
    ce.declareType('gfi', 'integer', { mint: false });
    expect(() =>
      ce.declare('Bad', {
        signature: '(integer) -> gfi',
        arithmetic: gf8Arithmetic(),
      })
    ).toThrow('a nominal type defined as `integer`');
  });

  test('a kind on a nominal type that minted a constructor is refused', () => {
    const ce = new ComputeEngine();
    ce.declareType('gfm', 'value');
    expect(() =>
      ce.declare('Bad', {
        signature: '(integer) -> gfm',
        arithmetic: gf8Arithmetic(),
      })
    ).toThrow('{ mint: false }');
  });

  test('a kind on a nominal type defined as another nominal type is refused', () => {
    const ce = gf8Engine();
    ce.declareType('h8', 'gf8', { mint: false });
    expect(() =>
      ce.declare('Bad', {
        signature: '(integer) -> h8',
        arithmetic: gf8Arithmetic(),
      })
    ).toThrow('defined as another nominal type');
  });

  test('`add` without `negate` is refused', () => {
    const ce = gf8Engine();
    expect(() =>
      ce.declare('Bad', {
        signature: '(integer) -> gf8',
        arithmetic: { add: () => undefined },
      })
    ).toThrow('must also give `negate`');
  });

  test('`-> residue`, `-> residue | nan` and `-> gf8` are accepted', () => {
    const ce = gf8Engine();
    ce.declare('MyMod', {
      signature: '(integer, integer) -> residue',
      arithmetic: gf8Arithmetic(),
    });
    ce.declare('MyModN', {
      signature: '(integer, integer) -> residue | nan',
      arithmetic: gf8Arithmetic(),
    });
    ce.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: gf8Arithmetic(),
    });
    expect([...kindTypesOf(ce)].sort()).toEqual(['gf8', 'residue']);
    expect(isKindType(ce, ce.type('gf8').type)).toBe(true);
    expect(isKindType(ce, 'residue')).toBe(true);
    expect(isKindType(ce, 'integer')).toBe(false);
    // A union with a kind arm is not itself a kind type.
    expect(isKindType(ce, ce.type('gf8 | nan').type)).toBe(false);
    expect(arithmeticOf(ce, operatorDef(ce, 'GF8'))).toBeDefined();
    // `ResidueClass`, `MyMod` and `MyModN`.
    expect(kindTypeInfo(ce, 'residue')?.heads.size).toBe(3);
  });

  test('`kindTypeHasHook` reads every registered head of the type', () => {
    const ce = gf8EngineWithHead();
    expect(kindTypeHasHook(ce, 'gf8', 'add')).toBe(true);
    expect(kindTypeHasHook(ce, 'gf8', 'apply')).toBe(false);
    ce.declare('GF8b', {
      signature: '(integer) -> gf8',
      arithmetic: { apply: () => undefined },
    });
    expect(kindTypeHasHook(ce, 'gf8', 'apply')).toBe(true);
  });
});

describe('VALUE KINDS: the per-type agreement rule', () => {
  test('two live heads with different `admittedAs` are refused', () => {
    const ce = gf8EngineWithHead({ admittedAs: 'none' });
    expect(() =>
      ce.declare('GF8b', {
        signature: '(integer) -> gf8',
        arithmetic: { admittedAs: 'real' },
      })
    ).toThrow('must give the same `admittedAs` or none');
    expect(ce.lookupDefinition('GF8b')).toBeUndefined();
  });

  test('a head without `admittedAs` counts as `none` for the first head', () => {
    const ce = gf8EngineWithHead();
    expect(kindTypeInfo(ce, 'gf8')?.admittedAs).toBe('none');
    expect(() =>
      ce.declare('GF8b', {
        signature: '(integer) -> gf8',
        arithmetic: { admittedAs: 'number' },
      })
    ).toThrow('`admittedAs`');
  });

  test('two live heads with the same `admittedAs` are accepted', () => {
    const ce = gf8EngineWithHead({ admittedAs: 'real' });
    ce.declare('GF8b', {
      signature: '(integer) -> gf8',
      arithmetic: { admittedAs: 'real' },
    });
    // A head that leaves it out inherits it.
    ce.declare('GF8c', { signature: '(integer) -> gf8', arithmetic: {} });
    expect(kindTypeInfo(ce, 'gf8')?.admittedAs).toBe('real');
    expect(kindTypeInfo(ce, 'gf8')?.heads.size).toBe(3);
  });

  test('two live heads with different `resultType` functions are refused', () => {
    const ce = gf8EngineWithHead({ resultType: () => undefined });
    expect(() =>
      ce.declare('GF8b', {
        signature: '(integer) -> gf8',
        arithmetic: { resultType: () => undefined },
      })
    ).toThrow('another `resultType` function');
  });

  test('a second head adds a `resultType` to a USER type', () => {
    const ce = gf8EngineWithHead();
    const resultType = (): undefined => undefined;
    ce.declare('GF8b', {
      signature: '(integer) -> gf8',
      arithmetic: { resultType },
    });
    expect(kindTypeInfo(ce, 'gf8')?.resultType).toBe(resultType);
  });

  test('a head cannot add a field that the LIBRARY type `residue` left out', () => {
    const ce = engineWithLibraryKind();
    expect(kindTypeInfo(ce, 'residue')?.library).toBe(true);
    expect(() =>
      ce.declare('MyMod', {
        signature: '(integer, integer) -> residue',
        arithmetic: {
          compile: {
            type: { lowered: () => undefined, entry: () => false },
          },
        },
      })
    ).toThrow('declared by the library without a `compile.type`');
    expect(() =>
      ce.declare('MyMod2', {
        signature: '(integer, integer) -> residue',
        arithmetic: { resultType: () => undefined },
      })
    ).toThrow('declared by the library without a `resultType`');
    // Without the field, the head is accepted.
    ce.declare('MyMod', {
      signature: '(integer, integer) -> residue',
      arithmetic: { negate: () => undefined },
    });
    // `ResidueClass`, `LibMod` and `MyMod`.
    expect(kindTypeInfo(ce, 'residue')?.heads.size).toBe(3);
    expect(kindTypeInfo(ce, 'residue')?.compileType).toBeUndefined();
  });

  test('the same rule holds with the library head `ResidueClass` alone', () => {
    const ce = new ComputeEngine();
    expect(kindTypeInfo(ce, 'residue')?.library).toBe(true);
    expect(arithmeticOf(ce, operatorDef(ce, 'ResidueClass'))).toBeDefined();
    expect(() =>
      ce.declare('MyMod', {
        signature: '(integer, integer) -> residue',
        arithmetic: {
          compile: {
            type: { lowered: () => undefined, entry: () => false },
          },
        },
      })
    ).toThrow('declared by the library without a `compile.type`');
    ce.declare('MyMod', {
      signature: '(integer, integer) -> residue',
      arithmetic: { negate: () => undefined },
    });
    expect(kindTypeInfo(ce, 'residue')?.heads.size).toBe(2);
  });

  test('the same declaration run again replaces the fields of the type', () => {
    const ce = gf8EngineWithHead({ admittedAs: 'none' });
    const before = operatorDef(ce, 'GF8');
    const resultType = (): undefined => undefined;
    const arithmetic = gf8Arithmetic({ admittedAs: 'real', resultType });
    // New closures, new fields: accepted, because no OTHER head of the type
    // is live.
    ce.declare(
      'GF8',
      { signature: '(integer) -> gf8', arithmetic },
      { extend: true }
    );
    const after = operatorDef(ce, 'GF8');
    expect(after).not.toBe(before);
    expect(kindTypeInfo(ce, 'gf8')?.admittedAs).toBe('real');
    expect(kindTypeInfo(ce, 'gf8')?.resultType).toBe(resultType);
    expect(arithmeticOf(ce, after)).toBe(arithmetic);
    // The replaced definition has no dispatch entry and is no longer a head.
    expect(arithmeticOf(ce, before)).toBeUndefined();
    expect(kindTypeInfo(ce, 'gf8')?.heads.has(before)).toBe(false);
  });

  test('a redeclaration while another head is live must agree', () => {
    const ce = gf8EngineWithHead({ admittedAs: 'none' });
    ce.declare('GF8b', { signature: '(integer) -> gf8', arithmetic: {} });
    expect(() =>
      ce.declare(
        'GF8',
        {
          signature: '(integer) -> gf8',
          arithmetic: gf8Arithmetic({ admittedAs: 'real' }),
        },
        { extend: true }
      )
    ).toThrow('`admittedAs`');
    // The refused redeclaration left the previous definition in place.
    expect(arithmeticOf(ce, operatorDef(ce, 'GF8'))).toBeDefined();
  });

  test('a redeclaration without `arithmetic` removes the dispatch entry', () => {
    const ce = gf8EngineWithHead({ admittedAs: 'real' });
    const before = operatorDef(ce, 'GF8');
    ce.declare('GF8', { arithmetic: undefined }, { extend: true });
    const after = operatorDef(ce, 'GF8');
    expect(arithmeticOf(ce, before)).toBeUndefined();
    expect(arithmeticOf(ce, after)).toBeUndefined();
    // The type stays a kind type, with its fields.
    expect(isKindType(ce, ce.type('gf8').type)).toBe(true);
    expect(kindTypeInfo(ce, 'gf8')?.heads.size).toBe(0);
    expect(kindTypeInfo(ce, 'gf8')?.admittedAs).toBe('real');
  });

  test('a head declared when no live head remains replaces the fields', () => {
    const ce = gf8EngineWithHead({ admittedAs: 'real' });
    ce.declare('GF8', { arithmetic: undefined }, { extend: true });
    ce.declare('GF8b', {
      signature: '(integer) -> gf8',
      arithmetic: { admittedAs: 'number' },
    });
    expect(kindTypeInfo(ce, 'gf8')?.admittedAs).toBe('number');
  });
});

describe('VALUE KINDS: the generation counter and the checkpoint model', () => {
  test('the generation moves on register, replace, remove and restore', () => {
    const ce = gf8Engine();
    const g0 = kindGeneration(ce);
    const cp = ce.checkpoint();

    ce.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: gf8Arithmetic(),
    });
    const g1 = kindGeneration(ce);
    expect(g1).toBeGreaterThan(g0);

    ce.declare(
      'GF8',
      { signature: '(integer) -> gf8', arithmetic: gf8Arithmetic() },
      { extend: true }
    );
    const g2 = kindGeneration(ce);
    expect(g2).toBeGreaterThan(g1);

    ce.declare('GF8', { arithmetic: undefined }, { extend: true });
    const g3 = kindGeneration(ce);
    expect(g3).toBeGreaterThan(g2);

    ce.restore(cp);
    expect(kindGeneration(ce)).toBeGreaterThan(g3);
  });

  test('a checkpoint taken before a registration restores to none', () => {
    const ce = gf8Engine();
    const cp = ce.checkpoint();
    ce.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: gf8Arithmetic(),
    });
    const def = operatorDef(ce, 'GF8');
    expect(kindTypesOf(ce).has('gf8')).toBe(true);
    const before = kindGeneration(ce);

    ce.restore(cp);
    // `residue` was registered by the library head `ResidueClass` before
    // the checkpoint.
    expect([...kindTypesOf(ce)]).toEqual(['residue']);
    expect(kindTypeInfo(ce, 'gf8')).toBeUndefined();
    expect(arithmeticOf(ce, def)).toBeUndefined();
    expect(ce.lookupDefinition('GF8')).toBeUndefined();
    expect(kindGeneration(ce)).toBeGreaterThan(before);
    // The type itself was declared before the checkpoint and stays.
    expect(ce.type('gf8').matches('value')).toBe(true);
  });

  test('a restore puts back the fields a later registration changed', () => {
    const ce = gf8EngineWithHead();
    const cp = ce.checkpoint();
    const resultType = (): undefined => undefined;
    ce.declare('GF8b', {
      signature: '(integer) -> gf8',
      arithmetic: { resultType },
    });
    expect(kindTypeInfo(ce, 'gf8')?.resultType).toBe(resultType);
    expect(kindTypeInfo(ce, 'gf8')?.heads.size).toBe(2);

    ce.restore(cp);
    expect(kindTypeInfo(ce, 'gf8')?.resultType).toBeUndefined();
    expect(kindTypeInfo(ce, 'gf8')?.heads.size).toBe(1);
    expect(arithmeticOf(ce, operatorDef(ce, 'GF8'))).toBeDefined();
  });

  // A redeclaration inside an inference rollback frame is undone with the
  // frame: the previous binding AND its dispatch entry come back, so a sum of
  // the head's values uses the previous hooks.
  describe('a redeclaration rolled back by an inference rollback frame', () => {
    function tracedEngine(calls: string[]): ComputeEngine {
      return gf8EngineWithHead({
        add: () => {
          calls.push('original');
          return undefined;
        },
      });
    }

    function rolledBack(ce: ComputeEngine, fn: () => void): void {
      ce._withBoxingPassWindow(() => ce._withRolledBackInference(fn));
    }

    test('with other hooks', () => {
      const calls: string[] = [];
      const ce = tracedEngine(calls);
      const original = arithmeticOf(ce, operatorDef(ce, 'GF8'));
      rolledBack(ce, () => {
        ce.declare(
          'GF8',
          {
            signature: '(integer) -> gf8',
            arithmetic: gf8Arithmetic({
              admittedAs: 'real',
              add: () => {
                calls.push('replacement');
                return undefined;
              },
            }),
          },
          { extend: true }
        );
      });
      expect(arithmeticOf(ce, operatorDef(ce, 'GF8'))).toBe(original);
      expect(kindTypeInfo(ce, 'gf8')?.admittedAs).not.toBe('real');
      expect(kindTypeInfo(ce, 'gf8')?.heads.size).toBe(1);
      ce.box(['Add', ['GF8', 1], ['GF8', 2]]).evaluate();
      expect(calls).toEqual(['original']);
    });

    test('without `arithmetic`', () => {
      const calls: string[] = [];
      const ce = tracedEngine(calls);
      const original = arithmeticOf(ce, operatorDef(ce, 'GF8'));
      rolledBack(ce, () => {
        ce.declare('GF8', { arithmetic: undefined }, { extend: true });
      });
      expect(arithmeticOf(ce, operatorDef(ce, 'GF8'))).toBe(original);
      expect(kindTypeInfo(ce, 'gf8')?.heads.size).toBe(1);
      ce.box(['Add', ['GF8', 1], ['GF8', 2]]).evaluate();
      expect(calls).toEqual(['original']);
    });
  });
});

describe('VALUE KINDS: the type-declaration funnel', () => {
  test('a registered kind type cannot be redefined as another type', () => {
    const ce = gf8EngineWithHead();
    expect(() => ce.declareType('gf8', 'integer')).toThrow(
      'is the type of a value kind'
    );
    // With the options of a kind type, the definition is checked after the
    // body is parsed; the host route refuses the second declaration first.
    expect(() => ce.declareType('gf8', 'integer', { mint: false })).toThrow(
      'is already defined'
    );
    expect(() => ce.declareType('gf8', 'value')).toThrow(
      'is the type of a value kind'
    );
    expect(() =>
      ce.declareType('gf8', 'value', { mint: false, alias: true })
    ).toThrow('is the type of a value kind');
    // Nothing changed.
    expect(ce._typeRegistry['gf8'].def).toBe('value');
    expect(ce._typeRegistry['gf8']._minted).toBe(false);
    expect(ce.type('gf8').matches('value')).toBe(true);
  });

  test('a `type` statement of Epsil cannot redefine a kind type', () => {
    const ce = gf8EngineWithHead();
    const r = executeEpsil(ce, 'type gf8 = integer');
    // The refusal is the value of the statement.
    expect(r.value.toString()).toContain('is the type of a value kind');
    expect(ce._typeRegistry['gf8'].def).toBe('value');
    expect(ce.type('gf8').matches('number')).toBe(false);
  });

  test('an unregistered type keeps its ordinary rules', () => {
    const ce = gf8Engine();
    // `gf8` is not a kind type yet: the host route refuses a second
    // declaration as before, with the ordinary message.
    expect(() => ce.declareType('gf8', 'integer')).toThrow(
      'is already defined'
    );
  });
});

describe('VALUE KINDS: the per-engine gates', () => {
  test('a fresh engine has no kind values', () => {
    const ce = new ComputeEngine();
    expect(engineHasKindValues(ce)).toBe(false);
    expect(engineHasKindValuesAssigned(ce)).toBe(false);
    expect(engineHasKindDeclarations(ce)).toBe(false);
  });

  test('a user registration joins the engine for its type', () => {
    const ce = gf8EngineWithHead();
    expect(engineHasKindValues(ce, 'gf8')).toBe(true);
    expect(engineHasKindDeclarations(ce, 'gf8')).toBe(true);
    expect(engineHasKindValues(ce, 'residue')).toBe(false);
    ce.box(['GF8', 1]);
    expect(engineHasKindValues(ce, 'gf8')).toBe(true);
  });

  test('a library registration does not join; a value of its head does', () => {
    const ce = engineWithLibraryKind();
    expect(kindTypesOf(ce).has('residue')).toBe(true);
    expect(engineHasKindValues(ce)).toBe(false);
    expect(engineHasKindDeclarations(ce)).toBe(false);
    ce.box(['LibMod', 1, 5]);
    expect(engineHasKindValues(ce, 'residue')).toBe(true);
    expect(engineHasKindValuesAssigned(ce, 'residue')).toBe(false);
  });

  test('an assignment event opens the assignment gate', () => {
    const ce = new ComputeEngine();
    noteKindValueAssigned(ce, 'residue');
    expect(engineHasKindValuesAssigned(ce, 'residue')).toBe(true);
    expect(engineHasKindValues(ce, 'residue')).toBe(true);
  });
});

//
// Step 2: recognition (`docs/plans/2026-10-26-value-kinds.md`, section 4.6).
// The recognition of a kind value reads the kind registry: the kind types
// and the kind heads of the engine, not the constant `residue` and
// `ResidueClass`.
//

/** The non-strict and the strict reading of `expr`, in that order. */
function readings(expr: Expression): [boolean, boolean] {
  return [holdsKindValue(expr), holdsKindValueForCertain(expr)];
}

describe('VALUE KINDS: recognition of a kind value', () => {
  test('a call of the kind head', () => {
    const ce = gf8EngineWithHead();
    expect(readings(ce.box(['GF8', 1]))).toEqual([true, true]);
    expect(readings(ce.box(['Add', ['GF8', 1], 'y']))).toEqual([true, true]);
    // An ordinary expression holds no kind value.
    expect(readings(ce.box(['Add', 'y', 1]))).toEqual([false, false]);
  });

  test('a symbol declared with the kind type', () => {
    const ce = gf8EngineWithHead();
    ce.declare('r', 'gf8');
    expect(readings(ce.box('r'))).toEqual([true, true]);
    expect(readings(ce.box(['Multiply', 2, 'r']))).toEqual([true, true]);
  });

  test('a symbol declared with a kind arm beside a number type', () => {
    const ce = gf8EngineWithHead();
    ce.declare('u', 'integer | gf8');
    // It may be a kind value (non-strict), but it may be a number (strict).
    expect(readings(ce.box('u'))).toEqual([true, false]);
    expect(readings(ce.box(['Add', 'u', 1]))).toEqual([true, false]);
  });

  test('a symbol whose value holds a call of the kind head', () => {
    const ce = gf8EngineWithHead();
    ce.declare('s', 'value');
    ce.assign('s', ce.box(['GF8', 3]));
    expect(readings(ce.box('s'))).toEqual([true, true]);
    // Transitively, through another symbol.
    ce.declare('t', 'value');
    ce.assign('t', ce.box(['Tuple', 's', 1]));
    expect(holdsKindValue(ce.box('t'))).toBe(true);
  });

  test('a call of a callee declared to return the kind type', () => {
    const ce = gf8EngineWithHead();
    ce.declare('g', '(integer) -> gf8');
    expect(readings(ce.box(['g', 2]))).toEqual([true, true]);
    expect(readings(ce.box(['Divide', ['g', 2], ['g', 2]]))).toEqual([
      true,
      true,
    ]);
  });

  test('a symbol declared as a list of kind values', () => {
    const ce = gf8EngineWithHead();
    ce.declare('L', 'list<gf8>');
    expect(readings(ce.box('L'))).toEqual([true, true]);
    ce.declare('M', 'list<gf8 | integer>');
    expect(readings(ce.box('M'))).toEqual([true, false]);
  });

  test('an expression boxed before the kind was registered', () => {
    const ce = gf8Engine();
    // Another kind opens the gates of the engine, so the recognition below
    // walks the expression and keeps its answer.
    ce.declareType('gf9', 'value', { mint: false });
    ce.declare('GF9', { signature: '(integer) -> gf9', arithmetic: {} });
    // `GF8` is declared first without a kind: `gf8` is not a kind type.
    ce.declare('GF8', { signature: '(integer) -> gf8' });
    const expr = ce.box(['Tuple', ['GF8', 1], 'y']);
    expect(holdsKindValue(expr)).toBe(false);
    const before = kindGeneration(ce);
    ce.declare(
      'GF8',
      { signature: '(integer) -> gf8', arithmetic: gf8Arithmetic() },
      { extend: true }
    );
    expect(kindGeneration(ce)).toBeGreaterThan(before);
    // The answer kept for `expr` was computed under an earlier generation.
    expect(holdsKindValue(expr)).toBe(true);
  });

  test('`undeclare()` removes the dispatch entry; the kind type stays', () => {
    const ce = gf8EngineWithHead();
    const def = operatorDef(ce, 'GF8');
    const before = kindGeneration(ce);
    ce.declare('r', 'gf8');
    ce.undeclare('GF8');
    expect(arithmeticOf(ce, def)).toBeUndefined();
    expect(kindTypeInfo(ce, 'gf8')?.heads.size).toBe(0);
    expect(kindGeneration(ce)).toBeGreaterThan(before);
    // The type keeps its protection.
    expect(isKindType(ce, ce.type('gf8').type)).toBe(true);
    expect(holdsKindValue(ce.box(['Divide', 'r', 'r']))).toBe(true);
    // A checkpoint restore puts the entry back.
    const ce2 = gf8EngineWithHead();
    const def2 = operatorDef(ce2, 'GF8');
    const cp = ce2.checkpoint();
    ce2.undeclare('GF8');
    expect(arithmeticOf(ce2, def2)).toBeUndefined();
    ce2.restore(cp);
    expect(arithmeticOf(ce2, def2)).toBeDefined();
  });
});

describe('VALUE KINDS: the per-engine gates of recognition', () => {
  test('an engine that never makes a kind value has every gate closed', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', 'x', ['Divide', 'y', 'y']]).evaluate();
    expect(engineHasKindValues(ce)).toBe(false);
    expect(engineHasKindValuesAssigned(ce)).toBe(false);
    expect(engineHasKindDeclarations(ce)).toBe(false);
  });

  test('a user kind: the registration opens the value and declaration gates', () => {
    const ce = gf8Engine();
    expect(engineHasKindValues(ce, 'gf8')).toBe(false);
    ce.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: gf8Arithmetic(),
    });
    expect(engineHasKindValues(ce, 'gf8')).toBe(true);
    expect(engineHasKindDeclarations(ce, 'gf8')).toBe(true);
    ce.box(['GF8', 1]);
    expect(engineHasKindValues(ce, 'gf8')).toBe(true);
    expect(engineHasKindValuesAssigned(ce, 'gf8')).toBe(false);
    ce.declare('s', 'value');
    ce.assign('s', ce.box(['GF8', 1]));
    expect(engineHasKindValuesAssigned(ce, 'gf8')).toBe(true);
    // The gates of another kind type stay closed.
    expect(engineHasKindValues(ce, 'residue')).toBe(false);
  });

  // The library kind `residue` does not open its gates at registration, so
  // each event can be seen on its own.
  test('a value of the kind head opens the value gate', () => {
    const ce = new ComputeEngine();
    ce.box(['ResidueClass', 1, 5]);
    expect(engineHasKindValues(ce, 'residue')).toBe(true);
    expect(engineHasKindValuesAssigned(ce, 'residue')).toBe(false);
    expect(engineHasKindDeclarations(ce, 'residue')).toBe(false);
  });

  test('a non-canonical value of the kind head opens the value gate', () => {
    const ce = new ComputeEngine();
    ce.box(['ResidueClass', 1, 5], { form: 'raw' });
    expect(engineHasKindValues(ce, 'residue')).toBe(true);
  });

  test('a symbol declared with the kind type opens the declaration gate', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'integer | residue');
    expect(engineHasKindDeclarations(ce, 'residue')).toBe(true);
    expect(engineHasKindValues(ce, 'residue')).toBe(true);
    expect(engineHasKindValuesAssigned(ce, 'residue')).toBe(false);
  });

  test('a value assigned to a symbol opens the assignment gate', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'value');
    ce.assign('s', ce.box(['ResidueClass', 1, 5]));
    expect(engineHasKindValuesAssigned(ce, 'residue')).toBe(true);
  });

  test('a user callable that returns the kind type opens the declaration gate', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> residue');
    expect(engineHasKindDeclarations(ce, 'residue')).toBe(true);
    const ce2 = new ComputeEngine();
    ce2.declare('F', { signature: '(integer) -> residue' });
    expect(engineHasKindDeclarations(ce2, 'residue')).toBe(true);
  });

  test('a user callable that returns a user kind type: the protection holds', () => {
    const ce = gf8EngineWithHead();
    ce.declare('f', '(integer) -> gf8');
    expect(engineHasKindDeclarations(ce, 'gf8')).toBe(true);
    expect(holdsKindValue(ce.box(['Subtract', ['f', 2], ['f', 2]]))).toBe(true);
  });
});

describe('VALUE KINDS: the sites that read the kind types', () => {
  test('a literal list of kind values carries its length', () => {
    const ce = gf8EngineWithHead();
    expect(ce.box(['List', ['GF8', 1], ['GF8', 2]]).type.toString()).toBe(
      'list<gf8^2>'
    );
  });

  test('two kind values juxtaposed parse to a product', () => {
    const ce = gf8EngineWithHead();
    expect(
      ce.parse('\\operatorname{GF8}(1)\\operatorname{GF8}(2)').json
    ).toEqual(['Multiply', ['GF8', 1], ['GF8', 2]]);
  });

  test('`Map(x ↦ x/x, …)` over kind values keeps `x/x`', () => {
    // `GF8` declares `divide`: `Divide` admits a kind value only when a head
    // of its type declares that hook.
    const ce = gf8EngineWithHead({ divide: () => undefined });
    const viaBox = ce.box([
      'Map',
      ['Function', ['Divide', 'x', 'x'], 'x'],
      ['List', ['GF8', 1], ['GF8', 2]],
    ]);
    expect(viaBox.json).toEqual([
      'Map',
      ['Function', ['Block', ['Divide', 'x', 'x']], 'x'],
      ['List', ['GF8', 1], ['GF8', 2]],
    ]);
    const viaParse = ce.parse(
      '\\operatorname{Map}(x\\mapsto x/x, [\\operatorname{GF8}(1), \\operatorname{GF8}(2)])'
    );
    expect(viaParse.json).toEqual(viaBox.json);
  });

  test('`Log(1, K(2))` is not folded to 0', () => {
    const ce = gf8EngineWithHead();
    expect(ce.box(['Log', 1, ['GF8', 2]]).isSame(0)).toBe(false);
    // With a base that may be a kind value.
    ce.declare('b', 'real | gf8');
    expect(ce.box(['Log', 1, 'b']).isSame(0)).toBe(false);
    // A real base folds, as before.
    ce.declare('c', 'real');
    expect(ce.box(['Log', 1, 'c']).isSame(0)).toBe(true);
  });

  test('`simplify(x/x)` with `x: gf8` is unchanged', () => {
    const ce = gf8EngineWithHead({ divide: () => undefined });
    ce.declare('x', 'gf8');
    expect(ce.box(['Divide', 'x', 'x']).simplify().json).toEqual([
      'Divide',
      'x',
      'x',
    ]);
    expect(ce.box(['Subtract', 'x', 'x']).simplify().isSame(0)).toBe(false);
  });

  test('a node that is not arithmetic simplifies as before', () => {
    const ce = gf8EngineWithHead();
    expect(ce.box(['Equal', ['GF8', 1], ['GF8', 1]]).simplify().json).toEqual(
      'True'
    );
    expect(
      ce
        .box([
          'Tuple',
          ['GF8', 1],
          ['Add', ['Power', ['Sin', 'y'], 2], ['Power', ['Cos', 'y'], 2]],
        ])
        .simplify().json
    ).toEqual(['Tuple', ['GF8', 1], 1]);
  });

  test('the compile decline names the kind type', () => {
    const ce = gf8EngineWithHead();
    ce.declare('x', 'real');
    expect(() =>
      compile(ce.box(['Add', 'x', ['GF8', 1]]), { fallback: false })
    ).toThrow("holds a value of the kind type 'gf8'");
    // A residue class keeps its message.
    expect(() =>
      compile(ce.box(['Add', 'x', ['ResidueClass', 1, 5]]), {
        fallback: false,
      })
    ).toThrow("holds a residue class (type 'residue')");
  });
});
