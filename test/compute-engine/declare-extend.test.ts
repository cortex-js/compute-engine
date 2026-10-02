import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `ce.declare(name, patch, { extend: true })` — issue #394.
 *
 * Extend mode builds a NEW definition from the operator definition visible
 * for `name` and the fields of `patch`, and installs it in the target scope.
 * A field the patch does not name keeps its value; `signature` replaces the
 * signature, `addSignature` adds an overload (`old & new`). The new signature
 * must be a subtype of the old one. A fresh engine is used per test, since a
 * declaration lasts for the engine's lifetime.
 */

describe('declare extend: the SetMinus example of the issue', () => {
  test('a wider signature keeps evaluate, collection and description', () => {
    const ce = new ComputeEngine();
    const before = ce.lookupDefinition('SetMinus')!.operator!;
    expect(ce.box(['SetMinus', 5, 2]).isValid).toBe(false);

    ce.declare(
      'SetMinus',
      { signature: '(value, value*) -> set' },
      { extend: true }
    );

    const after = ce.lookupDefinition('SetMinus')!.operator!;
    expect(after).not.toBe(before);
    expect(after.signature.toString()).toBe('(value, value*) -> set');
    expect(after.description).toEqual(before.description);
    expect(after.wikidata).toEqual(before.wikidata);
    expect(after.evaluate).toBe(before.evaluate);
    expect(after.canonical).toBe(before.canonical);

    // The wider signature is the one calls validate against
    expect(ce.box(['SetMinus', 5, 2]).isValid).toBe(true);

    // `evaluate` and `collection` are still there
    const diff = ce.box(['SetMinus', ['Set', 1, 2, 3], ['Set', 2]]);
    expect(diff.evaluate().json).toEqual(['Set', 1, 3]);
    expect(diff.isCollection).toBe(true);
  });

  test('the old definition object is not mutated', () => {
    const ce = new ComputeEngine();
    const before = ce.lookupDefinition('SetMinus')!.operator!;
    const oldSignature = before.signature.toString();
    ce.declare(
      'SetMinus',
      { signature: '(value, value*) -> set' },
      { extend: true }
    );
    expect(before.signature.toString()).toBe(oldSignature);
  });

  test('an expression boxed before the extension keeps the old definition', () => {
    const ce = new ComputeEngine();
    const diff = ce.box(['SetMinus', ['Set', 1, 2, 3], ['Set', 2]]);
    const before = diff.operatorDefinition;
    ce.declare(
      'SetMinus',
      { signature: '(value, value*) -> set' },
      { extend: true }
    );
    expect(diff.operatorDefinition).toBe(before);
    expect(diff.evaluate().json).toEqual(['Set', 1, 3]);
    expect(diff.isCollection).toBe(true);
    // A new boxing uses the new definition
    expect(
      ce.box(['SetMinus', ['Set', 1, 2, 3], ['Set', 2]]).operatorDefinition
    ).toBe(ce.lookupDefinition('SetMinus')!.operator);
  });

  test('a plain redeclaration still replaces the whole definition', () => {
    // The behavior the issue reports, unchanged without `extend`.
    const ce = new ComputeEngine();
    ce.declare('SetMinus', { signature: '(value, value*) -> set' });
    expect(ce.lookupDefinition('SetMinus')!.operator!.evaluate).toBeUndefined();
  });
});

