import { ComputeEngine } from '../../src/compute-engine';
import { isFreeName } from '../../src/compute-engine/boxed-expression/type-guards';
import {
  UnitEnvironment,
  unitEnvironmentOfOperands,
} from '../../src/compute-engine/binding-unit';
import { EngineBoxingState } from '../../src/compute-engine/engine-boxing-state';

// Phase A of slice 1 of binding units, with the engine flag `_bindingUnits`
// on: boxing writes no definition, a name with no definition is a free name,
// the requirements of the uses of a name with no explicit type go in the
// environment of the unit, and a read resolves the definition when it
// happens. The rows are those of section 2 of
// `docs/plans/2026-11-09-binding-units-slice-1-spec.md` that phase A covers.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._bindingUnits = true;
  return ce;
}

function envOf(expr: unknown): UnitEnvironment | undefined {
  return (expr as { _env?: UnitEnvironment })._env;
}

describe('BINDING UNITS: FREE NAMES', () => {
  test('a parse declares no name', () => {
    const ce = engine();
    ce.parse('x + 1');
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  test('a name with no definition is a free name', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const x = a.op1;
    expect(x.symbol).toBe('x');
    expect(isFreeName(x)).toBe(true);
    expect(x.isCanonical).toBe(true);
    expect(x.valueDefinition).toBeUndefined();
    expect(x.operatorDefinition).toBeUndefined();
  });

  test('a free name stays a free name after a declaration', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce.declare('x', 'real');
    expect(isFreeName(a.op1)).toBe(true);
    expect(ce.lookupDefinition('x')).toBeDefined();
  });

  test('a declared name is not a free name', () => {
    const ce = engine();
    ce.declare('x', 'real');
    expect(isFreeName(ce.parse('x + 1').op1)).toBe(false);
  });

  test('the flag off keeps the declaration at boxing', () => {
    const ce = new ComputeEngine();
    const a = ce.parse('x + 1');
    expect(isFreeName(a.op1)).toBe(false);
    expect(ce.lookupDefinition('x')).toBeDefined();
    expect(ce.box('x').type.toString()).toBe('number');
  });
});

