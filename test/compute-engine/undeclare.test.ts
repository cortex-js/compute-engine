import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * `ce.undeclare(name)` removes the binding of a name from the current scope,
 * whatever the binding holds. A host uses it to make a name free again, for
 * example a notebook that hides the names of a cell that has not run (Tycho
 * ledger row 378).
 *
 * A fresh engine is used per test, since a declaration lasts for the
 * engine's lifetime.
 */

function json(expr: { json: unknown }): string {
  return JSON.stringify(expr.json);
}

/** An engine with a pushed scope in which `f` is defined by two clauses:
 * `f(n: integer) = 1` and `f(s: string) = 2`. */
function twoClauseEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.pushScope();
  for (const clause of [
    ['Function', 1, ['Typed', 'n', "'integer'"]],
    ['Function', 2, ['Typed', 's', "'string'"]],
  ] as MathJsonExpression[])
    ce.box(['DefineFunction', 'f', clause]).evaluate();
  return ce;
}

describe('undeclare: each kind of binding', () => {
  test('a value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('x', 5);
    expect(json(ce.parse('x + 1').evaluate())).toBe('6');

    ce.undeclare('x');

    expect(json(ce.parse('x + 1').evaluate())).toBe('["Add","x",1]');
  });

  test('a function given with assign', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('f', ce.parse('x \\mapsto 2x'));
    expect(json(ce.parse('f(3)').evaluate())).toBe('6');

    ce.undeclare('f');

    expect(json(ce.parse('f(3)').evaluate())).toBe('["f",3]');
  });

  test('a function given with declare', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('f', {
      signature: '(number) -> number',
      evaluate: ([x]) => x.mul(ce.number(10)),
    });
    expect(json(ce.parse('f(3)').evaluate())).toBe('30');

    ce.undeclare('f');

    expect(json(ce.parse('f(3)').evaluate())).toBe('["f",3]');
  });

  test('a function defined by one clause', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.parse('f(n) := n + 10').evaluate();
    expect(json(ce.parse('f(2)').evaluate())).toBe('12');

    ce.undeclare('f');

    expect(json(ce.parse('f(2)').evaluate())).toBe('["f",2]');
  });

  test('a function defined by two clauses', () => {
    const ce = twoClauseEngine();
    expect(json(ce.expr(['f', 2]).evaluate())).toBe('1');
    expect(json(ce.expr(['f', "'a'"]).evaluate())).toBe('2');

    ce.undeclare('f');

    expect(json(ce.expr(['f', 2]).evaluate())).toBe('["f",2]');
    expect(ce.context.lexicalScope.bindings.has('f')).toBe(
      // Boxing `f(2)` declares `f` again, as an application head with no
      // definition.
      true
    );
    expect(ce.lookupDefinition('f')!.operator?.evaluate).toBeUndefined();
  });

  test('a scope made with createScope', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ w: 'real' });
    ce.pushScope(scope);
    ce.assign('w', 3);
    expect(json(ce.parse('2w').evaluate())).toBe('6');

    ce.undeclare('w');

    expect(scope.bindings.has('w')).toBe(false);
    expect(json(ce.parse('2w').evaluate())).toBe('["Multiply",2,"w"]');
    ce.popScope();
  });
});

describe('undeclare: scopes', () => {
  test('a declaration in an enclosing scope applies again', () => {
    const ce = new ComputeEngine();
    ce.parse('f(n) := n + 10').evaluate();
    ce.assign('y', 1);
    ce.pushScope();
    ce.declare('f', { evaluate: ce.parse('n \\mapsto n + 20') });
    ce.declare('y', { value: 2 });
    expect(json(ce.parse('f(1)').evaluate())).toBe('21');
    expect(json(ce.parse('y').evaluate())).toBe('2');

    ce.undeclare(['f', 'y']);

    expect(json(ce.parse('f(1)').evaluate())).toBe('11');
    expect(json(ce.parse('y').evaluate())).toBe('1');

    // The enclosing scope is not changed.
    ce.popScope();
    expect(json(ce.parse('f(1)').evaluate())).toBe('11');
    expect(json(ce.parse('y').evaluate())).toBe('1');
  });

  test('a name declared only in an enclosing scope is refused', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 1);
    ce.pushScope();
    expect(() => ce.undeclare('y')).toThrow(
      'Cannot undeclare "y": it is not declared in the current scope. Its declaration is in an enclosing scope'
    );
    expect(json(ce.parse('y').evaluate())).toBe('1');
  });

  test('the global scope', () => {
    const ce = new ComputeEngine();
    ce.parse('f(n) := n + 10').evaluate();
    ce.undeclare('f');
    expect(json(ce.parse('f(1)').evaluate())).toBe('["f",1]');
  });
});

