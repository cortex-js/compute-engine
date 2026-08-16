/**
 * EFFECT ANNOTATIONS ON THE MEMBERS OF A PROTOCOL IMPLEMENTATION BLOCK.
 *
 * A member of an `is P { … }` block may carry an effect specifier, exactly as
 * a top-level definition may:
 *
 *     type Box = object{n: integer} is Sized {
 *       function size(self: Self) pure -> integer { self.n }
 *     }
 *
 * Two things have to hold, and neither used to:
 *
 * 1. The member stays CALLABLE. An effect specifier lowers to a full marker
 *    signature in the literal's body slot (`["Typed", body, "'(self: Self) pure
 *    -> integer'"]`), and that text mentions `Self` — a substitution token no
 *    type resolver knows. `canonicalFunctionLiteral` parses a body-slot marker
 *    and, when it does not parse, replaces the body with an error expression;
 *    the literal then has no Block for a body and every dispatch failed with
 *    `Error("Function body must be a scoped Block expression")`. The fix
 *    substitutes `Self` on the STORED literal, at registration
 *    (`groundedImplementationBlock` in `engine-protocols.ts`).
 * 2. The declared effects are CONTRACT-CHECKED against the body, the same
 *    `declared ⊇ inferred` rule a top-level definition is held to, reported
 *    through the same `incompatible-type` error value. Same substitution: the
 *    walk has to see the receiver's real type before it can tell that
 *    `self.n = v` is a store.
 *
 * Every fixture builds a fresh engine — protocols are engine-global.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { inferFunctionLiteralEffects } from '../../src/compute-engine/boxed-expression/effects-inference';
import type { Expression } from '../../src/compute-engine/types-expression';

/** Run an Epsil program on a fresh engine (or `ce`), returning the engine, the
 * final value as a string, and the diagnostic messages flattened to strings. */
function run(
  source: string,
  ce: ComputeEngine = new ComputeEngine()
): { ce: ComputeEngine; value: string; diagnostics: string[] } {
  const r = executeEpsil(ce, source);
  return {
    ce,
    value: String(r.value),
    diagnostics: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join('|') : String(d.message)
    ),
  };
}

const SIZED = `protocol Sized { function size(self: Self) -> number }`;

describe('an annotated implementation-block member is callable', () => {
  test('`pure` on a function member', () => {
    const { value, diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) pure -> number { self.n }
}
size(Box(n: 3))`);
    expect(value).toBe('3');
    expect(diagnostics).toEqual([]);
  });

  test('`random` on a function member', () => {
    const { value, diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) random -> number { self.n + Random() }
}
size(Box(n: 3))`);
    // `Random()` draws in [0, 1), so the result is bracketed rather than
    // compared to a value the draw decides.
    expect(Number(value)).toBeGreaterThanOrEqual(3);
    expect(Number(value)).toBeLessThan(4);
    expect(diagnostics).toEqual([]);
  });

  test('`state` on a function member', () => {
    const { value, diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) state -> number { self.n }
}
size(Box(n: 3))`);
    expect(value).toBe('3');
    expect(diagnostics).toEqual([]);
  });

  test('the target’s own name spells the same thing as `Self`', () => {
    const { value, diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Box) pure -> number { self.n }
}
size(Box(n: 3))`);
    expect(value).toBe('3');
    expect(diagnostics).toEqual([]);
  });

  test('an UNANNOTATED member is unaffected', () => {
    const { value, diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) -> number { self.n }
}
size(Box(n: 3))`);
    expect(value).toBe('3');
    expect(diagnostics).toEqual([]);
  });

  test('a GROUPED return type is not re-read as the literal’s own contract', () => {
    // A fully parenthesized annotation is this repo's spelling for "this member
    // RETURNS a function" (`isGroupedTypeText` / `returnTypeText` in
    // `common/type/utils.ts`); the same text ungrouped would be the marker
    // signature of the enclosing literal. Re-serializing a type with
    // `typeToString` always drops the parens, so grounding has to put them
    // back — otherwise `-> ((integer) -> Self)` re-reads as the contract
    // `(self: Box) -> (integer) -> Box` and P17 rejects the member.
    const { value, diagnostics } =
      run(`protocol Mk { function mk(self: Self) -> ((integer) -> Self) }
type Box = object{n: integer} is Mk {
  function mk(self: Self) -> ((integer) -> Self) { k => self }
}
mk(Box(n: 7))(1).n`);
    expect(value).toBe('7');
    expect(diagnostics).toEqual([]);
  });

  test('`Self` in an annotation INSIDE the body resolves', () => {
    // A body's `let` annotation rides as `["Declare", name, T, …]`, not as a
    // `Typed` node, so the substitution has to reach that slot too; before it
    // did, this failed with `Failed to parse type "Self"` and NO diagnostic,
    // while the same annotation spelled `Box` worked.
    const { value, diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) -> number { let s: Self = self
    s.n }
}
size(Box(n: 4))`);
    expect(value).toBe('4');
    expect(diagnostics).toEqual([]);
  });

  test('an annotated `get` accessor is callable, and an unannotated one still is', () => {
    const AGED = `protocol Aged { readonly age: integer }`;
    expect(
      run(`${AGED}
type Q = object{n: integer} is Aged { get age(self: Self) pure -> integer { self.n } }
Q(n: 5).age`).value
    ).toBe('5');
    expect(
      run(`${AGED}
type Q = object{n: integer} is Aged { get age(self: Self) -> integer { self.n } }
Q(n: 5).age`).value
    ).toBe('5');
  });

  test('an annotated `set` accessor is callable', () => {
    const { value, diagnostics } = run(`protocol Aged { readwrite age: integer }
type Q = object{n: integer} is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) state -> Self { self.n = v
    self }
}
let q = Q(n: 1)
q.age = 7
q.age`);
    expect(value).toBe('7');
    expect(diagnostics).toEqual([]);
  });
});