describe('BINDING UNITS: TYPES', () => {
  test('a new unit does not read the requirements of an earlier unit', () => {
    const ce = engine();
    ce.parse('x + 1');
    expect(ce.box('x').type.toString()).toBe('unknown');
  });

  test('an occurrence reads the requirements of its own unit', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    expect(a.op1.type.toString()).toBe('number');
  });

  test('two units keep their own requirements', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const b = ce.parse('x \\land y');
    expect(a.op1.type.toString()).toBe('number');
    expect(b.op1.type.toString()).toBe('boolean');
  });

  test('an explicit declaration made after the boxing is read', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce.declare('x', 'string');
    expect(a.op1.type.toString()).toBe('string');
  });

  test('an assignment whose type conflicts with the unit wins', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce.assign('x', ce.string('ab'));
    expect(a.op1.type.toString()).toBe('string');
  });

  test('an inferred definition is met with the requirement of the unit', () => {
    const ce = engine();
    ce.declare('x', 'unknown');
    const a = ce.parse('x + 1');
    expect(a.op1.type.toString()).toBe('number');
    // The definition is not narrowed by the boxing.
    expect(ce.box('x').type.toString()).toBe('unknown');
    expect(ce.lookupDefinition('x')).toBeDefined();
  });

  test('an occurrence reads a declaration of its name in a pushed scope', () => {
    const ce = engine();
    ce.declare('x', 'unknown');
    const a = ce.parse('x + 1');
    expect(a.op1.type.toString()).toBe('number');
    ce.pushScope();
    try {
      ce.declare('x', 'string');
      ce.assign('x', ce.string('ab'));
      expect(a.op1.type.toString()).toBe('string');
    } finally {
      ce.popScope();
    }
    expect(a.op1.type.toString()).toBe('number');
  });

  test('a free name does not read the variable of a binder', () => {
    const ce = engine();
    const a = ce.parse('k + 1');
    ce.function('Sum', [a, ['Limits', 'k', 1, 3]]);
    const k = a.op1;
    expect(isFreeName(k)).toBe(true);
    // The index of the `Sum` is an integer: the free name reads the
    // requirement of its unit, not the index.
    expect(k.type.toString()).toBe('number');
    expect(k.evaluate()).toBe(k);
    expect(a.evaluate().toString()).toBe('k + 1');
    // The `Sum` binds its own copy of the body to the index.
    expect(ce.function('Sum', [a, ['Limits', 'k', 1, 3]]).evaluate().json).toBe(
      9
    );
  });

  test('a fact that excludes the requirement of the unit reads the definition', () => {
    const ce = engine();
    const b = ce.parse('x \\land y');
    expect(b.op1.type.toString()).toBe('boolean');
    ce.assume(ce.parse('x > 0'));
    // The requirement `boolean` meets the facts of `x > 0` in `never`: the
    // occurrence reads the type of the definition.
    expect(b.op1.type.toString()).not.toBe('never');
    expect(b.op1.type.toString()).toBe(ce.box('x').type.toString());
  });

  test('a parameter of a function literal does not read a global of its name', () => {
    const ce = engine();
    ce.assign('x', ce.string('ab'));
    const f = ce.parse('x \\mapsto x + 1');
    // `["Function", ["Block", ["Add", "x", 1]], "x"]`
    const x = f.op1.op1.op1;
    expect(x.symbol).toBe('x');
    expect(x.type.toString()).toBe('number');
  });

  test('an outer declaration made by the boxing of a literal is not narrowed', () => {
    const ce = engine();
    // The free name `y` of the body is declared in the scope that the
    // literal is written in, with the type of its first use. That scope
    // existed before the boxing: the later uses write their requirement in
    // the environment of the unit, not on the declaration.
    const f = ce.parse('x \\mapsto (x + y) + \\binom{y}{2}');
    const def = ce.lookupDefinition('y')!;
    expect('value' in def && def.value.type.toString()).toBe('number');
    const ys: { type: { toString(): string } }[] = [];
    const walk = (e: typeof f): void => {
      if (e.symbol === 'y') ys.push(e);
      e.ops?.forEach(walk);
    };
    walk(f);
    expect(ys.length).toBe(2);
    for (const y of ys) expect(y.type.toString()).toBe('complex | infinity');
  });
});

describe('BINDING UNITS: EVALUATION', () => {
  test('a free name evaluates through a later assignment', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce.assign('x', 3);
    expect(a.evaluate().json).toEqual(4);
  });

  test('a free name reads an assignment in a pushed scope', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce.pushScope();
    try {
      ce.assign('x', 3);
      expect(a.evaluate().json).toEqual(4);
    } finally {
      ce.popScope();
    }
  });

  test('a free name declared with no value evaluates to itself', () => {
    const ce = engine();
    const x = ce.parse('x + 1').op1;
    ce.declare('x', 'unknown');
    expect(x.type.toString()).toBe('number');
    expect(x.evaluate()).toBe(x);
    expect(x.evaluate().type.toString()).toBe('number');
    expect(x.N()).toBe(x);
  });

  test('a free name declared with no value evaluates to itself, async', async () => {
    const ce = engine();
    const x = ce.parse('x + 1').op1;
    ce.declare('x', 'unknown');
    expect(await x.evaluateAsync()).toBe(x);
  });

  // Fails today (the result is 9). The read of the free name `n` in the
  // scope of the `Sum` resolves no definition, as it must
  // (`freeNameBindingInContext()` skips the index and the parameter). The
  // capture comes after the read: the big-operator fold substitutes the
  // index value into the evaluated term (`evaluateBigOpTerm()` and
  // `substituteBinderValues()`, `library/utils.ts`), and that substitution
  // replaces every occurrence with no definition, so also a free name.
  // `ce.box(['Apply', ce.parse('(n) \\mapsto a'), 5])` gives 6 the same way.
  test.failing('a free name in the value of a name does not read a binder', () => {
    const ce = engine();
    ce.assign('a', ce.parse('n + 1'));
    // The `n` of the value of `a` is read while the scope of the `Sum`
    // and the parameter of the function literal are current: it reads
    // neither the index nor the parameter (spec section 2, the capture row).
    const result = ce
      .box(['Apply', ce.parse('(n) \\mapsto \\sum_{n=1}^{3} a'), 5])
      .evaluate();
    expect(result.isSame(ce.parse('3n + 3'))).toBe(true);
  });

  test('a free name with no definition stays symbolic', () => {
    const ce = engine();
    const x = ce.parse('x + 1').op1;
    expect(x.evaluate()).toBe(x);
    expect(x.N()).toBe(x);
    expect(x.value).toBeUndefined();
  });
});

