/**
 * Operations on a FIXED-LENGTH list on the shader targets: the two defects
 * that verification of that surface turned up, and the working emissions
 * either side of them.
 *
 *  1. The width reading was fail-OPEN on the ELEMENT type. A shader `vecN`
 *     holds N single floats, but `BaseCompiler.vectorComponentCount` reads a
 *     width off the OUTER dimension of a 1-axis `list` type and says nothing
 *     about what the elements are. So a symbol typed `list<complex^3>` (three
 *     `vec2` cells), `list<boolean^3>` (a `bvec3`, which has no arithmetic)
 *     and `list<list<number^2>^3>` (a 3x2 block) all read back as `vec3`, and
 *     `sin(c)`, `c + c`, `length(c)` and `max(max(b.x, b.y), b.z)` were
 *     emitted behind a reported success — source no shader compiler accepts.
 *     `gpuComponentCount` now asks the element question too, so these shapes
 *     land on the shader-ARRAY reading and every gate declines them.
 *
 *     The one slot that still takes the RAW width is the element-wise
 *     selection MASK, whose cells are booleans by construction: a
 *     boolean-vector condition is exactly the `bvecN` the float test would
 *     have rejected, and the elements are checked there against `boolean`.
 *
 *  2. The COLLECTION (reduce) form of `Sum`/`Product` — no indexing set, the
 *     operand IS the collection — had no shader lowering at all and threw
 *     "no indexing set", a message about the form it was not given. It is the
 *     same fold over the same statically known components that `Max`/`Min`
 *     already perform, so `Sum(v)` over a `vector<3>` now emits
 *     `(v.x + v.y + v.z)`, matching the JavaScript target and the
 *     interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off throughout: the literal probes below
 * (`Sum([1,2,3])`, `Sum(Range(1,4))`) are pure subtrees the compiler would
 * otherwise evaluate at compile time and emit as one number, which is the
 * right default but erases the codegen under test.
 */
const NO_FOLD = { constantFold: false } as const;

/** A fresh engine per declaration set — declarations are engine-lifetime. */
function engineWith(decls: Record<string, string>): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(decls)) ce.declare(name, type);
  return ce;
}

