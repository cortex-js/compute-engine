import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Phase 1 of the nominal-types design
// (`docs/TYPE-SYSTEM.md`): a type declaration mints
// a value-level CONSTRUCTOR of the same name, in the same scope.
//
//   type point = tuple<x: number, y: number>   →  point: (x: number, y: number) -> point
//   type meters = number                       →  meters: (number) -> meters
//   type alias pt = tuple<number, number>      →  pt: (number, number) -> tuple<number, number>
//   type rec = record{x: number}               →  nothing (D4b)
//
// A NOMINAL constructor is inert: `point(1, 2)` canonicalizes to, and stays,
// the tagged application `["point", 1, 2]` whose `.type` is `point`. An ALIAS
// constructor is a checked cast: `pt(1, 2)` validates and returns the plain
// tuple (D10).
//
// The Epsil end-to-end shapes live in `test/epsil/declare-type.test.ts`.
//

/** The outcome of a call, as a string: `'ok'` or `throw: <first line>`. */
function outcome(f: () => unknown): string {
  try {
    f();
    return 'ok';
  } catch (e) {
    return `throw: ${(e as Error).message.split('\n')[0]}`;
  }
}

describe('MINTING — signature derivation (D4)', () => {
  test('a named-field tuple body mints NAMED parameters', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(ce.operatorInfo('point')?.signature?.toString()).toBe(
      '(x: number, y: number) -> point'
    );
  });

  test('an unnamed tuple body mints positional parameters', () => {
    const ce = new ComputeEngine();
    ce.declareType('pair', 'tuple<number, string>');
    expect(ce.operatorInfo('pair')?.signature?.toString()).toBe(
      '(number, string) -> pair'
    );
  });

  test('a scalar body mints a UNARY constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    expect(ce.operatorInfo('meters')?.signature?.toString()).toBe('(number) -> meters');
  });

  test('a list body mints a UNARY constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('ids', 'list<integer>');
    expect(ce.operatorInfo('ids')?.signature?.toString()).toBe('(list<integer>) -> ids');
  });

  test('a RECORD body mints NOTHING (D4b)', () => {
    const ce = new ComputeEngine();
    ce.declareType('rec', 'record{x: number, y: number}');
    expect(ce.operatorInfo('rec')).toBeUndefined();
    // …and the type itself is registered as usual.
    expect(ce.type('rec').toString()).toBe('rec');
  });

  test('a record ALIAS mints nothing either (D4b)', () => {
    const ce = new ComputeEngine();
    ce.declareType('reca', 'record{x: number}', { alias: true });
    expect(ce.operatorInfo('reca')).toBeUndefined();
  });

  test('a NAMED-field tuple ALIAS mints nothing either', () => {
    // The identity constructor returns a plain `Tuple`, whose synthesized type
    // has UNNAMED elements — which the subtype rules reject against the
    // named-tuple alias. A checked identity constructor whose result fails its
    // own type is worse than no constructor, so this body mints nothing, like
    // a record body.
    const ce = new ComputeEngine();
    ce.declareType('npt', 'tuple<x: number, y: number>', { alias: true });
    expect(ce.operatorInfo('npt')).toBeUndefined();
    // …and the type itself is registered as usual.
    expect(ce.type('npt').toString()).toBe('npt');
    // The Epsil lint covers the call site.
    expect(
      executeEpsil(
        ce,
        'type alias npt2 = tuple<x: number, y: number>\nnpt2(1, 2)'
      ).diagnostics.map((d) => d.message)
    ).toEqual([['type-not-callable', 'npt2']]);
  });

  test('an UNNAMED tuple ALIAS still mints, and its result fits the alias', () => {
    const ce = new ComputeEngine();
    ce.declareType('upt', 'tuple<integer, integer>', { alias: true });
    expect(ce.operatorInfo('upt')?.signature?.toString()).toBe(
      '(integer, integer) -> tuple<integer, integer>'
    );
    const v = ce.box(['upt', 1, 2]).evaluate();
    expect(v.toString()).toBe('(1, 2)');
    expect(v.type.matches(ce.type('upt'))).toBe(true);
  });

  test('a NOMINAL named-field tuple is unaffected', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(ce.operatorInfo('point')?.signature?.toString()).toBe(
      '(x: number, y: number) -> point'
    );
    const v = ce.box(['point', 1, 2]).evaluate();
    expect(v.type.matches(ce.type('point'))).toBe(true);
  });

  test('a self-referential body still mints', () => {
    const ce = new ComputeEngine();
    ce.declareType('json', 'list<json> | integer');
    expect(ce.operatorInfo('json')?.signature?.toString()).toBe(
      '(integer | list<json>) -> json'
    );
  });
});

