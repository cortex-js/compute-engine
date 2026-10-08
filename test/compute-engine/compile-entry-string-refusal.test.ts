import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { createJavaScriptRuntime } from '../../src/runtime';

/**
 * The JavaScript target reads a binding declared with a collection type
 * (`list`, `indexed_collection`, `collection`, and their `<T>` forms) as a
 * JavaScript array. The engine reads a string as an indexed collection of
 * grapheme clusters, so the bare `indexed_collection` and `collection` types
 * admit a string, but the compiled code read it as an array of UTF-16 code
 * units: `Length(S)` of `"😀a"` gave 3 where the interpreter gives 2, and
 * `Drop(S, 1)` gave `"\ude00a"`, half of the emoji.
 *
 * The user decided (2026-10-07) that the compiled entry refuses a string for
 * such a binding with a `TypeError` that names the binding. An array still
 * runs and agrees with the interpreter. A binding whose type a string
 * inhabits through a text member (`string`, `string | list<number>`) is not
 * affected.
 *
 * The Python target binds its parameters as bare Python names with no entry
 * check, so it has no equivalent of this refusal.
 */

const EMOJI_A = '😀a';

/** The three expressions of the decision, with the interpreter's answer for
 * `S = [1, 2, 3]` and for `S = "😀a"`. */
const CASES: {
  name: string;
  expr: any;
  forList: unknown;
  forString: unknown;
}[] = [
  {
    name: 'Length(Drop(S, 1))',
    expr: ['Length', ['Drop', 'S', 1]],
    forList: 2,
    forString: 1,
  },
  {
    name: 'Drop(S, 1)',
    expr: ['Drop', 'S', 1],
    forList: [2, 3],
    forString: 'a',
  },
  { name: 'Length(S)', expr: ['Length', 'S'], forList: 3, forString: 2 },
];

/** An engine with `S` declared, and no value. */
function engine(type: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('S', type as any);
  return ce;
}

/** The interpreter's answer for `expr` with `S` declared `type` and assigned
 * `value`, printed (`[2,3]`, `"a"`, `2`): compare it with `JSON.stringify`
 * of the expected value. */
function interpret(type: string, expr: any, value: unknown): string {
  const ce = engine(type);
  ce.assign(
    'S',
    typeof value === 'string'
      ? ce.string(value)
      : ce.function(
          'List',
          (value as number[]).map((x) => ce.number(x))
        )
  );
  return ce.box(expr).evaluate().toString();
}

function compiled(type: string, expr: any) {
  return compile(engine(type).box(expr), { constantFold: false })!;
}

const refusal = (label: string, type: string) =>
  new RegExp(
    `^${label} \\(type \`${type.replace(/[<>|]/g, (c) => `\\${c}`)}\`\\) is compiled as a JavaScript array, and compiled code does not accept a string for it`
  );