describe('declare extend: names declared by a library', () => {
  test('two extensions of the same name both succeed (the Basis example)', () => {
    const ce = new ComputeEngine();
    ce.declare('Basis', { signature: '(any) -> any', description: 'first' });

    // A plain redeclaration in the same scope still throws
    expect(() => ce.declare('Basis', { signature: '(any) -> any' })).toThrow(
      /already declared in this scope/
    );

    ce.declare(
      'Basis',
      { evaluate: (_ops, { engine }) => engine.number(42) },
      { extend: true }
    );
    ce.declare('Basis', { keywords: ['basis'] }, { extend: true });

    const def = ce.lookupDefinition('Basis')!.operator!;
    // The second extension sees the fields of the first one
    expect(def.description).toEqual('first');
    expect(def.keywords).toEqual(['basis']);
    expect(def.signature.toString()).toBe('(any) -> any');
    expect(ce.box(['Basis', 1]).evaluate().toString()).toBe('42');
  });

  test('the later handler wins', () => {
    const ce = new ComputeEngine();
    ce.declare('Twice', {
      signature: '(number) -> number',
      evaluate: (ops, { engine }) => engine.number(1),
    });
    ce.declare(
      'Twice',
      { evaluate: (ops, { engine }) => engine.number(2) },
      { extend: true }
    );
    expect(ce.box(['Twice', 5]).evaluate().toString()).toBe('2');
    ce.declare(
      'Twice',
      { evaluate: (ops, { engine }) => engine.number(3) },
      { extend: true }
    );
    expect(ce.box(['Twice', 5]).evaluate().toString()).toBe('3');
  });

  test('addSignature adds an overload', () => {
    const ce = new ComputeEngine();
    ce.declare('Basis', {
      signature: '(integer) -> integer',
      evaluate: (ops, { engine }) => engine.number(ops.length),
    });
    expect(ce.box(['Basis', 1, 2]).isValid).toBe(false);

    ce.declare(
      'Basis',
      { addSignature: '(string, string) -> string' },
      { extend: true }
    );
    const def = ce.lookupDefinition('Basis')!.operator!;
    expect(def.signature.toString()).toBe(
      '((integer) -> integer) & ((string, string) -> string)'
    );
    expect(ce.box(['Basis', 1]).isValid).toBe(true);
    expect(ce.box(['Basis', 1]).type.toString()).toBe('integer');
    expect(ce.box(['Basis', { str: 'a' }, { str: 'b' }]).isValid).toBe(true);
    expect(ce.box(['Basis', { str: 'a' }, { str: 'b' }]).type.toString()).toBe(
      'string'
    );
    expect(ce.box(['Basis', 1, 2]).isValid).toBe(false);
    // The handler is kept
    expect(ce.box(['Basis', 7]).evaluate().toString()).toBe('1');

    // A third overload extends the overload set, without nesting it
    ce.declare('Basis', { addSignature: '() -> boolean' }, { extend: true });
    expect(ce.lookupDefinition('Basis')!.operator!.signature.toString()).toBe(
      '((integer) -> integer) & ((string, string) -> string) & (() -> boolean)'
    );
  });

  test('signature and addSignature together are refused', () => {
    const ce = new ComputeEngine();
    ce.declare('Basis', { signature: '(integer) -> integer' });
    expect(() =>
      ce.declare(
        'Basis',
        {
          signature: '(number) -> integer',
          addSignature: '(string) -> string',
        },
        { extend: true }
      )
    ).toThrow(/either `signature` or `addSignature`/);
  });
});

describe('declare extend: the subtype rule', () => {
  test('a signature that is not a subtype is refused, and nothing is installed', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', { signature: '(value+) -> value' });
    const before = ce.lookupDefinition('Q')!.operator!;
    expect(() =>
      ce.declare('Q', { signature: '(any*) -> any' }, { extend: true })
    ).toThrow(/is not a subtype of the current signature "\(value\+\) -> value"/);
    expect(ce.lookupDefinition('Q')!.operator).toBe(before);
  });

  test('a narrower parameter is refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare(
        'SetMinus',
        { signature: '(set<integer>, value*) -> set' },
        { extend: true }
      )
    ).toThrow(/is not a subtype/);
    expect(ce.box(['SetMinus', ['Set', 1, 2, 3], ['Set', 2]]).isValid).toBe(
      true
    );
  });

  test('a narrower result is accepted', () => {
    const ce = new ComputeEngine();
    ce.declare('R', { signature: '(number) -> number' });
    ce.declare('R', { signature: '(number) -> integer' }, { extend: true });
    expect(ce.lookupDefinition('R')!.operator!.signature.toString()).toBe(
      '(number) -> integer'
    );
  });

  test('an overload whose arm is invalid is refused', () => {
    // `old & new` is always a subtype of `old`, but the arms must still be
    // distinguishable.
    const ce = new ComputeEngine();
    ce.declare('R', { signature: '(number) -> number' });
    expect(() =>
      ce.declare(
        'R',
        { addSignature: '(number) random -> number' },
        { extend: true }
      )
    ).toThrow(/differ only by their effects/);
    // The failed extension leaves the extended definition in place
    expect(ce.lookupDefinition('R')!.operator!.signature.toString()).toBe(
      '(number) -> number'
    );
  });

  test('a plain declaration that fails leaves no placeholder binding', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('S', {
        signature: '(number) -> number',
        commutative: true,
        canonical: () => null,
      })
    ).toThrow(/incompatible/);
    expect(ce.lookupDefinition('S')).toBeUndefined();
  });
});