describe('GPU FIXED-LENGTH LIST — element type gates the vecN reading', () => {
  // Each element is a `vec2` of (re, im) by the complex convention, so the
  // three of them are not a `vec3`.
  describe('list<complex^3>', () => {
    const ce = engineWith({ c: 'list<complex^3>' });

    test('a componentwise builtin declines', () => {
      expect(() => glsl.compile(ce.box(['Sin', 'c']), NO_FOLD)).toThrow(
        /no array overload/
      );
      expect(() => glsl.compile(ce.box(['Abs', 'c']), NO_FOLD)).toThrow(
        /no array overload/
      );
    });

    test('infix arithmetic declines', () => {
      expect(() => glsl.compile(ce.box(['Add', 'c', 'c']), NO_FOLD)).toThrow(
        /shader ARRAY/
      );
      expect(() =>
        glsl.compile(ce.box(['Multiply', 'c', 'c']), NO_FOLD)
      ).toThrow(/shader ARRAY/);
      expect(() => glsl.compile(ce.box(['Negate', 'c']), NO_FOLD)).toThrow(
        /shader ARRAY/
      );
    });

    test('the Euclidean norm declines', () => {
      expect(() => glsl.compile(ce.box(['Norm', 'c']), NO_FOLD)).toThrow(
        /no array overload/
      );
    });
  });

  // A `bvec3` has no `max`: GLSL declares `max` over float, int and uint only.
  test('list<boolean^3> declines a numeric reduction', () => {
    const ce = engineWith({ b: 'list<boolean^3>' });
    expect(() => glsl.compile(ce.box(['Max', 'b']), NO_FOLD)).toThrow(
      /no compile-time component list/
    );
  });

  // The elements are not numbers at all on a target that has no strings.
  test('list<string^3> declines a numeric reduction', () => {
    const ce = engineWith({ s: 'list<string^3>' });
    expect(() => glsl.compile(ce.box(['Max', 's']), NO_FOLD)).toThrow(
      /no compile-time component list/
    );
  });

  // A 3x2 block. The LITERAL spelling has always been refused by the `vecN`
  // constructor guard; the TYPED symbol reached the same gates as a `vec3`.
  describe('list<list<number^2>^3>', () => {
    const ce = engineWith({ m: 'list<list<number^2>^3>' });

    test('a componentwise builtin declines', () => {
      expect(() => glsl.compile(ce.box(['Sin', 'm']), NO_FOLD)).toThrow(
        /no array overload/
      );
    });

    test('infix arithmetic declines', () => {
      expect(() => glsl.compile(ce.box(['Add', 'm', 'm']), NO_FOLD)).toThrow(
        /shader ARRAY/
      );
    });

    test('a reduction declines', () => {
      expect(() => glsl.compile(ce.box(['Max', 'm']), NO_FOLD)).toThrow(
        /no compile-time component list/
      );
    });
  });

  test('WGSL gates the same shapes', () => {
    const ce = engineWith({ c: 'list<complex^3>' });
    expect(() => wgsl.compile(ce.box(['Sin', 'c']), NO_FOLD)).toThrow(
      /no array overload/
    );
    expect(() => wgsl.compile(ce.box(['Add', 'c', 'c']), NO_FOLD)).toThrow(
      /shader ARRAY/
    );
  });

  test('a real-element fixed-length list keeps its vecN reading', () => {
    const ce = engineWith({ v: 'vector<3>', w: 'vector<3>' });
    expect(glsl.compile(ce.box(['Sin', 'v']), NO_FOLD).code).toBe('sin(v)');
    expect(glsl.compile(ce.box(['Add', 'v', 'w']), NO_FOLD).code).toBe(
      'v + w'
    );
    expect(glsl.compile(ce.box(['Dot', 'v', 'w']), NO_FOLD).code).toBe(
      'dot(v, w)'
    );
    expect(glsl.compile(ce.box(['Max', 'v']), NO_FOLD).code).toBe(
      '(max(max(v.x, v.y), v.z))'
    );
  });

  // The WIDE types are floats by the unknown-as-numeric-parameter rule, so a
  // list that states no useful element type keeps the width it always had.
  // The element test admits anything that COULD be a number and rejects only
  // what provably could not — the same standard the `At` index gate applies.
  //
  // `value` is the one that bites in practice, and an over-strict test for it
  // declined a real shape: a `PointList` component that is itself a computed
  // expression types `value`, and rejecting that turned `Dot` over a point
  // list into a decline even though `dot(vec2(…))` is its correct lowering.
  test.each(['unknown', 'any', 'value', 'expression', 'number', 'real', 'integer'])(
    'list<%s^3> keeps its vecN reading',
    (element) => {
      const ce = engineWith({ u: `list<${element}^3>` });
      expect(glsl.compile(ce.box(['Sin', 'u']), NO_FOLD).code).toBe('sin(u)');
    }
  );

  // Compilation is type erasure, so a nominal element answers layout questions
  // as its DEFINITION. A nominal type deliberately does not subtype that
  // definition, so asking the element question without resolving it first
  // rejected a list whose elements are nominally real — the same false decline
  // as the `value` case above, one layer deeper.
  test('a nominal element type resolves to its definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('nmeters', 'real');
    ce.declare('m', 'list<nmeters^3>');
    ce.declare('p', 'tuple<nmeters, nmeters>');
    expect(glsl.compile(ce.box(['Dot', 'p', 'p']), NO_FOLD).code).toBe(
      'dot(p, p)'
    );
    expect(glsl.compile(ce.box(['Sum', 'm']), NO_FOLD).code).toBe(
      '((m.x) + (m.y) + (m.z))'
    );
  });

  // `Ln`, `Log`, `Artanh`, `Arcoth` and `Arsech` return `complex | +oo | -oo`.
  // `isNonRealNumber` of that whole union is `false` — the infinite members are
  // not subtypes of `complex`, so the union is not one either — and
  // `couldMatch(_, 'number')` is `true` because the `complex` member overlaps
  // `number`. Asked that way, a genuinely complex element was admitted into a
  // vector of float cells: this gate's own fail-open, reached through a
  // computed union instead of a written `complex`.
  test('a union whose finite part is complex is not a float cell', () => {
    const ce = engineWith({ u: 'list<complex | +oo | -oo ^2>' });
    expect(() => glsl.compile(ce.box(['Sin', 'u']), NO_FOLD)).toThrow(
      /no array overload/
    );
    expect(() => glsl.compile(ce.box(['Add', 'u', 'u']), NO_FOLD)).toThrow(
      /shader ARRAY/
    );
  });

  // The mirror of the case above: a union whose finite part is REAL keeps its
  // vector reading, so dropping the infinite branches cannot over-reject.
  test('a union whose finite part is real keeps its vecN reading', () => {
    const ce = engineWith({ r: 'list<real | +oo | -oo ^3>' });
    expect(glsl.compile(ce.box(['Sin', 'r']), NO_FOLD).code).toBe('sin(r)');
  });

  test('Dot over value-typed components lowers, it does not decline', () => {
    const ce = engineWith({
      p: 'list<value^2>',
      q: 'tuple<value, value>',
    });
    expect(glsl.compile(ce.box(['Dot', 'p', 'p']), NO_FOLD).code).toBe(
      'dot(p, p)'
    );
    expect(glsl.compile(ce.box(['Dot', 'q', 'q']), NO_FOLD).code).toBe(
      'dot(q, q)'
    );
  });

  // The frame stores only a WIDTH, so a caller-declared `bvec3` is entered as
  // a plain 3 and reads back from `_localVector` exactly like a `vec3`. The
  // declared SPELLING is the only surviving record of its element kind.
  test('a caller-declared boolean vector parameter is not a float vecN', () => {
    const ce = engineWith({ bb: 'list<boolean^3>' });
    expect(() =>
      glsl.compileFunction(
        ce.box(['Sum', 'bb']),
        'f',
        'float',
        [['bb', 'bvec3']],
        NO_FOLD
      )
    ).toThrow(/no compile-time component list/);
    expect(() =>
      glsl.compileFunction(
        ce.box(['Sin', 'bb']),
        'f',
        'float',
        [['bb', 'bvec3']],
        NO_FOLD
      )
    ).toThrow();
  });

  // Same frame, a float spelling: the width must still come through.
  test('a caller-declared float vector parameter keeps its width', () => {
    const ce = engineWith({ v: 'vector<3>' });
    expect(
      glsl.compileFunction(
        ce.box(['Sum', 'v']),
        'f',
        'float',
        [['v', 'vec3']],
        NO_FOLD
      )
    ).toBe('float f(vec3 v) {\n  return ((v.x) + (v.y) + (v.z));\n}');
  });

  // The mask slot is the one place a boolean-celled vector IS the shape
  // wanted; the float element test must not reach it.
  test('a boolean-vector value still lowers as an element-wise mask', () => {
    const ce = engineWith({ B2: 'list<boolean^2>' });
    expect(
      glsl.compile(ce.box(['Which', 'B2', 1, 'True', 0]), NO_FOLD).code
    ).toBe('mix(vec2(0.0), vec2(1.0), B2)');
  });
});