describe('undeclare: refusals', () => {
  test('a name that is not declared', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    expect(() => ce.undeclare('zz')).toThrow(
      'Cannot undeclare "zz": it is not declared in the current scope'
    );
  });

  test('a name of the standard library', () => {
    const ce = new ComputeEngine();
    expect(() => ce.undeclare('Sin')).toThrow(
      'Cannot undeclare "Sin": it is defined by the library "trigonometry"'
    );
    ce.pushScope();
    expect(() => ce.undeclare('Pi')).toThrow(
      'Cannot undeclare "Pi": it is defined by the library'
    );
    expect(json(ce.parse('\\sin(0)').evaluate())).toBe('0');
  });

  test('a name of a library loaded with loadLibrary', () => {
    const ce = new ComputeEngine();
    ce.loadLibrary({
      name: 'residues',
      requires: ['arithmetic'],
      definitions: {
        Sq: { evaluate: ['Function', ['Multiply', 'x', 'x'], 'x'] },
      },
    });
    expect(() => ce.undeclare('Sq')).toThrow(
      'Cannot undeclare "Sq": it is defined by the library "residues"'
    );
    expect(json(ce.box(['Sq', 3]).evaluate())).toBe('9');
  });

  test('the variable of a Sum, and a function parameter, while they are evaluated', () => {
    const ce = new ComputeEngine();
    const messages: string[] = [];
    ce.declare('Probe', {
      signature: '(any, string) -> integer',
      evaluate: (ops) => {
        try {
          ce.undeclare(ops[1].string!);
          messages.push('accepted');
        } catch (e) {
          messages.push((e as Error).message);
        }
        return ce.number(1);
      },
    });
    expect(
      json(
        ce.box(['Sum', ['Probe', 'k', "'k'"], ['Limits', 'k', 1, 2]]).evaluate()
      )
    ).toBe('2');
    ce.assign(
      'h',
      ce.box(['Function', ['Add', ['Probe', 'x', "'x'"], 'x'], 'x'])
    );
    expect(json(ce.parse('h(2)').evaluate())).toBe('3');
    expect(messages).toEqual([
      'Cannot undeclare "k": it is a variable of an operator such as `Sum`, or a parameter of a function, and it is bound only while that expression is evaluated',
      'Cannot undeclare "k": it is a variable of an operator such as `Sum`, or a parameter of a function, and it is bound only while that expression is evaluated',
      'Cannot undeclare "x": it is a variable of an operator such as `Sum`, or a parameter of a function, and it is bound only while that expression is evaluated',
    ]);
  });

  test('a list with one refused name removes nothing', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('y', 1);
    expect(() => ce.undeclare(['y', 'nope'])).toThrow(
      'Cannot undeclare "nope": it is not declared in the current scope'
    );
    expect(json(ce.parse('y').evaluate())).toBe('1');
  });
});

describe('undeclare: a list of names', () => {
  test('removes each binding', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('a', 1);
    ce.assign('b', 2);
    ce.parse('f(n) := n + 10').evaluate();

    ce.undeclare(['a', 'b', 'f', 'a']);

    expect(json(ce.parse('a + b + f(1)').evaluate())).toBe(
      '["Add","a","b",["f",1]]'
    );
  });
});