describe('declare extend: errors', () => {
  test('a name with no definition', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('NotDeclared', { description: 'x' }, { extend: true })
    ).toThrow(/Cannot extend "NotDeclared": it has no definition to extend/);
  });

  test('a value definition', () => {
    const ce = new ComputeEngine();
    ce.declare('v', { value: 5 });
    expect(() =>
      ce.declare('v', { description: 'x' } as any, { extend: true })
    ).toThrow(/declared as a value/);
    expect(ce.box('v').evaluate().toString()).toBe('5');
  });

  test('a type instead of a patch', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('SetMinus', '(value, value*) -> set' as any, {
        extend: true,
      })
    ).toThrow(/must be an object/);
  });

  test('a misspelled field is still refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('SetMinus', { evaluete: () => undefined } as any, {
        extend: true,
      })
    ).toThrow(/evaluete/);
  });

  test('a function defined by clauses', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DefineFunction',
      'fact',
      ['Function', 1, ['Typed', 'z', { str: '0' }]],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'fact',
      [
        'Function',
        ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ]).evaluate();
    expect(ce.box(['fact', 5]).evaluate().toString()).toBe('120');
    expect(
      (ce.lookupDefinition('fact')!.operator as any)._isMultiClause
    ).toBe(true);
    expect(() =>
      ce.declare('fact', { description: 'x' }, { extend: true })
    ).toThrow(/defined by clauses/);
  });
});

describe('declare extend: user functions', () => {
  test('a function assigned from a literal stays a user function', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^2'));
    ce.declare('f', { description: 'square' }, { extend: true });
    const def = ce.lookupDefinition('f')!.operator!;
    expect(def.description).toBe('square');
    expect(def.lambda).toBeDefined();
    expect(ce.parse('f(3)').evaluate().toString()).toBe('9');
    // Broadcasting over a list, as for any user function
    expect(ce.parse('f([1, 2, 3])').evaluate().toString()).toBe('[1,4,9]');
  });

  test('a function defined with := and a wider declared signature', () => {
    const ce = new ComputeEngine();
    ce.declare('h', {
      signature: '(integer) -> number',
      evaluate: ce.parse('x \\mapsto 2x'),
    });
    expect(ce.box(['h', 1.5]).isValid).toBe(false);
    ce.declare('h', { signature: '(number) -> number' }, { extend: true });
    expect(ce.box(['h', 1.5]).isValid).toBe(true);
    expect(ce.box(['h', 1.5]).evaluate().toString()).toBe('3');
    expect(ce.lookupDefinition('h')!.operator!.lambda).toBeDefined();
  });

  test('an impure user function stays impure when its signature changes', () => {
    const ce = new ComputeEngine();
    ce.declare('Noise', {
      signature: '(number) -> number',
      pure: false,
      evaluate: (ops, { engine }) => engine.number(1),
    });
    expect(ce.lookupDefinition('Noise')!.operator!.pure).toBe(false);
    ce.declare('Noise', { signature: '(value) -> number' }, { extend: true });
    expect(ce.lookupDefinition('Noise')!.operator!.pure).toBe(false);
  });

  test('a built-in drawing operator keeps its effects', () => {
    const ce = new ComputeEngine();
    const before = ce.lookupDefinition('Random')!.operator!;
    expect(before.drawsRandom).toBe(true);
    ce.declare('Random', { description: 'random' }, { extend: true });
    expect(ce.lookupDefinition('Random')!.operator!.drawsRandom).toBe(true);
  });
});