describe('NOMINAL constructor — the tagged value (§4.1)', () => {
  test('the application is inert and carries the nominal type', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    const p = ce.box(['point', 1, 2]);
    expect(p.toString()).toBe('point(1, 2)');
    expect(p.type.toString()).toBe('point');
    expect(p.evaluate().toString()).toBe('point(1, 2)');
    expect(p.evaluate().type.toString()).toBe('point');
  });

  test('operands ARE evaluated (inert, not held)', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(ce.box(['point', ['Add', 1, 1], 2]).evaluate().toString()).toBe(
      'point(2, 2)'
    );
  });

  test('route parity — ce.function / ce.box / Epsil parse', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    const viaBox = ce.box(['point', 1, 2]);
    const viaFn = ce.function('point', [ce.number(1), ce.number(2)]);
    const viaEpsil = executeEpsil(ce, 'point(1, 2)').value;
    for (const p of [viaBox, viaFn, viaEpsil]) {
      expect(p.toString()).toBe('point(1, 2)');
      expect(p.type.toString()).toBe('point');
    }
    expect(viaBox.isSame(viaFn)).toBe(true);
    expect(viaBox.isSame(viaEpsil)).toBe(true);
  });

  test('MathJSON round-trips (serialization is free)', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    const p = ce.box(['point', 1, 2]);
    expect(p.json).toEqual(['point', 1, 2]);
    expect(ce.box(p.json as any).type.toString()).toBe('point');
  });

  test('wrong arity is the standard error path', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(ce.box(['point', 1]).toString()).toBe('point(1, Error("missing"))');
    expect(ce.box(['point', 1]).isValid).toBe(false);
  });

  test('wrong operand type is the standard `incompatible-type` path', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(ce.box(['point', { str: 'a' }, 2]).toString()).toBe(
      'point(Error(ErrorCode("incompatible-type", "number", "string"), "a"), 2)'
    );
  });

  test('a scalar newtype tags and checks', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    const m = ce.box(['meters', 5]);
    expect(m.evaluate().toString()).toBe('meters(5)');
    expect(m.type.toString()).toBe('meters');
    expect(ce.box(['meters', { str: 'a' }]).isValid).toBe(false);
  });

  test('a list-bodied newtype is unary', () => {
    const ce = new ComputeEngine();
    ce.declareType('ids', 'list<integer>');
    const v = ce.box(['ids', ['List', 1, 2, 3]]);
    expect(v.evaluate().toString()).toBe('ids([1,2,3])');
    expect(v.type.toString()).toBe('ids');
    // A non-list operand rejects.
    expect(ce.box(['ids', 4]).isValid).toBe(false);
  });

  test('the constructor is PURE with an empty effects slot (§4.4)', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    const p = ce.box(['point', 1, 2]);
    expect(p.isPure).toBe(true);
    expect(p.operatorDefinition?.pure).toBe(true);
    expect(p.operatorDefinition?.effects).toBeUndefined();
  });
});

describe('ALIAS identity constructor (D10)', () => {
  test('a tuple alias returns the PLAIN tuple', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    const v = ce.box(['pt', 1, 2]).evaluate();
    expect(v.toString()).toBe('(1, 2)');
    expect(v.type.toString()).toBe('tuple<integer, integer>');
  });

  test('a scalar alias returns the checked operand', () => {
    const ce = new ComputeEngine();
    ce.declareType('secs', 'number', { alias: true });
    expect(ce.box(['secs', 5]).evaluate().toString()).toBe('5');
    expect(ce.box(['secs', 5]).evaluate().type.toString()).toBe('5');
  });

  test('the cast is CHECKED — arity and types', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    expect(ce.box(['pt', 1]).isValid).toBe(false);
    expect(ce.box(['pt', { str: 'a' }, 2]).isValid).toBe(false);
  });

  test('the declared signature results in the STRUCTURAL type', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    expect(ce.operatorInfo('pt')?.signature?.toString()).toBe(
      '(number, number) -> tuple<number, number>'
    );
  });
});