describe('COMPILE entry: a collection-declared binding refuses a string', () => {
  for (const type of [
    'indexed_collection',
    'collection',
    'list',
    'list<number>',
  ]) {
    describe(`S: ${type}`, () => {
      for (const c of CASES) {
        it(`${c.name}`, () => {
          const r = compiled(type, c.expr);
          // An array runs on every route and agrees with the interpreter.
          expect(interpret(type, c.expr, [1, 2, 3])).toBe(
            JSON.stringify(c.forList)
          );
          expect(r.run!({ S: [1, 2, 3] } as any)).toEqual(c.forList);
          if (r.success) {
            // The compiled code refuses the string at entry.
            expect(() => r.run!({ S: EMOJI_A } as any)).toThrow(TypeError);
            expect(() => r.run!({ S: EMOJI_A } as any)).toThrow(
              refusal('"S"', type)
            );
          } else {
            // `Drop` does not compile on a `collection` operand, which is
            // not indexed: the result falls back to the interpreter, which
            // reads the string as text.
            expect(type).toBe('collection');
            expect(c.expr[0] === 'Drop' || c.expr[1][0] === 'Drop').toBe(true);
            expect(r.run!({ S: EMOJI_A } as any)).toEqual(c.forString);
          }
        });
      }
    });
  }

  it('compiles `Length(S)` for each of the four types', () => {
    // The refusal above is a check of compiled code, not of the fallback.
    for (const type of [
      'indexed_collection',
      'collection',
      'list',
      'list<number>',
    ])
      expect(compiled(type, ['Length', 'S']).success).toBe(true);
  });

  it('refuses a string on the lambda route, for an annotated parameter', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box([
        'Function',
        ['Length', ['Drop', 'S', 1]],
        ['Typed', 'S', { str: 'indexed_collection' }],
      ]),
      { constantFold: false }
    )!;
    expect(r.success).toBe(true);
    const run = r.run as unknown as (s: unknown) => unknown;
    expect(run([1, 2, 3])).toBe(2);
    expect(() => run(EMOJI_A)).toThrow(
      refusal('argument 1', 'indexed_collection')
    );
  });

  it('refuses a string in a runtime loaded from the stored result', () => {
    const r = compiled('indexed_collection', ['Length', 'S']);
    expect(r.success).toBe(true);
    const { run: _run, ...stored } = r;
    const fn = createJavaScriptRuntime().load(
      JSON.parse(JSON.stringify(stored))
    ) as (vars: unknown) => unknown;
    expect(fn({ S: [1, 2, 3] })).toBe(3);
    expect(() => fn({ S: EMOJI_A })).toThrow(
      refusal('"S"', 'indexed_collection')
    );
  });

  it('does not refuse a string when the entry checks are off', () => {
    // `entryChecks: false` removes every check of the entry plan; the
    // compiled code then reads the string as UTF-16 code units.
    const r = compile(engine('indexed_collection').box(['Length', 'S']), {
      constantFold: false,
      entryChecks: false,
    } as any)!;
    expect(r.success).toBe(true);
    expect(r.run!({ S: EMOJI_A } as any)).toBe(3);
  });
});

describe('COMPILE entry: a binding declared with a type alias', () => {
  // The lambda route read the annotation with a parser that does not know
  // the user-declared type names, so an alias parameter had no entry check:
  // `Length(S)` of "😀a" gave 3, where the inline annotation threw.
  for (const [alias, body] of [
    ['seq', 'indexed_collection'],
    ['nums', 'list<number>'],
  ]) {
    it(`refuses a string on the lambda route for an alias of ${body}`, () => {
      const ce = new ComputeEngine();
      ce.declareType(alias, body, { alias: true });
      const r = compile(
        ce.box(['Function', ['Length', 'S'], ['Typed', 'S', { str: alias }]]),
        { constantFold: false }
      )!;
      expect(r.success).toBe(true);
      const run = r.run as unknown as (s: unknown) => unknown;
      expect(run([1, 2, 3])).toBe(3);
      expect(() => run(EMOJI_A)).toThrow(refusal('argument 1', alias));
    });

    it(`refuses a string on the vars route for an alias of ${body}`, () => {
      const ce = new ComputeEngine();
      ce.declareType(alias, body, { alias: true });
      ce.declare('S', alias);
      const r = compile(ce.box(['Length', 'S']), { constantFold: false })!;
      expect(r.success).toBe(true);
      expect(r.run!({ S: [1, 2, 3] } as any)).toBe(3);
      expect(() => r.run!({ S: EMOJI_A } as any)).toThrow(
        refusal('"S"', alias)
      );
    });
  }
});

describe('COMPILE entry: a collection of text that a string does not inhabit', () => {
  // The interpreter refuses a string for these types, so the compiled entry
  // refuses it too. Before, an element type that mentions text exempted the
  // binding, and `Length(S)` of "😀a" gave 3.
  for (const type of ['list<string>', 'list<character>', 'list<list<string>>'])
    it(`S: ${type} refuses a string`, () => {
      const r = compiled(type, ['Length', 'S']);
      expect(r.success).toBe(true);
      expect(() => r.run!({ S: EMOJI_A } as any)).toThrow(refusal('"S"', type));
    });
});