describe('undeclare: a new declaration of the name is accepted', () => {
  test('declare', () => {
    const ce = twoClauseEngine();
    ce.undeclare('f');
    ce.declare('f', {
      signature: '(number) -> number',
      evaluate: ([x]) => x.mul(ce.number(10)),
    });
    expect(json(ce.expr(['f', 2]).evaluate())).toBe('20');
  });

  test('declare a value with a type', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('x', 5);
    ce.undeclare('x');
    ce.declare('x', 'integer');
    expect(ce.parse('x').type.toString()).toBe('integer');
    expect(json(ce.parse('x + 1').evaluate())).toBe('["Add","x",1]');
  });

  test('assign', () => {
    const ce = twoClauseEngine();
    ce.undeclare('f');
    ce.assign('f', ce.parse('x \\mapsto x + 100'));
    expect(json(ce.expr(['f', 2]).evaluate())).toBe('102');
  });

  test('f(x) := … parsed', () => {
    const ce = twoClauseEngine();
    ce.undeclare('f');
    ce.parse('f(x) := 3x').evaluate();
    expect(json(ce.expr(['f', 2]).evaluate())).toBe('6');
  });

  test('DefineFunction boxed', () => {
    const ce = twoClauseEngine();
    ce.undeclare('f');
    const def = ce
      .box(['DefineFunction', 'f', ['Function', 3, 'x']])
      .evaluate();
    expect(def.isValid).toBe(true);
    expect(json(ce.expr(['f', 2]).evaluate())).toBe('3');
    // The new definition has one clause: the old string clause is gone.
    expect(json(ce.expr(['f', "'a'"]).evaluate())).toBe('3');
  });
});

describe('undeclare: an expression boxed before the call', () => {
  // The removed binding record is kept by an expression boxed before the
  // call, but it holds no definition after it. The call then reads `f` as a
  // call boxed now does: unevaluated, and the new definition after a new
  // declaration in the same scope.
  test('a call no longer reads the removed clauses', () => {
    const ce = twoClauseEngine();
    const g = ce.expr(['f', 2]);
    const sum = ce.parse('f(2) + 1');
    expect(json(g.evaluate())).toBe('1');
    expect(g.type.toString()).toBe('integer');
    expect(json(sum.evaluate())).toBe('2');

    ce.undeclare('f');

    expect(json(g.evaluate())).toBe('["f",2]');
    expect(g.type.toString()).toBe('unknown');
    expect(json(sum.evaluate())).toBe('["Add",1,["f",2]]');
  });

  test('a call reads a new definition made in the same scope', () => {
    const ce = twoClauseEngine();
    const g = ce.expr(['f', 2]);
    expect(json(g.evaluate())).toBe('1');

    ce.undeclare('f');
    ce.box(['DefineFunction', 'f', ['Function', 3, 'x']]).evaluate();

    expect(json(g.evaluate())).toBe('3');
  });

  test('a call reads the definition of an enclosing scope', () => {
    const ce = new ComputeEngine();
    ce.parse('f(n) := n + 10').evaluate();
    ce.pushScope();
    ce.declare('f', { evaluate: ce.parse('n \\mapsto n + 20') });
    const g = ce.parse('f(1)');
    expect(json(g.evaluate())).toBe('21');

    ce.undeclare('f');

    expect(json(g.evaluate())).toBe('11');
  });

  test('a symbol no longer reads the removed value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('x', 5);
    const h = ce.parse('x + 1');
    expect(json(h.evaluate())).toBe('6');

    ce.undeclare('x');
    expect(json(h.evaluate())).toBe('["Add","x",1]');

    ce.assign('x', 7);
    expect(json(h.evaluate())).toBe('8');
  });
});