/**
 * The `At` declines must stay DISCRIMINATED. A consumer that falls back to
 * another lane (Tycho's Game of Life heatmap falls to its CPU lane) reads the
 * reason to tell an OPEN element type from a declaration this target cannot
 * parse, so the two must not share a message — and neither may claim a length
 * is unknown when the type states one.
 */
describe('GPU FIXED-LENGTH LIST — At decline reasons stay distinct', () => {
  const gridExpr = (ce: ComputeEngine) => ce.box(['At', 'S', 'k']);

  test('an open element type is "not statically counted"', () => {
    const ce = engineWith({ S: 'indexed_collection<integer>', k: 'integer' });
    expect(() => glsl.compile(gridExpr(ce), NO_FOLD)).toThrow(
      /is not a statically counted collection/
    );
  });

  test('a genuinely unsized list has no statically known length', () => {
    const ce = engineWith({ S: 'list<number>', k: 'integer' });
    expect(() => glsl.compile(gridExpr(ce), NO_FOLD)).toThrow(
      /has no statically known length/
    );
  });

  // The length is stated twice (the engine type and the declared spelling) and
  // readable neither time, because a frame entry overrides the boxed type and
  // this target parses no array spelling. Claiming the length is unknown was
  // false, and it collided with the unsized message above.
  test('an unparsed declared spelling names the declaration, not the type', () => {
    const ce = engineWith({ S: 'list<number^1600>', k: 'integer' });
    let message = '';
    try {
      glsl.compileFunction(
        gridExpr(ce),
        'cell',
        'float',
        [
          ['S', 'float[1600]'],
          ['k', 'int'],
        ],
        NO_FOLD
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/caller-declared name "S"/);
    expect(message).toMatch(/float\[1600\]/);
    expect(message).not.toMatch(/has no statically known length/);
    expect(message).not.toMatch(/is not a statically counted collection/);
  });

  // A WGSL shader INPUT is referenced from the emitted source as a field of
  // the entry point's `input` struct, so the frame's `ref` for it is
  // `input.S`, not `S`. The diagnostic must name what the caller WROTE — the
  // name they can find in their own declaration list. `compileFunction` omits
  // `ref` (it defaults to the name), so only this route witnesses the
  // difference.
  test('the message names the declared name, not its emission identifier', () => {
    const ce = engineWith({ S: 'list<number^1600>', k: 'integer' });
    let message = '';
    try {
      wgsl.compileShader({
        type: 'vertex',
        inputs: [
          { name: 'S', type: 'array<f32, 1600>' },
          { name: 'k', type: 'i32' },
        ],
        outputs: [{ name: 'pos', type: 'vec4f' }],
        body: [{ variable: 'pos.x', expression: ce.box(['At', 'S', 'k']) }],
        constantFold: false,
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/caller-declared name "S"/);
    expect(message).not.toMatch(/input\.S/);
  });

  // The route a shader host actually uses: the carrier is a free engine symbol
  // of counted type, and the host injects `uniform float S[1600];` itself.
  test('a counted free symbol compiles through the array helper', () => {
    const ce = engineWith({ S: 'list<number^1600>', k: 'integer' });
    const r = glsl.compile(gridExpr(ce), NO_FOLD);
    expect(r.code).toBe('_gpu_at1600(S, k)');
    expect(r.preamble).toContain('float _gpu_at1600(float v[1600], float i)');
  });

  test('a static index into that symbol folds to a subscript', () => {
    const ce = engineWith({ S: 'list<number^1600>', k: 'integer' });
    expect(glsl.compile(ce.box(['At', 'S', 800]), NO_FOLD).code).toBe(
      'S[799]'
    );
  });
});

describe('GPU FIXED-LENGTH LIST — Sum/Product collection form', () => {
  test('folds a list literal', () => {
    const ce = new ComputeEngine();
    expect(
      glsl.compile(ce.box(['Sum', ['List', 1, 2, 3]]), NO_FOLD).code
    ).toBe('((1.0) + (2.0) + (3.0))');
    // Past `vec4` the literal lowers to `float[5](…)`, whose constructor
    // arguments are the components just the same.
    expect(
      glsl.compile(ce.box(['Sum', ['List', 1, 2, 3, 4, 5]]), NO_FOLD).code
    ).toBe('((1.0) + (2.0) + (3.0) + (4.0) + (5.0))');
  });

  test('folds a tuple literal', () => {
    const ce = new ComputeEngine();
    expect(
      glsl.compile(ce.box(['Sum', ['Tuple', 1, 2, 3]]), NO_FOLD).code
    ).toBe('((1.0) + (2.0) + (3.0))');
  });

  test('folds a Range, which lowers to an array constructor', () => {
    const ce = new ComputeEngine();
    expect(glsl.compile(ce.box(['Sum', ['Range', 1, 4]]), NO_FOLD).code).toBe(
      '((1.0) + (2.0) + (3.0) + (4.0))'
    );
  });

  test('folds a declared vector over its swizzles', () => {
    const ce = engineWith({ v: 'vector<3>' });
    expect(glsl.compile(ce.box(['Sum', 'v']), NO_FOLD).code).toBe(
      '((v.x) + (v.y) + (v.z))'
    );
    expect(glsl.compile(ce.box(['Product', 'v']), NO_FOLD).code).toBe(
      '((v.x) * (v.y) * (v.z))'
    );
  });

  test('the fold is an ordinary subexpression', () => {
    const ce = engineWith({ v: 'vector<3>' });
    expect(glsl.compile(ce.box(['Sin', ['Sum', 'v']]), NO_FOLD).code).toBe(
      'sin(((v.x) + (v.y) + (v.z)))'
    );
  });

  // A component is a constructor ARGUMENT compiled at its own precedence, so
  // its source can be bare infix arithmetic. Unparenthesized, a neighbouring
  // operator binds into it: this emitted `2.0 * x + 1.0`, which computes
  // `2x + 1` where the interpreter computes `2(x + 1)`.
  test('a compound component cannot be reassociated by its context', () => {
    const ce = new ComputeEngine();
    expect(
      glsl.compile(
        ce.box(['Multiply', ['Sum', ['List', ['Add', 'x', 1]]], 2]),
        NO_FOLD
      ).code
    ).toBe('2.0 * ((x + 1.0))');
    expect(
      glsl.compile(
        ce.box(['Sum', ['Tuple', ['Add', 'x', 1], 'y']]),
        NO_FOLD
      ).code
    ).toBe('((x + 1.0) + (y))');
  });

  // A complex value lowers to `vec2(re, im)`, which matches the aggregate
  // constructor pattern while being one NUMBER, not a two-cell collection.
  // Folding it answered a real `1.0` where the interpreter answers `i`.
  test('a complex scalar is not a two-element collection', () => {
    const ce = new ComputeEngine();
    expect(() => glsl.compile(ce.box(['Sum', 'ImaginaryUnit']), NO_FOLD)).toThrow(
      /is not a collection/
    );
  });

  // `Sum([]) = 0` in the interpreter. Recognized before the operand is
  // compiled: `[]` lowers to `float[0]()`, which the `vecN` constructor guard
  // refuses outright, so compiling it first would decline the whole fold.
  //
  // Only `Sum` is probed with a literal: `Product` over a LIST LITERAL
  // canonicalizes to `Reduce(list, Multiply, 1)`, which never reaches the
  // `Product` lowering at all (the shader targets have no `Reduce`; with
  // constant folding on — the default — such a subtree is evaluated at
  // compile time and emitted as one number). `Product` over a SYMBOL stays
  // `Product` and is covered above.
  test('the empty collection is the identity', () => {
    const ce = new ComputeEngine();
    expect(glsl.compile(ce.box(['Sum', ['List']]), NO_FOLD).code).toBe('0.0');
  });

  test('WGSL folds the same shapes', () => {
    const ce = engineWith({ v: 'vector<3>' });
    expect(wgsl.compile(ce.box(['Sum', 'v']), NO_FOLD).code).toBe(
      '((v.x) + (v.y) + (v.z))'
    );
    expect(
      wgsl.compile(ce.box(['Sum', ['List', 1, 2, 3]]), NO_FOLD).code
    ).toBe('((1.0) + (2.0) + (3.0))');
  });

  describe('fails closed where there is no component list', () => {
    // A shader has no dynamic iteration, so a width past `vec4` (an array, and
    // arrays carry no compile-time component list once they are a NAME rather
    // than a constructor) has nothing to fold over.
    test('a 5+-wide declared vector', () => {
      const ce = engineWith({ a: 'vector<7>' });
      expect(() => glsl.compile(ce.box(['Sum', 'a']), NO_FOLD)).toThrow(
        /no compile-time component list/
      );
    });

    test('an unknown-length list', () => {
      const ce = engineWith({ xs: 'list<number>' });
      expect(() => glsl.compile(ce.box(['Sum', 'xs']), NO_FOLD)).toThrow(
        /no compile-time component list/
      );
    });

    test('a fixed-length list whose elements are not shader floats', () => {
      const ce = engineWith({ c: 'list<complex^3>' });
      expect(() => glsl.compile(ce.box(['Sum', 'c']), NO_FOLD)).toThrow(
        /no compile-time component list/
      );
    });

    // The interpreter answers `Sum(x) = x` for a scalar, but a value that is
    // not a collection at all reaching a reduction is a shape the caller did
    // not mean — the JavaScript target declines it too.
    test('a statically scalar operand', () => {
      const ce = new ComputeEngine();
      expect(() => glsl.compile(ce.box(['Sum', 5]), NO_FOLD)).toThrow(
        /is not a collection/
      );
    });
  });

  test('the indexed form is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      glsl.compile(ce.box(['Sum', ['Sin', 'i'], ['Limits', 'i', 1, 3]]), NO_FOLD)
        .code
    ).toBe('((sin(1.0)) + (sin(2.0)) + (sin(3.0)))');
    expect(
      glsl.compile(ce.box(['Product', 'i', ['Limits', 'i', 1, 4]]), NO_FOLD).code
    ).toBe('((1.0) * (2.0) * (3.0) * (4.0))');
    expect(
      glsl.compile(ce.box(['Sum', 'i', ['Limits', 'i', 5, 3]]), NO_FOLD).code
    ).toBe('0.0');
  });
});