describe('COMPILE: a collection of text that a string inhabits fails closed', () => {
  // A string inhabits `indexed_collection<character>` and
  // `collection<character>`, so the entry does not refuse it. The compiled
  // collection lowerings read their operand as a JavaScript array, and would
  // read a string as an array of UTF-16 code units: `Length(S)` of "😀a" gave
  // 3 where the interpreter gives 2, and `Drop(S, 1)` gave half of the emoji.
  // So the compile fails, and the result runs the interpreter, which reads
  // the string as text and agrees with it for an array too.
  for (const type of [
    'indexed_collection<character>',
    'collection<character>',
  ]) {
    for (const c of CASES) {
      it(`S: ${type}, ${c.name} does not compile`, () => {
        const r = compiled(type, c.expr);
        expect(r.success).toBe(false);
        expect(r.run!({ S: EMOJI_A } as any)).toEqual(c.forString);
      });
    }

    it(`S: ${type}, the element reads do not compile`, () => {
      for (const expr of [
        ['At', 'S', 1],
        ['First', 'S'],
        ['Take', 'S', 1],
        ['Count', 'S'],
        ['List', ['Spread', 'S']],
      ])
        expect(compiled(type, expr).success).toBe(false);
    });

    it(`S: ${type}, \`Length(S)\` throws without the fallback`, () => {
      expect(() =>
        compile(engine(type).box(['Length', 'S']), {
          constantFold: false,
          fallback: false,
        })
      ).toThrow(/Could not compile `Length`/);
    });
  }
});

describe('COMPILE: an extremum or a sum over a scalar-or-collection union that admits text', () => {
  // `Max`, `Min`, `Sum` and `Product` of an operand typed as a scalar or a
  // collection read an array as a collection and any other value as one
  // number. A string is not an array, so it was read as a number: compiled
  // `Max(S)` of "😀a" gave NaN, and compiled `Sum(S)` returned the string,
  // where the interpreter reports a type error. The compile now fails.
  it('S: number | string, `Max(S)` does not compile', () => {
    expect(compiled('number | string', ['Max', 'S']).success).toBe(false);
  });

  it('S: number | indexed_collection, `Sum(S)` does not compile', () => {
    expect(compiled('number | indexed_collection', ['Sum', 'S']).success).toBe(
      false
    );
  });

  it('S: number | list<number>, `Sum(S)` compiles and refuses a string at entry', () => {
    // No member of this type admits a string, and the interpreter refuses
    // one. Before, the entry accepted it, because not every member is a
    // collection, and compiled `Sum(S)` returned the string.
    const r = compiled('number | list<number>', ['Sum', 'S']);
    expect(r.success).toBe(true);
    expect(r.run!({ S: 5 } as any)).toBe(5);
    expect(r.run!({ S: [1, 2, 3] } as any)).toBe(6);
    expect(() => r.run!({ S: EMOJI_A } as any)).toThrow(TypeError);
    expect(() => r.run!({ S: EMOJI_A } as any)).toThrow(
      refusal('"S"', 'list<number> | number')
    );
  });

  it('S: string | list<number>, `Sum(S)` does not compile', () => {
    // A string inhabits this type, so the entry accepts one, and `.reduce`
    // on the string would throw a `TypeError`.
    expect(compiled('string | list<number>', ['Sum', 'S']).success).toBe(false);
  });
});