describe('a member’s declared effects are checked against its body', () => {
  /** The refusal a violated `pure` annotation produces, whichever route
   * declared it: the `incompatible-type` code with the expected and the
   * inferred effect sets as its two arguments. */
  const PURE_VS_RANDOM = 'expected `pure effects`, got `random effects`';

  test('`pure` on a body that draws is refused with the same code and wording as at the top level', () => {
    // The REFUSAL is identical: the `incompatible-type` code carrying the
    // expected and the inferred effect sets, which is what
    // `effectContractErrorValue` produces for a top-level definition.
    const topLevel = run(`function h() pure -> number { Random() }
1`);
    expect(topLevel.diagnostics).toEqual([
      `runtime-error|${PURE_VS_RANDOM}||incompatible-type`,
    ]);

    const inBlock = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) pure -> number { Random() }
}
1`);
    // The CHANNELS differ, and deliberately so. `incompatible-type` is a
    // canonicalization code (`CANONICALIZATION_ERROR_CODES` in
    // `src/epsil/static-diagnostics.ts`), and a conformance registers from the
    // canonical handler, so the static pre-pass sees this refusal and reports
    // it with a source snippet before the evaluation pass reports it again.
    // That is the house convention for the code — `let x: integer = "abc"`
    // produces the same static+runtime pair (asserted just below) — not
    // something specific to implementation blocks. The top-level case is the
    // quiet one: its contract is checked when the definition is INSTALLED, at
    // evaluation, so canonicalization has nothing to report.
    expect(inBlock.diagnostics).toEqual([
      expect.stringContaining(`static-type-error|${PURE_VS_RANDOM}`),
      `runtime-error|${PURE_VS_RANDOM}||incompatible-type`,
    ]);
  });

  test('the static+runtime pair matches every other `incompatible-type`', () => {
    // The control for the comment above: an ordinary declared-type violation
    // reports on both channels too, so the implementation-block refusal is not
    // louder than its peers.
    const { diagnostics } = run(`let x: integer = "abc"
1`);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toContain('static-type-error');
    expect(diagnostics[0]).toContain('incompatible-type');
    expect(diagnostics[1]).toContain('runtime-error');
    expect(diagnostics[1]).toContain('incompatible-type');
  });

  test('a refused member registers NOTHING — the conformance as a whole is rejected', () => {
    // `implementationProblem` reports the FIRST problem and `declareConformance`
    // turns it into an error value before anything is stored, so the edge keeps
    // no partial implementation: the call finds no applicable one.
    const { value } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) pure -> number { Random() }
}
size(Box(n: 3))`);
    expect(value).toContain('protocol-implementation-missing');
  });

  test('a `pure` setter that STORES into the receiver is refused', () => {
    const { diagnostics } = run(`protocol Aged { readwrite age: integer }
type Q = object{n: integer} is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) pure -> Self { self.n = v
    self }
}
1`);
    expect(diagnostics.join('\n')).toContain(
      'expected `pure effects`, got `state effects`'
    );
  });

  test('a `state` setter that stores is accepted', () => {
    const { value, diagnostics } = run(`protocol Aged { readwrite age: integer }
type Q = object{n: integer} is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) state -> Self { self.n = v
    self }
}
let q = Q(n: 1)
q.age = 7
q.age`);
    expect(value).toBe('7');
    expect(diagnostics).toEqual([]);
  });

  test('a declaration WIDER than the body is accepted', () => {
    // `declared ⊇ inferred` — over-declaring is legal, under-declaring is not.
    const { value, diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) random -> number { self.n }
}
size(Box(n: 3))`);
    expect(value).toBe('3');
    expect(diagnostics).toEqual([]);
  });

  test('an UNANNOTATED member that draws is not refused', () => {
    // Nothing was declared, so there is no contract to violate; the effects
    // stay on the inferred track.
    const { diagnostics } = run(`${SIZED}
type Box = object{n: integer} is Sized {
  function size(self: Self) -> number { Random() }
}
1`);
    expect(diagnostics).toEqual([]);
  });
});

describe('the `Self` substitution reaches the stored literal', () => {
  test('an authored setter’s inferred effects include the store on `self`', () => {
    const { ce } = run(`protocol Aged { readwrite age: integer }
type Q = object{n: integer} is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}`);
    const registry = (
      ce as unknown as {
        _protocolRegistry: Record<
          string,
          { conformances: { impl?: Record<string, Expression> }[] }
        >;
      }
    )._protocolRegistry;
    const setter = registry['Aged']!.conformances[0]!.impl!['__set__age']!;
    expect(inferFunctionLiteralEffects(ce as never, setter).effects).toEqual([
      'state',
    ]);
    // The receiver is stored as the conformance TARGET, not as `Self`.
    expect(String(setter.type)).toContain('self: Q');
  });
});

describe('the box route: `DeclareConformance` with an annotated literal', () => {
  /** An engine with the `Box` object type and the `Sized` protocol declared
   * through the raw-MathJSON box route. */
  function boxEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      { str: 'Box' },
      { str: 'object{n: integer}' },
    ] as never).evaluate();
    ce.box([
      'DeclareProtocol',
      { str: 'Sized' },
      [
        'Dictionary',
        [
          'KeyValuePair',
          { str: 'size' },
          ['Pair', { str: 'function' }, { str: '(self: Self) -> number' }],
        ],
      ],
    ] as never).evaluate();
    return ce;
  }

  /** `["DeclareConformance", …]` for `Box is Sized`, whose `size` member
   * carries `marker` as its body-slot signature and `body` as its body. */
  const conformance = (marker: string, body: unknown): unknown => [
    'DeclareConformance',
    { str: 'Box' },
    ['List', 'Sized'],
    [
      'Dictionary',
      [
        'KeyValuePair',
        { str: 'size' },
        [
          'Function',
          ['Typed', ['Block', body], { str: marker }],
          ['Typed', 'self', { str: 'Self' }],
        ],
      ],
    ],
  ];

  test('an annotated member declared through the box route is callable', () => {
    const ce = boxEngine();
    const declared = ce
      .box(
        conformance('(self: Self) pure -> number', [
          'Field',
          'self',
          { str: 'n' },
        ]) as never
      )
      .evaluate();
    expect(String(declared)).toBe('"Nothing"');
    expect(
      String(
        ce
          .box(['size', ['Box', ['NamedArgument', { str: 'n' }, 3]]] as never)
          .evaluate()
      )
    ).toBe('3');
  });

  test('the CANONICAL marker form is grounded too', () => {
    // The other shape `bodySlotSignature` reads: the marker moved INSIDE the
    // Block, wrapping its last statement. A hand-authored literal may arrive
    // that way, and an ungrounded one made `size(...)` THROW
    // `Function body must be a scoped Block expression` out of `.evaluate()`
    // — an uncaught exception rather than an error value.
    const ce = boxEngine();
    const declared = ce
      .box([
        'DeclareConformance',
        { str: 'Box' },
        ['List', 'Sized'],
        [
          'Dictionary',
          [
            'KeyValuePair',
            { str: 'size' },
            [
              'Function',
              [
                'Block',
                [
                  'Typed',
                  ['Field', 'self', { str: 'n' }],
                  { str: '(self: Self) pure -> number' },
                ],
              ],
              ['Typed', 'self', { str: 'Self' }],
            ],
          ],
        ],
      ] as never)
      .evaluate();
    expect(String(declared)).toBe('"Nothing"');
    expect(
      String(
        ce
          .box(['size', ['Box', ['NamedArgument', { str: 'n' }, 3]]] as never)
          .evaluate()
      )
    ).toBe('3');
  });

  test('the box route runs the same effect-contract check', () => {
    const ce = boxEngine();
    const declared = ce
      .box(conformance('(self: Self) pure -> number', ['Random']) as never)
      .evaluate();
    expect(String(declared)).toContain('incompatible-type');
    expect(String(declared)).toContain('pure effects');
    expect(String(declared)).toContain('random effects');
  });
});

describe('the host route: a JS callback implementation', () => {
  test('a host implementation is callable and stays TRUSTED', () => {
    // `declareProtocolImplementation` accepts JS callbacks only — there is no
    // signature and no effect specifier for the engine to read, so a host
    // implementation takes part in the coverage and unknown-member checks and
    // nothing else (design P10), exactly as before this change.
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      { str: 'Box' },
      { str: 'object{n: integer}' },
    ] as never).evaluate();
    ce.box([
      'DeclareProtocol',
      { str: 'Sized' },
      [
        'Dictionary',
        [
          'KeyValuePair',
          { str: 'size' },
          ['Pair', { str: 'function' }, { str: '(self: Self) -> number' }],
        ],
      ],
    ] as never).evaluate();
    ce.declareProtocolImplementation('Box', 'Sized', {
      functions: { size: () => 42 },
    });
    expect(
      String(
        ce
          .box(['size', ['Box', ['NamedArgument', { str: 'n' }, 3]]] as never)
          .evaluate()
      )
    ).toBe('42');
  });
});

describe('KNOWN GAP: a CONDITIONAL conformance’s annotated member', () => {
  test('an effect specifier on a conditional conformance’s member is still uncallable', () => {
    // Pinned as a gap, not as a contract. `Self` is substituted on the stored
    // literal only for a GROUND conformance target. A conditional target is a
    // head PATTERN (`list<T>`), whose only ground stand-in is the widest
    // instantiation (`list<number>`) — and P17 checks the implementation's
    // COVARIANT positions against the pattern instead, so a stored literal
    // ground to the widest instantiation fails that check (a member declaring
    // `-> Self` would be read as `-> list<number>` and rejected against
    // `-> list<T>`). Closing this needs a place to keep the author's text
    // apart from what dispatch reads; `implementationLiteralAt` declines a
    // conditional edge for the same reason.
    //
    // Expected console noise: the uncallable literal reaches `makeLambda`,
    // whose `console.assert(body.isScoped)` prints an ASSERTION FAILURE banner
    // for this file on every run. The banner IS the pinned gap; it disappears
    // when the gap closes. (`console.*` is stripped in production builds.)
    const { value } =
      run(`protocol Sized { function size(self: Self) -> integer }
type list<T> is Sized where T: number {
  function size(self: Self) pure -> integer { Length(self) }
}
size([1, 2, 3])`);
    expect(value).toContain('Function body must be a scoped Block expression');
  });

  test('the same conditional conformance works UNANNOTATED', () => {
    const { value } =
      run(`protocol Sized { function size(self: Self) -> integer }
type list<T> is Sized where T: number {
  function size(self: Self) -> integer { Length(self) }
}
size([1, 2, 3])`);
    expect(value).toBe('3');
  });
});