describe('undeclare: a sequence', () => {
  test('the name is no longer a sequence', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    expect(ce.isSequence('F')).toBe(true);
    expect(ce.parse('F_{10}').evaluate().json).toBe(55);

    ce.undeclare('F');

    expect(ce.isSequence('F')).toBe(false);
    expect(ce.listSequences()).not.toContain('F');
    expect(ce.getSequence('F')).toBeUndefined();
    expect(json(ce.parse('F_{10}').evaluate())).toBe('"F_10"');
  });

  // `F_0 := 10` without a recurrence is a pending sequence definition. It
  // is removed with the binding, so a later declaration of `F` that gives
  // only the recurrence does not complete a sequence with the base case of
  // the removed declaration.
  test('a pending base case is removed', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('F', 'unknown');
    ce.parse('F_0 := 10').evaluate();
    expect(ce.getSequenceStatus('F').status).toBe('pending');

    ce.undeclare('F');

    expect(ce.getSequenceStatus('F').status).toBe('not-a-sequence');

    ce.declare('F', 'unknown');
    ce.parse('F_n := F_{n-1} + 1').evaluate();
    const status = ce.getSequenceStatus('F');
    expect(status.status).toBe('pending');
    expect(status.hasBase).toBe(false);
    expect(ce.isSequence('F')).toBe(false);
    expect(json(ce.parse('F_{3}').evaluate())).toBe('"F_3"');
  });

  test('a checkpoint restore puts the pending base case back', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('F', 'unknown');
    ce.parse('F_0 := 10').evaluate();
    const cp = ce.checkpoint();

    ce.undeclare('F');
    expect(ce.getSequenceStatus('F').status).toBe('not-a-sequence');

    ce.restore(cp);

    const status = ce.getSequenceStatus('F');
    expect(status.status).toBe('pending');
    expect(status.baseIndices).toEqual([0]);
    ce.parse('F_n := F_{n-1} + 1').evaluate();
    expect(ce.isSequence('F')).toBe(true);
    expect(ce.parse('F_{3}').evaluate().json).toBe(13);
  });

  // The pending definitions are kept by name, but each one belongs to the
  // binding of the scope where it was made. Undeclaring a declaration of
  // `F` in a child scope does not remove the pending base case of the `F`
  // of the enclosing scope.
  test('a shadowing declaration does not remove the pending base case of the enclosing scope', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('F', 'unknown');
    ce.parse('F_0 := 10').evaluate();

    ce.pushScope();
    ce.declare('F', 'unknown');
    ce.undeclare('F');
    ce.popScope();

    const status = ce.getSequenceStatus('F');
    expect(status.status).toBe('pending');
    expect(status.baseIndices).toEqual([0]);
    ce.parse('F_n := F_{n-1} + 1').evaluate();
    expect(ce.isSequence('F')).toBe(true);
    expect(ce.parse('F_{3}').evaluate().json).toBe(13);
  });
});

/** The number of listeners in the configuration-change tracker of `ce`.
 * The tracker is private: it is read here only to show that a removed
 * constant stops listening. */
function configurationListenerCount(ce: ComputeEngine): number {
  return (
    ce as unknown as {
      _configurationLifecycle: { _tracker: { _listeners: unknown[] } };
    }
  )._configurationLifecycle._tracker._listeners.length;
}