describe('COMPILE entry: an inferred collection type refuses a string too', () => {
  // The engine infers a type for an undeclared symbol from its uses
  // (`Drop(S, 1)` infers `indexed_collection<unknown>`). The compiled code
  // reads such a symbol as an array exactly as it reads a declared one, so
  // the refusal applies alike; otherwise `Drop(S, 1)` of `"😀a"` gave a
  // broken half of the emoji.
  it('refuses a string for a symbol inferred `indexed_collection`', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Length', ['Drop', 'S', 1]]), {
      constantFold: false,
    })!;
    expect(r.success).toBe(true);
    expect(ce.symbol('S').valueDefinition?.inferredType).toBe(true);
    expect(r.run!({ S: [1, 2, 3] } as any)).toBe(2);
    expect(() => r.run!({ S: EMOJI_A } as any)).toThrow(
      /does not accept a string/
    );
  });

  it('refuses a string for a symbol inferred `collection`', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Length', 'S']), { constantFold: false })!;
    expect(r.success).toBe(true);
    expect(ce.symbol('S').valueDefinition?.inferredType).toBe(true);
    expect(r.run!({ S: [1, 2, 3] } as any)).toBe(3);
    expect(() => r.run!({ S: 'abc' } as any)).toThrow(
      /does not accept a string/
    );
  });

  it('refuses a string for an unannotated lambda parameter used as a list', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Function', ['Length', ['Drop', 'S', 1]], 'S']), {
      constantFold: false,
    })!;
    expect(r.success).toBe(true);
    expect(r.run!([1, 2, 3] as any)).toBe(2);
    expect(() => r.run!(EMOJI_A as any)).toThrow(/does not accept a string/);
  });
});

describe('COMPILE entry: a binding whose type mentions text is not affected', () => {
  it('S: string compiles and agrees with the interpreter', () => {
    for (const c of CASES) {
      const r = compiled('string', c.expr);
      expect(r.success).toBe(true);
      expect(interpret('string', c.expr, EMOJI_A)).toBe(
        JSON.stringify(c.forString)
      );
      expect(r.run!({ S: EMOJI_A } as any)).toEqual(c.forString);
    }
  });

  it('S: string | list<number> does not compile, and the fallback runs both', () => {
    // A lowering of an operand with a string arm fails closed at compile
    // time, so the result runs the interpreter, for a string and for an
    // array alike.
    for (const c of CASES) {
      const r = compiled('string | list<number>', c.expr);
      expect(r.success).toBe(false);
      expect(r.run!({ S: EMOJI_A } as any)).toEqual(c.forString);
      expect(r.run!({ S: [1, 2, 3] } as any)).toEqual(c.forList);
    }
  });
});

describe('COMPILE fallback: a string or a boolean argument', () => {
  // The interpreter fallback declared every argument that was not an array, a
  // complex value or a color as a `number`: a string argument threw
  // "not compatible with the type number", and a string that is a valid
  // identifier (`"abc"`) was read as a symbol.
  it('reads a string argument as a string on the vars route', () => {
    const r = compiled('string | list<number>', ['Length', ['Drop', 'S', 1]]);
    expect(r.success).toBe(false);
    expect(r.run!({ S: 'abc' } as any)).toBe(2);
    expect(r.run!({ S: 'Pi' } as any)).toBe(1);
  });

  it('reads a string argument as a string on the lambda route', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box([
        'Function',
        ['Length', ['Drop', 'S', 1]],
        ['Typed', 'S', { str: 'string | list<number>' }],
      ]),
      { constantFold: false }
    )!;
    expect(r.success).toBe(false);
    const run = r.run as unknown as (s: unknown) => unknown;
    expect(run('abc')).toBe(2);
    expect(run([1, 2, 3])).toBe(2);
  });

  it('reads a boolean argument as a boolean on the vars route', () => {
    const ce = engine('string | list<number>');
    ce.declare('B', 'boolean');
    const r = compile(ce.box(['If', 'B', ['Length', 'S'], -1]), {
      constantFold: false,
    })!;
    expect(r.success).toBe(false);
    expect(r.run!({ B: true, S: [1, 2] } as any)).toBe(2);
    expect(r.run!({ B: false, S: [1, 2] } as any)).toBe(-1);
  });
});