describe('OPACITY (D3) — a nominal value does not pierce', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    return ce;
  }

  test('`First` rejects', () => {
    const ce = engine();
    expect(ce.box(['First', ['point', 1, 2]]).toString()).toBe(
      'First(Error(ErrorCode("incompatible-type", "indexed_collection", "point"), point(1, 2)))'
    );
  });

  test('indexed access rejects', () => {
    const ce = engine();
    expect(ce.box(['At', ['point', 1, 2], 1]).toString()).toContain(
      'incompatible-type'
    );
  });

  test('field access by name ALSO rejects (no D6 accessors in v1)', () => {
    // Recorded deliberately: `At(p, "x")` goes through the same
    // `indexed_collection | dictionary` gate as `At(p, 1)`, and Epsil has no
    // `.`-field-access surface at all (`p.x` is a lex/parse error). Accessors
    // therefore wait for a surface; opacity wins (see the task report).
    const ce = engine();
    expect(ce.box(['At', ['point', 1, 2], { str: 'x' }]).toString()).toContain(
      'incompatible-type'
    );
  });

  test('the value is not a collection', () => {
    const ce = engine();
    expect(ce.box(['point', 1, 2]).isCollection).toBe(false);
  });

  test('arithmetic on a scalar newtype rejects', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    expect(ce.box(['Add', ['meters', 5], 1]).isValid).toBe(false);
  });

  test('a structural value is not assignable to the nominal type', () => {
    const ce = engine();
    expect(
      outcome(() => ce.declare('q', { type: 'point', value: ce.tuple(1, 2) }))
    ).toContain('throw:');
  });

  test('but a tagged value IS', () => {
    const ce = engine();
    expect(
      outcome(() =>
        ce.declare('q', { type: 'point', value: ce.box(['point', 1, 2]) })
      )
    ).toBe('ok');
  });
});

