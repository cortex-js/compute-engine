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

  it('S: indexed_collection<character> still accepts a string (open case)', () => {
    // A string inhabits `indexed_collection<character>`, so the entry does
    // not refuse it. The compiled code still reads it as an array of UTF-16
    // code units: the count below is WRONG (the interpreter gives 2). This
    // is the open case recorded in ROADMAP.md; the assertion only records
    // the current output, it does not say that it is correct.
    const r = compiled('indexed_collection<character>', ['Length', 'S']);
    expect(r.success).toBe(true);
    expect(r.run!({ S: EMOJI_A } as any)).toBe(3);
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