describe('BINDING UNITS: ENVIRONMENTS', () => {
  test('the symbols of one boxing share one environment', () => {
    const ce = engine();
    const a = ce.parse('x + y');
    const env = envOf(a.op1);
    expect(env).toBeDefined();
    expect(envOf(a.op2)).toBe(env);
    expect(envOf(ce.parse('x + 1').op1)).not.toBe(env);
  });

  test('the counter of an environment moves at a write', () => {
    const ce = engine();
    const a = ce.parse('x');
    const env = envOf(a)!;
    expect(env).toBeDefined();
    const before = env.counter;
    expect(a.type.toString()).toBe('unknown');
    ce.function('Add', [a, 1]);
    expect(env.counter).toBeGreaterThan(before);
    expect(a.type.toString()).toBe('number');
    // A write that changes nothing does not move the counter.
    const after = env.counter;
    ce.function('Add', [a, 2]);
    expect(env.counter).toBe(after);
  });

  test('an expression built from a boxed operand writes in its environment', () => {
    const ce = engine();
    const x = ce.parse('x \\land y').op1;
    expect(x.type.toString()).toBe('boolean');
    const w = ce.box('w');
    expect(w.type.toString()).toBe('unknown');
    ce.function('Add', [w, 1]);
    expect(w.type.toString()).toBe('number');
    // The other units do not change, and no name is declared.
    expect(ce.box('w').type.toString()).toBe('unknown');
    expect(x.type.toString()).toBe('boolean');
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });

  test('a built expression does not narrow an existing definition', () => {
    const ce = engine();
    ce.declare('v', 'unknown');
    const v = ce.box('v');
    expect(isFreeName(v)).toBe(false);
    ce.function('Add', [v, 1]);
    expect(v.type.toString()).toBe('number');
    expect(ce.box('v').type.toString()).toBe('unknown');
  });

  test('a call with a boxed operand takes the environment of that operand', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const b = ce.function('Add', [a, 'z']);
    const z = b.ops!.find((op) => op.symbol === 'z')!;
    expect(envOf(z)).toBe(envOf(a.op1));
  });

  test('a call whose operands are all raw is a unit', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const b = ce.function('Add', ['x', 2]);
    const x = b.ops!.find((op) => op.symbol === 'x')!;
    expect(envOf(x)).toBeDefined();
    expect(envOf(x)).not.toBe(envOf(a.op1));
  });

  test('a built expression does not narrow a definition of a popped scope', () => {
    const ce = engine();
    ce.pushScope();
    ce.declare('v', 'unknown');
    const def = ce.lookupDefinition('v')!;
    const v = ce.box('v');
    ce.popScope();
    ce.function('Add', [v, 1]);
    expect(v.type.toString()).toBe('number');
    expect('value' in def && def.value.type.toString()).toBe('unknown');
  });

  test('a built expression does not narrow a definition of a created scope', () => {
    const ce = engine();
    const scope = ce.createScope();
    ce.declare('v', 'unknown', scope);
    const def = scope.bindings.get('v')!;
    const v = ce.expr('v', { scope });
    ce.function('Add', [v, 1]);
    expect(v.type.toString()).toBe('number');
    expect('value' in def && def.value.type.toString()).toBe('unknown');
  });

  test('a call finds the environment of a symbol in a dictionary', () => {
    const ce = engine();
    const d = ce.box({ dict: { v: { sym: 'x' } } });
    const t = ce.function('Tuple', [d, ['Add', 'x', 1]]);
    const dx = d.values![0];
    const tx = t.op2.ops!.find((op) => op.symbol === 'x')!;
    expect(dx.symbol).toBe('x');
    expect(envOf(dx)).toBeDefined();
    expect(envOf(tx)).toBe(envOf(dx));
    expect(dx.type.toString()).toBe('number');
  });

  test('the search for an environment visits a shared operand once', () => {
    // A chain of 30 nodes, each with two references to the next one: a walk
    // with no record of the visited nodes reads 2^30 nodes.
    let reads = 0;
    let node: object = { _kind: 'number' };
    for (let i = 0; i < 30; i++) {
      const child = node;
      node = {
        _kind: 'function',
        get ops() {
          reads += 1;
          return [child, child];
        },
      };
    }
    expect(unitEnvironmentOfOperands([node])).toBeUndefined();
    expect(reads).toBe(30);
  });

  test('a rebuild removes the requirements of the discarded pass', () => {
    const ce = engine();
    const state = new EngineBoxingState<object>();
    const env = new UnitEnvironment();
    const scope = {};
    env.set(scope, 'a', ce.type('real'));
    env.setScalarUsesMap(scope, 'a', true);
    let pass = 0;
    state.withRootRepair(() => {
      pass += 1;
      state.setUnitEnvironment(env);
      state.noteUnitWrite(env);
      if (pass === 1) {
        env.set(scope, 'a', ce.type('integer'));
        env.setScalarUsesMap(scope, 'a', undefined);
        env.set(scope, 'b', ce.type('boolean'));
        // Ask for a rebuild of the root construction.
        state.noteDevolvedShadow(scope);
      } else env.set(scope, 'c', ce.type('string'));
      return pass;
    });
    expect(pass).toBe(2);
    expect(env.get(scope, 'a')?.toString()).toBe('real');
    expect(env.scalarUsesMap(scope, 'a')).toBe(true);
    expect(env.get(scope, 'b')).toBeUndefined();
    expect(env.get(scope, 'c')?.toString()).toBe('string');
    // The journal is closed when the root construction ends.
    env.set(scope, 'd', ce.type('real'));
    env.undoJournal();
    expect(env.get(scope, 'd')?.toString()).toBe('real');
  });

  test('an exception removes the requirements of the failed pass', () => {
    const ce = engine();
    let undos = 0;
    const state = new EngineBoxingState<object>(() => (undos += 1));
    const env = new UnitEnvironment();
    const scope = {};
    env.set(scope, 'a', ce.type('real'));
    expect(() =>
      state.withRootRepair(() => {
        state.setUnitEnvironment(env);
        state.noteUnitWrite(env);
        env.set(scope, 'a', ce.type('integer'));
        env.set(scope, 'b', ce.type('boolean'));
        throw new Error('failed pass');
      })
    ).toThrow('failed pass');
    expect(env.get(scope, 'a')?.toString()).toBe('real');
    expect(env.get(scope, 'b')).toBeUndefined();
    // A type entry was removed: the engine is told to widen its caches.
    expect(undos).toBe(1);
  });

  test('an exception removes the writes in the environments of two operands', () => {
    const ce = engine();
    let undos = 0;
    const state = new EngineBoxingState<object>(() => (undos += 1));
    // The environments of two operands boxed in two units, as in
    // `ce.function('Add', [ce.parse('x'), ce.parse('y')])`.
    const envX = new UnitEnvironment();
    const envY = new UnitEnvironment();
    const scope = {};
    envX.set(scope, 'x', ce.type('real'));
    envY.set(scope, 'y', ce.type('real'));
    expect(() =>
      state.withRootRepair(() => {
        state.setUnitEnvironment(envX);
        state.noteUnitWrite(envX);
        envX.set(scope, 'x', ce.type('integer'));
        state.noteUnitWrite(envY);
        envY.set(scope, 'y', ce.type('integer'));
        throw new Error('failed pass');
      })
    ).toThrow('failed pass');
    expect(envX.get(scope, 'x')?.toString()).toBe('real');
    expect(envY.get(scope, 'y')?.toString()).toBe('real');
    expect(undos).toBe(1);
    // The journals are closed when the root construction ends.
    envY.set(scope, 'y', ce.type('integer'));
    envY.undoJournal();
    expect(envY.get(scope, 'y')?.toString()).toBe('integer');
  });

  test('a rebuild removes the writes in an environment opened in a scoped frame', () => {
    const ce = engine();
    const state = new EngineBoxingState<object>();
    const envX = new UnitEnvironment();
    const envY = new UnitEnvironment();
    const scope = {};
    let scopedPasses = 0;
    state.withRootRepair(() => {
      state.noteUnitWrite(envX);
      envX.set(scope, 'x', ce.type('real'));
      state.withScopedRepair(scope, () => {
        scopedPasses += 1;
        state.noteUnitWrite(envX);
        state.noteUnitWrite(envY);
        if (scopedPasses === 1) {
          envX.set(scope, 'a', ce.type('boolean'));
          envY.set(scope, 'b', ce.type('boolean'));
          state.noteDevolvedShadow(scope);
        }
        return scopedPasses;
      });
      return 0;
    });
    expect(scopedPasses).toBe(2);
    expect(envX.get(scope, 'x')?.toString()).toBe('real');
    expect(envX.get(scope, 'a')).toBeUndefined();
    expect(envY.get(scope, 'b')).toBeUndefined();
  });

  test('the undo of the environment of a discarded pass does not widen the caches', () => {
    const ce = engine();
    let undos = 0;
    const state = new EngineBoxingState<object>(() => (undos += 1));
    const scope = {};
    let pass = 0;
    const envs: UnitEnvironment[] = [];
    state.withRootRepair(() => {
      pass += 1;
      const env = state.unitEnvironment()!;
      envs.push(env);
      state.noteUnitWrite(env);
      env.set(scope, 'x', ce.type('integer'));
      if (pass === 1) state.noteDevolvedShadow(scope);
      return pass;
    });
    expect(pass).toBe(2);
    // The second pass has an environment of its own.
    expect(envs[1]).not.toBe(envs[0]);
    expect(undos).toBe(0);
  });

  test('two operands from two units and a throwing pass: no requirement kept', () => {
    const ce = engine();
    const x = ce.parse('x');
    const y = ce.parse('y');
    const before = [envOf(x)!.counter, envOf(y)!.counter];
    const typeX = x.type.toString();
    const typeY = y.type.toString();
    expect(envOf(x)).not.toBe(envOf(y));
    expect(() =>
      ce._boxingState.withRootRepair(() => {
        ce.function('Add', [x, y]);
        throw new Error('failed pass');
      })
    ).toThrow('failed pass');
    expect(x.type.toString()).toBe(typeX);
    expect(y.type.toString()).toBe(typeY);
    expect([envOf(x)!.counter, envOf(y)!.counter]).not.toEqual(before);
  });

  test('a rebuild of a scoped frame removes only the writes of that frame', () => {
    const ce = engine();
    let undos = 0;
    const state = new EngineBoxingState<object>(() => (undos += 1));
    const env = new UnitEnvironment();
    const root = {};
    const scope = {};
    let rootPasses = 0;
    let scopedPasses = 0;
    state.withRootRepair(() => {
      rootPasses += 1;
      state.setUnitEnvironment(env);
      state.noteUnitWrite(env);
      env.set(root, 'a', ce.type('real'));
      state.withScopedRepair(scope, () => {
        scopedPasses += 1;
        if (scopedPasses === 1) {
          env.set(scope, 'b', ce.type('boolean'));
          state.noteDevolvedShadow(scope);
        } else env.set(scope, 'c', ce.type('string'));
        return scopedPasses;
      });
      return rootPasses;
    });
    expect(rootPasses).toBe(1);
    expect(scopedPasses).toBe(2);
    expect(env.get(root, 'a')?.toString()).toBe('real');
    expect(env.get(scope, 'b')).toBeUndefined();
    expect(env.get(scope, 'c')?.toString()).toBe('string');
    expect(undos).toBe(1);
  });

  test('an undo of the record of the uses only does not widen the caches', () => {
    const env = new UnitEnvironment();
    const scope = {};
    env.beginJournal();
    env.setScalarUsesMap(scope, 'a', true);
    const before = env.counter;
    expect(env.undoJournal()).toBe(false);
    expect(env.scalarUsesMap(scope, 'a')).toBeUndefined();
    expect(env.counter).toBeGreaterThan(before);
  });
});