describe('declare extend: a collection operator', () => {
  test('Union keeps its collection handlers', () => {
    const ce = new ComputeEngine();
    ce.declare('Union', { description: 'set union' }, { extend: true });
    const u = ce.box(['Union', ['Set', 1, 2], ['Set', 2, 3]]);
    expect(u.isCollection).toBe(true);
    expect(u.evaluate().json).toEqual(['Set', 1, 2, 3]);
    expect(ce.lookupDefinition('Union')!.operator!.description).toBe(
      'set union'
    );
  });
});

describe('declare extend: scopes and checkpoints', () => {
  test('an extension in a child scope shadows, and pop restores', () => {
    const ce = new ComputeEngine();
    const before = ce.lookupDefinition('SetMinus')!.operator!;
    ce.pushScope();
    ce.declare(
      'SetMinus',
      { signature: '(value, value*) -> set' },
      { extend: true }
    );
    expect(ce.box(['SetMinus', 5, 2]).isValid).toBe(true);
    ce.popScope();
    expect(ce.lookupDefinition('SetMinus')!.operator).toBe(before);
    expect(ce.box(['SetMinus', 5, 2]).isValid).toBe(false);
  });

  test('the `scope` option selects the target scope', () => {
    const ce = new ComputeEngine();
    const outer = ce.context.lexicalScope;
    ce.declare('Basis', { signature: '(any) -> any' });
    ce.pushScope();
    ce.declare(
      'Basis',
      { description: 'outer' },
      { extend: true, scope: outer }
    );
    ce.popScope();
    expect(ce.lookupDefinition('Basis')!.operator!.description).toBe('outer');
  });

  test('a scope as the third argument still works', () => {
    const ce = new ComputeEngine();
    ce.declare('n9', 'integer', ce.context.lexicalScope);
    ce.declare('n10', 'integer', { scope: ce.context.lexicalScope });
    expect(ce.box('n9').type.toString()).toBe('integer');
    expect(ce.box('n10').type.toString()).toBe('integer');
  });

  test('a checkpoint restore undoes an extension', () => {
    const ce = new ComputeEngine();
    ce.declare('Basis', { signature: '(any) -> any', description: 'first' });
    const before = ce.lookupDefinition('Basis')!.operator!;
    const cp = ce.checkpoint();
    ce.declare('Basis', { description: 'second' }, { extend: true });
    expect(ce.lookupDefinition('Basis')!.operator!.description).toBe('second');
    ce.restore(cp);
    expect(ce.lookupDefinition('Basis')!.operator).toBe(before);
    expect(ce.lookupDefinition('Basis')!.operator!.description).toBe('first');
  });

  test('a checkpoint restore undoes an extension of a built-in', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.declare(
      'SetMinus',
      { signature: '(value, value*) -> set' },
      { extend: true }
    );
    expect(ce.box(['SetMinus', 5, 2]).isValid).toBe(true);
    ce.restore(cp);
    expect(ce.box(['SetMinus', 5, 2]).isValid).toBe(false);
  });
});

