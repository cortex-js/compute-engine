import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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

const refusal = (label: string) =>
  new RegExp(
    `^${label} is compiled as a JavaScript array, and compiled code does not accept a string for it`
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
              refusal('"S"')
            );
          } else if (type === 'collection' || type === 'indexed_collection') {
            // The compilation declines: the result falls back to the
            // interpreter, which reads the string as text. (A string is
            // outside a `list` type, so the run of the fallback with a
            // string is not checked for a `list` binding.)
            expect(r.run!({ S: EMOJI_A } as any)).toEqual(c.forString);
          }
        });
      }
    });
  }
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

  it('S: string | list<number>, `Sum(S)` does not compile', () => {
    // A string inhabits this type, so the entry accepts one, and `.reduce`
    // on the string would throw a `TypeError`.
    expect(compiled('string | list<number>', ['Sum', 'S']).success).toBe(false);
  });
});

describe('COMPILE entry: a binding whose type mentions text is not affected', () => {

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

describe('COMPILE entry: a binding declared with `missing`', () => {
  // A binding cannot be declared `missing | list<number>` (a declared type
  // cannot name `missing`, `docs/ERROR-MODEL.md`, "`Missing` is a result
  // only").
  it('a binding declared `missing | list<number>` is refused', () => {
    expect(() => engine('missing | list<number>')).toThrow(/cannot be declared/);
  });
});