// A constant listens to configuration changes, because its value can
// depend on the precision. The value `ce.precision` makes that visible.
describe('undeclare: a constant', () => {
  test('the removed constant stops listening to configuration changes', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const before = configurationListenerCount(ce);
    ce.declare('k', {
      isConstant: true,
      value: (engine) => engine.number(engine.precision),
    });
    expect(configurationListenerCount(ce)).toBe(before + 1);

    ce.undeclare('k');

    expect(configurationListenerCount(ce)).toBe(before);
  });

  test('after a checkpoint restore, the constant listens again', () => {
    const ce = new ComputeEngine();
    const precision = ce.precision;
    ce.pushScope();
    ce.declare('k', {
      isConstant: true,
      value: (engine) => engine.number(engine.precision),
    });
    expect(ce.parse('k').evaluate().json).toBe(precision);
    const count = configurationListenerCount(ce);
    const cp = ce.checkpoint();

    ce.undeclare('k');
    expect(configurationListenerCount(ce)).toBe(count - 1);

    ce.restore(cp);
    expect(configurationListenerCount(ce)).toBe(count);
    expect(ce.parse('k').evaluate().json).toBe(precision);

    ce.precision = precision + 10;
    expect(ce.parse('k').evaluate().json).toBe(precision + 10);
  });

  // A sequence definition for the name of a constant (`F_0 := …` then
  // `F_n := …`) is refused, with the error that `ce.assign()` gives. The
  // binding keeps its value definition, so the constant keeps listening and
  // its value still follows the precision.
  test('a refused sequence definition leaves the constant listening', () => {
    const ce = new ComputeEngine();
    const precision = ce.precision;
    ce.pushScope();
    const before = configurationListenerCount(ce);
    ce.declare('F', {
      isConstant: true,
      value: (engine) => engine.number(engine.precision),
    });
    expect(configurationListenerCount(ce)).toBe(before + 1);

    expect(() => ce.parse('F_0 := 1').evaluate()).toThrow(
      'Cannot assign a value to the constant "F"'
    );
    expect(() => ce.parse('F_n := F_{n-1} + 1').evaluate()).toThrow(
      'Cannot assign a value to the constant "F"'
    );

    expect(configurationListenerCount(ce)).toBe(before + 1);
    ce.precision = precision + 10;
    expect(ce.parse('F').evaluate().json).toBe(precision + 10);
  });

  test('after a checkpoint restore, the constant still listens', () => {
    const ce = new ComputeEngine();
    const precision = ce.precision;
    ce.pushScope();
    ce.declare('F', {
      isConstant: true,
      value: (engine) => engine.number(engine.precision),
    });
    expect(ce.parse('F').evaluate().json).toBe(precision);
    const count = configurationListenerCount(ce);
    const cp = ce.checkpoint();

    expect(() => ce.parse('F_0 := 1').evaluate()).toThrow(
      'Cannot assign a value to the constant "F"'
    );
    expect(configurationListenerCount(ce)).toBe(count);

    ce.restore(cp);
    expect(configurationListenerCount(ce)).toBe(count);
    expect(ce.parse('F').evaluate().json).toBe(precision);

    ce.precision = precision + 10;
    expect(ce.parse('F').evaluate().json).toBe(precision + 10);
  });
});

describe('undeclare: checkpoints and assumptions', () => {
  test('a checkpoint restore puts the binding back', () => {
    const ce = twoClauseEngine();
    const g = ce.expr(['f', 2]);
    const cp = ce.checkpoint();

    ce.undeclare('f');
    expect(json(ce.expr(['f', 2]).evaluate())).toBe('["f",2]');

    ce.restore(cp);
    expect(json(ce.expr(['f', 2]).evaluate())).toBe('1');
    expect(json(ce.expr(['f', "'a'"]).evaluate())).toBe('2');
    expect(json(g.evaluate())).toBe('1');
  });

  // Assumptions are found by the name of the symbol, as for a declaration
  // in a scope under the one that made the assumption: `undeclare()`
  // removes the binding, and `forget()` removes the assumptions.
  test('an assumption about the name stays until forget()', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 0'));

    ce.undeclare('x');
    ce.declare('x', 'real');
    expect(json(ce.parse('x > 0').evaluate())).toBe('"True"');

    ce.forget('x');
    expect(json(ce.parse('x > 0').evaluate())).toBe('["Less",0,"x"]');
  });
});

describe('a constant keeps its type through the type setter', () => {
  test('a signature type on a constant is refused like a value type', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { type: 'integer', value: 3, isConstant: true });
    expect(() => {
      ce.symbol('k').type = 'real';
    }).toThrow('The type of the constant "k" cannot be changed');
    expect(() => {
      ce.symbol('k').type = '(integer) -> integer';
    }).toThrow('The type of the constant "k" cannot be changed');
    expect(() => {
      ce.symbol('k').type = 'function';
    }).toThrow('The type of the constant "k" cannot be changed');
    // The constant is still a value, and still refuses an assignment.
    expect(() => ce.box(['Assign', 'k', 5]).evaluate()).toThrow(
      'Cannot assign a value to the constant "k"'
    );
    expect(ce.symbol('k').evaluate().json).toEqual(3);
  });
});