describe('declare extend: a standard-library operator stays a library operator', () => {
  // `D`, compilation and the canonical folds read a library operator by its
  // name, and treat a user definition with the same name as a shadow
  // (`shadowsLibraryName`, `library-shadowing.ts`). An extension that keeps
  // the library's `evaluate`, `canonical`, `compile` and `derivative` is not
  // a shadow.
  test('Sin extended with a description', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.declare('Sin', { description: 'the sine' }, { extend: true });
    expect(ce.lookupDefinition('Sin')!.operator!.description).toBe(
      'the sine'
    );
    expect(ce.box(['D', ['Sin', 'x'], 'x']).evaluate().toString()).toBe(
      'cos(x)'
    );
    const f = compile(ce.box(['Sin', 'y']));
    expect(f.success).toBe(true);
    expect(f.run!({ y: 1 })).toBeCloseTo(Math.sin(1), 12);
    expect(ce.parse('\\sin(\\pi/6)').evaluate().toString()).toBe('1/2');
  });

  test('a second extension of the extension is still the library operator', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', { description: 'the sine' }, { extend: true });
    ce.declare('Sin', { keywords: ['sine'] }, { extend: true });
    expect(ce.box(['D', ['Sin', 'x'], 'x']).evaluate().toString()).toBe(
      'cos(x)'
    );
  });

  test('Sin extended with a new evaluate handler is a user definition', () => {
    // The new handler replaces a part that `D` and the compiler read from
    // the library, so the extension shadows the library name, as a plain
    // `ce.declare('Sin', …)` does: `D` differentiates what the handler
    // gives (the constant 7), and compilation falls back to the interpreter.
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.declare(
      'Sin',
      { evaluate: (_ops, { engine }) => engine.number(7) },
      { extend: true }
    );
    expect(ce.box(['Sin', 1]).evaluate().toString()).toBe('7');
    expect(ce.box(['D', ['Sin', 'x'], 'x']).evaluate().toString()).toBe('0');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const f = compile(ce.box(['Sin', 'y']));
      expect(f.success).toBe(false);
      expect(f.run!({ y: 1 })).toBe(7);
    } finally {
      warn.mockRestore();
    }
    // A later extension that keeps the handler is still a user definition
    ce.declare('Sin', { description: 'seven' }, { extend: true });
    expect(ce.box(['D', ['Sin', 'x'], 'x']).evaluate().toString()).toBe('0');
  });
});

describe('declare extend: derived effects and signatures stay derived', () => {
  test('the effects of a user function are inferred again after an extension', () => {
    // `h` calls `g`, which is not declared yet: its effects are inferred as
    // `any`. When a pure `g` is declared, they are inferred again.
    for (const extend of [false, true]) {
      const ce = new ComputeEngine();
      ce.parse('h(x) := g(x)').evaluate();
      if (extend) ce.declare('h', { description: 'h' }, { extend: true });
      expect(ce.lookupDefinition('h')!.operator!.effectsDeclared).toBe(false);
      ce.declare('g', {
        signature: '(number) -> number',
        evaluate: (_ops, { engine }) => engine.number(1),
      });
      const def = ce.lookupDefinition('h')!.operator!;
      expect(def.pure).toBe(true);
      expect(def.effectsDeclared).toBe(false);
    }
  });

  test('a user function that draws keeps drawing, with inferred effects', () => {
    const ce = new ComputeEngine();
    ce.parse('r(x) := x + \\operatorname{Random}()').evaluate();
    ce.declare('r', { description: 'r' }, { extend: true });
    const def = ce.lookupDefinition('r')!.operator!;
    expect(def.effectsDeclared).toBe(false);
    expect(def.drawsRandom).toBe(true);
    expect(def.pure).toBe(false);
  });

  test('a protocol dispatcher keeps deriving its effects', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Speaker', {
      functions: { speak: '(self: Self) -> string' },
    });
    ce.declare('speak', { description: 'speak' }, { extend: true });
    const def = ce.lookupDefinition('speak')!.operator!;
    expect(def.description).toBe('speak');
    expect(def.pure).toBe(true);
    // A conformance whose implementation draws widens the dispatcher's
    // effect set
    ce.box([
      'DeclareConformance',
      { str: 'number' },
      ['List', 'Speaker'],
      [
        'Dictionary',
        [
          'KeyValuePair',
          'speak',
          [
            'Function',
            [
              'Typed',
              ['Block', ['Random'], { str: 'r' }],
              { str: '(self: Self) -> string' },
            ],
            ['Typed', 'self', { str: 'Self' }],
          ],
        ],
      ],
    ] as any).evaluate();
    expect(def.effects).toEqual(['random']);
    expect(def.pure).toBe(false);
  });

  test('a user function with `unknown` parameter slots still refines its signature', () => {
    // The declared signature `(unknown) -> unknown` is the skeleton the
    // reported signature is derived from. Its result follows the body when
    // `g`, which the body calls, is declared later.
    const ce = new ComputeEngine();
    ce.declare('k', {
      signature: '(unknown) -> unknown',
      evaluate: ce.parse('x \\mapsto x'),
    });
    ce.assign('k', ce.parse('x \\mapsto g(x)'));
    const before = ce.lookupDefinition('k')!.operator!;
    expect(before._signatureSkeleton).toBeDefined();
    const provenance = before._typeProvenance!.slice();

    ce.declare('k', { description: 'k' }, { extend: true });
    const def = ce.lookupDefinition('k')!.operator!;
    expect(def._signatureSkeleton).toEqual(before._signatureSkeleton);
    // The history of the signature changes is carried over
    expect(def._typeProvenance!.slice(0, provenance.length)).toEqual(
      provenance
    );

    ce.declare('g', {
      signature: '(number) -> number',
      evaluate: (_ops, { engine }) => engine.number(1),
    });
    expect(def.signature.toString()).toBe('(unknown) -> number');
  });
});