describe('COMPILE entry: a body error caused by a scalar in an array-read binding names the binding', () => {
  // A scalar in a `list`-declared binding is NOT refused at entry: the
  // lowerings dispatch on the run-time shape, and `Add(S, 1)` with `S = 5` is
  // 6 (`compile-list-entry.test.ts`). A lowering that needs an array then
  // fails inside the body, and the error named a generated variable:
  // `_tv1.reduce is not a function`. The error now names the binding and
  // its declared type (user decision 2026-10-08, `namedEntryError`).
  const named = (label: string, type: string, kind: string) =>
    new RegExp(
      `${label} \\(type \`${type.replace(/[<>|]/g, (c) => `\\${c}`)}\`\\) received ${kind}: compiled code reads such a binding as a JavaScript array, and the compiled body failed \\(.*\\)\\. Pass an array\\.`
    );

  it('Sum over `missing | list<number>` given a number', () => {
    const r = compiled('missing | list<number>', ['Sum', 'S']);
    expect(r.success).toBe(true);
    expect(r.run!({ S: [1, 2, 3] } as any)).toBe(6);
    expect(r.run!({ S: undefined } as any)).toBeNaN();
    expect(() => r.run!({ S: 5 } as any)).toThrow(
      named('"S"', 'list<number> | missing', 'a number')
    );
    expect(() => r.run!({ S: null } as any)).toThrow(
      named('"S"', 'list<number> | missing', 'null')
    );
  });

  it('Sum over `list<number>` given a number', () => {
    const r = compiled('list<number>', ['Sum', 'S']);
    expect(() => r.run!({ S: 5 } as any)).toThrow(
      named('"S"', 'list<number>', 'a number')
    );
  });

  it('a scalar that the lowering accepts still runs', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<number>');
    const r = compile(ce.box(['Add', 'S', 1]), { constantFold: false })!;
    expect(r.run!({ S: 5 } as any)).toBe(6);
    expect(r.run!({ S: [1, 2] } as any)).toEqual([2, 3]);
  });

  it('the lambda route names the argument', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box(['Function', ['Sum', 'xs'], ['Typed', 'xs', 'list<number>']]),
      { constantFold: false }
    )!;
    expect(r.run!([1, 2, 3] as any)).toBe(6);
    expect(() => r.run!(5 as any)).toThrow(
      named('argument 1', 'list<number>', 'a number')
    );
  });

  it('an error that no array-read binding explains is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<number>');
    const r = compile(ce.box(['Sum', 'S']), { constantFold: false })!;
    // The binding holds an array: a body error (none here) would pass
    // through; a wrong-typed entry is reported by the entry check itself.
    expect(r.run!({ S: new Float64Array([1, 2]) } as any)).toBe(3);
    // A body error of another shape is not renamed: the complex entry check
    // reports an object entry itself, before the body runs.
    expect(() => r.run!({ S: [{ re: 1, im: 2 }] } as any)).toThrow(/entry/);
  });

  it('names every candidate binding when several hold a scalar', () => {
    // `Add(S, 1)` accepts the scalar `S`; `Sum(T)` fails on the scalar `T`.
    // The runtime cannot tell which binding the body read, so it names
    // both as possible causes and keeps the body's message.
    const ce = new ComputeEngine();
    ce.declare('S', 'list<number>');
    ce.declare('T', 'list<number>');
    const r = compile(ce.box(['Tuple', ['Add', 'S', 1], ['Sum', 'T']]), {
      constantFold: false,
    })!;
    expect(r.success).toBe(true);
    let caught: unknown;
    try {
      r.run!({ S: 5, T: 7 } as any);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeError);
    const message = (caught as TypeError).message;
    expect(message).toMatch(/"S" \(type `list<number>`\) received a number/);
    expect(message).toMatch(/"T" \(type `list<number>`\) received a number/);
    expect((caught as TypeError).cause).toBeInstanceOf(TypeError);
  });
});