describe('EQUALITY (D9)', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    ce.declareType('polar', 'tuple<r: number, t: number>');
    return ce;
  }

  test('same tag, same operands → True', () => {
    const ce = engine();
    expect(
      ce
        .box(['Equal', ['point', 1, 2], ['point', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  test('same tag, different operands → False', () => {
    const ce = engine();
    expect(
      ce
        .box(['Equal', ['point', 1, 2], ['point', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  test('a tagged value is never its structural spelling → False', () => {
    const ce = engine();
    expect(
      ce
        .box(['Equal', ['point', 1, 2], ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  test('two DIFFERENT tags → False', () => {
    // DEVIATION from D9's "no `eq` handler minted": the general machinery
    // leaves two distinct opaque applications undecided (`foo(1,2) ==
    // bar(1,2)` stays symbolic — they might agree pointwise). A minted
    // nominal constructor answers the one fact the general path cannot know:
    // a tagged value is its own tag. The handler fires ONLY when both sides
    // are minted nominal applications.
    const ce = engine();
    expect(
      ce
        .box(['Equal', ['polar', 1, 2], ['point', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  test('an ordinary opaque operator is still undecided (unchanged)', () => {
    const ce = new ComputeEngine();
    ce.declare('foo', { signature: '(number, number) -> number' });
    ce.declare('bar', { signature: '(number, number) -> number' });
    expect(
      ce
        .box(['Equal', ['foo', 1, 2], ['bar', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('foo(1, 2) == bar(1, 2)');
  });
});

describe('NAMESPACE rules (D5)', () => {
  test('an explicit same-scope binding is an ATOMIC failure', () => {
    const ce = new ComputeEngine();
    ce.declare('point', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
    });
    expect(outcome(() => ce.declareType('point', 'tuple<number, number>'))).toBe(
      'throw: The symbol "point" is already declared in the current scope: a type declaration also declares a value constructor of the same name'
    );
    // NOTHING was registered: probe BOTH namespaces.
    expect(ce._typeResolver.resolve('point')).toBeUndefined();
    expect(ce.operatorInfo('point')?.signature?.toString()).toBe('(number) -> number');
  });

  test('the same failure for an ALIAS declaration', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(number) -> number', evaluate: ([x]) => x });
    expect(
      outcome(() =>
        ce.declareType('g', 'tuple<number, number>', { alias: true })
      )
    ).toContain('already declared in the current scope');
    expect(ce._typeResolver.resolve('g')).toBeUndefined();
  });

  test('a value binding conflicts too', () => {
    const ce = new ComputeEngine();
    ce.declare('v', { type: 'number', value: ce.number(5) });
    expect(
      outcome(() => ce.declareType('v', 'tuple<number, number>'))
    ).toContain('already declared in the current scope');
    expect(ce._typeResolver.resolve('v')).toBeUndefined();
  });

  test('a SYSTEM builtin name is shadowed engine-wide, not conflicted', () => {
    const ce = new ComputeEngine();
    // `Sin` is a system-scope builtin: the D5 check consults the GLOBAL
    // scope's own bindings (an engine-wide name claim), where `Sin` is not
    // bound, so the declaration succeeds. Types are engine-global (ruled
    // 2026-08-10) and the constructor's lifetime is the type's — it is
    // minted into the GLOBAL scope even from inside a pushed scope, so the
    // builtin stays shadowed after the pop.
    ce.pushScope();
    expect(outcome(() => ce.declareType('Sin', 'number'))).toBe('ok');
    expect(ce.operatorInfo('Sin')?.signature?.toString()).toBe(
      '(number) -> Sin'
    );
    ce.popScope();
    const r = ce.box(['Sin', 0]).evaluate();
    expect(r.operator).toBe('Sin');
    expect(r.type.toString()).toBe('Sin');
  });

  test('a host declareType under a pushed scope keeps its constructor after the pop', () => {
    // The constructor's lifetime matches the (engine-global) type's: no
    // stranded type-without-constructor once the scope pops.
    const ce = new ComputeEngine();
    ce.pushScope();
    expect(outcome(() => ce.declareType('gpt', 'tuple<number, number>'))).toBe(
      'ok'
    );
    ce.popScope();
    expect(ce._typeResolver.resolve('gpt')).toBeDefined();
    expect(ce.operatorInfo('gpt')).toBeDefined();
    const r = ce.box(['gpt', 1, 2]).evaluate();
    expect(r.operator).toBe('gpt');
    expect(r.type.toString()).toBe('gpt');
  });

  test('an INFERRED (auto-declared, valueless) binding upgrades', () => {
    const ce = new ComputeEngine();
    ce.box('point'); // auto-declares a valueless inferred symbol
    expect(outcome(() => ce.declareType('point', 'tuple<number, number>'))).toBe(
      'ok'
    );
    expect(ce.box(['point', 1, 2]).type.toString()).toBe('point');
  });

  test('a statement re-run replaces BOTH halves', () => {
    const ce = new ComputeEngine();
    ce.declareType('po', 'tuple<number, number>', { fromStatement: true });
    ce.declareType('po', 'tuple<number, number, number>', {
      fromStatement: true,
    });
    expect(ce.operatorInfo('po')?.signature?.toString()).toBe(
      '(number, number, number) -> po'
    );
    expect(ce.box(['po', 1, 2, 3]).type.toString()).toBe('po');
    expect(ce.box(['po', 1, 2]).isValid).toBe(false);
  });

  test('a re-run onto a RECORD body removes the old constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('po', 'tuple<number, number>', { fromStatement: true });
    expect(ce.operatorInfo('po')).toBeDefined();
    ce.declareType('po', 'record{x: number}', { fromStatement: true });
    expect(ce.operatorInfo('po')).toBeUndefined();
  });

  test('a host re-declaration of the type still throws, atomically', () => {
    const ce = new ComputeEngine();
    ce.declareType('po', 'tuple<number, number>');
    expect(outcome(() => ce.declareType('po', 'tuple<number>'))).toContain(
      'already defined'
    );
    // Both halves survive intact.
    expect(ce.operatorInfo('po')?.signature?.toString()).toBe('(number, number) -> po');
    expect(ce.type('po').toString()).toBe('po');
  });

  test('a malformed body leaves both halves as they were', () => {
    const ce = new ComputeEngine();
    ce.declareType('po', 'tuple<number, number>', { fromStatement: true });
    expect(
      outcome(() =>
        ce.declareType('po', 'bogus<<', { fromStatement: true })
      )
    ).toContain('throw:');
    expect(ce.type('po').toString()).toBe('po');
    expect(ce.operatorInfo('po')?.signature?.toString()).toBe('(number, number) -> po');
  });

  // Minting is not atomic internally: it drops the previously minted
  // constructor FIRST, then `ce.declare()` installs a placeholder binding
  // BEFORE `updateDef()` builds the real definition — and that construction
  // can throw. No type body reachable from `declareType()` makes it throw
  // today, so these two inject the failure: what is under test is the
  // rollback, not the trigger.
  test('a failed MINT restores the previous constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('po', 'tuple<number, number>', { fromStatement: true });

    const declare = ce.declare.bind(ce);
    (ce as any).declare = () => {
      throw Error('mint failed');
    };
    expect(
      outcome(() =>
        ce.declareType('po', 'tuple<number, number, number>', {
          fromStatement: true,
        })
      )
    ).toBe('throw: mint failed');
    (ce as any).declare = declare;

    // BOTH halves survive intact — the old constructor is not left deleted.
    expect(ce.type('po').toString()).toBe('po');
    expect(ce.operatorInfo('po')?.signature?.toString()).toBe(
      '(number, number) -> po'
    );
    expect(ce.box(['po', 1, 2]).type.toString()).toBe('po');
  });

  test('a failed MINT leaves no dead placeholder binding', () => {
    const ce = new ComputeEngine();
    const declare = ce.declare.bind(ce);
    // Forward to the REAL `declare` with a definition that throws while the
    // boxed definition is constructed — i.e. AFTER the placeholder binding has
    // been installed in the scope.
    (ce as any).declare = (name: string) =>
      declare(name, { signature: '(number) -> number', collection: {} } as any);
    expect(outcome(() => ce.declareType('po', 'tuple<number, number>'))).toContain(
      'throw:'
    );
    (ce as any).declare = declare;

    // Neither namespace was claimed: no type record, and no leftover binding.
    expect(ce._typeResolver.resolve('po')).toBeUndefined();
    expect(ce.lookupDefinition('po')).toBeUndefined();
  });
});

describe('BOOTSTRAP carve-out (`mint: false`)', () => {
  test('the internal option suppresses the value half', () => {
    const ce = new ComputeEngine();
    ce.declareType('nm', 'tuple<number, number>', { mint: false });
    expect(ce.type('nm').toString()).toBe('nm');
    expect(ce.operatorInfo('nm')).toBeUndefined();
  });

  test('the engine bootstrap DOES mint (minting is unconditional today)', () => {
    // Recorded so the carve-out decision is visible: the two types the engine
    // declares at construction (`limits`, `distribution`) currently mint
    // constructors into the SYSTEM scope. Nothing in the suite depends on
    // their absence — flagged for ratification.
    const ce = new ComputeEngine();
    expect(ce.operatorInfo('limits')?.signature?.toString()).toBe(
      '(expression<Limits>) -> limits'
    );
    expect(ce.operatorInfo('distribution')).toBeDefined();
  });
});

describe('COMPILE erases the tag (phase 2, D11)', () => {
  // Compilation is type erasure: a constructor application compiles exactly
  // where the equivalent plain value compiles, to the same emission. The full
  // equivalence contract — per target, both the compiles and the declines —
  // lives in `type-constructors-compile.test.ts`; these two pin the shapes
  // that phase 1 used to decline.
  test('a nominal tuple constructor compiles like `Tuple`', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(compile(ce.box(['point', 1, 2]))?.code ?? '').toBe(
      compile(ce.box(['Tuple', 1, 2]))?.code ?? ''
    );
    expect(compile(ce.box(['point', 1, 2]))?.code ?? '').toBe('[1, 2]');
  });

  test('a scalar newtype compiles to its operand', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    expect(compile(ce.box(['meters', 5]))?.code ?? '').toBe('5');
  });
});