describe('declare extend: carried fields', () => {
  test('an explicit commutativeMatch is kept when commutative changes', () => {
    const ce = new ComputeEngine();
    ce.declare('Op', {
      signature: '(number, number) -> number',
      commutativeMatch: false,
    });
    expect(ce.lookupDefinition('Op')!.operator!.commutativeMatch).toBe(false);
    ce.declare('Op', { commutative: true }, { extend: true });
    const def = ce.lookupDefinition('Op')!.operator!;
    expect(def.commutative).toBe(true);
    expect(def.commutativeMatch).toBe(false);
  });

  test('addSignature given as an overload set is not nested', () => {
    const ce = new ComputeEngine();
    ce.declare('Basis', { signature: '(integer) -> integer' });
    ce.declare(
      'Basis',
      { addSignature: '((string) -> string) & (() -> boolean)' },
      { extend: true }
    );
    const type = ce.lookupDefinition('Basis')!.operator!.signature.type;
    expect(ce.type(type).toString()).toBe(
      '((integer) -> integer) & ((string) -> string) & (() -> boolean)'
    );
    // Three arms, each a signature: the serialization above flattens a
    // nested intersection, so test the structure too
    expect(typeof type === 'object' && type.kind).toBe('intersection');
    const arms = (type as { types: { kind: string }[] }).types;
    expect(arms.map((arm) => arm.kind)).toEqual([
      'signature',
      'signature',
      'signature',
    ]);
  });

  test('a signature that was only inferred can be replaced by any signature', () => {
    // An operator declared without a signature has the inferred
    // `(any*) -> unknown`, which is not a contract.
    const ce = new ComputeEngine();
    ce.declare('Sq', {
      evaluate: (ops, { engine }) => engine.number(ops[0].re ** 2),
    });
    expect(ce.lookupDefinition('Sq')!.operator!.inferredSignature).toBe(true);
    ce.declare('Sq', { signature: '(integer) -> integer' }, { extend: true });
    const def = ce.lookupDefinition('Sq')!.operator!;
    expect(def.signature.toString()).toBe('(integer) -> integer');
    expect(def.inferredSignature).toBe(false);
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('9');
    // The new signature is a contract: a narrower one is refused
    expect(() =>
      ce.declare('Sq', { signature: '(1) -> integer' }, { extend: true })
    ).toThrow(/is not a subtype/);
  });
});
