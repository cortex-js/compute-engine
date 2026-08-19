import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { resolveTypeForCompilation } from '../../src/common/type/utils';
import { typeToString } from '../../src/common/type/serialize';

//
// Phase 2 of the nominal-types design
// (`docs/TYPE-SYSTEM.md`, D11): COMPILATION IS
// TYPE ERASURE.
//
// The governing equivalence rule: a constructor application compiles exactly
// where the equivalent plain value compiles, per target, to the same emission.
//   - `meters(x)` compiles wherever `x` does, to exactly the compiled `x`;
//   - `point(1, 2)` compiles wherever `Tuple(1, 2)` does, to the same emission
//     (JS pair, GLSL `vec2`);
//   - where the plain shape declines, the constructor declines identically.
// No more, no less. Alias identity constructors erase the same way.
//
// "Wherever the plain value compiles" is bounded by OPACITY (D3), upstream:
// `Sin(meters(x))` never reaches the compiler at all — it is an
// `incompatible-type` error at canonicalization, because a `meters` is not a
// number. That static discipline is exactly what makes erasing the tag sound,
// so the larger contexts exercised here are the ones the checker admits
// (`Tuple`, `List`, `If`, the root).
//
// The other half of the phase is reference unfolding at the compile type
// gates (§4.6 step 1): a `type alias` / nominal `type` reference answers a
// REPRESENTATION question (numeric? how many vector components? tuple?) as its
// DEFINITION — for aliases, where it is also the admissibility answer, and for
// nominal types, whose admissibility stays opaque.
//

/** A `CompilationResult` that declined reports empty code. */
function jsCode(ce: ComputeEngine, expr: unknown): string {
  return compile(ce.box(expr as never))?.code ?? '';
}

/** GLSL source, or `'DECLINE'` when the target failed closed. A fresh target
 * per call, so generated-name numbering never leaks between assertions. */
function glslCode(ce: ComputeEngine, expr: unknown): string {
  try {
    return new GLSLTarget().compile(ce.box(expr as never)).code;
  } catch {
    return 'DECLINE';
  }
}

describe('SCALAR NEWTYPE — pure erasure (D11 step A)', () => {
  test('a nominal constructor compiles to exactly its compiled operand', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    ce.declare('x', 'number');
    const body = ce.box(['Add', ['Sin', 'x'], ['Power', 'x', 2]]);
    expect(jsCode(ce, ['meters', body])).toBe(jsCode(ce, body));
    expect(jsCode(ce, ['meters', body])).toBe('(_.x * _.x) + Math.sin(_.x)');
  });

  test('inside a larger compiled expression', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    const tagged = ['If', ['Greater', 'x', 0], ['meters', 'x'], ['meters', 'y']];
    const plain = ['If', ['Greater', 'x', 0], 'x', 'y'];
    expect(jsCode(ce, tagged)).toBe(jsCode(ce, plain));
    expect(jsCode(ce, tagged)).toBe('((0 < _.x) ? (_.x) : (_.y))');
    expect(glslCode(ce, tagged)).toBe(glslCode(ce, plain));
    expect(glslCode(ce, tagged)).toBe('((0.0 < x) ? (x) : (y))');
  });

  test('the erased kernel agrees with the tagless one, numerically', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    ce.declare('x', 'number');
    const body = ce.box(['Add', ['Sin', 'x'], ['Power', 'x', 2]]);
    const plain = compile(body).run!;
    const tagged = compile(ce.box(['meters', body])).run!;
    for (const v of [0.3, 1.7, -2.1]) {
      // Against the tagless compilation…
      expect(tagged({ x: v })).toBe(plain({ x: v }));
      // …and against an INDEPENDENT numeric evaluation (verify empirically).
      const n = ce
        .box([
          'Block',
          ['Declare', 'x', 'number'],
          ['Assign', 'x', v],
          ['Add', ['Sin', 'x'], ['Power', 'x', 2]],
        ])
        .N();
      expect(tagged({ x: v })).toBeCloseTo(n.re, 12);
    }
  });

  test('a scalar newtype erases on the GLSL target too', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    expect(glslCode(ce, ['Tuple', ['meters', 'x'], ['meters', 'y']])).toBe(
      glslCode(ce, ['Tuple', 'x', 'y'])
    );
    expect(glslCode(ce, ['Tuple', ['meters', 'x'], ['meters', 'y']])).toBe(
      'vec2(x, y)'
    );
  });

  test('an ALIAS identity constructor erases the same way', () => {
    const ce = new ComputeEngine();
    ce.declareType('mm', 'number', { alias: true });
    ce.declare('x', 'number');
    // `mm(x)` evaluates to the plain `x`, but it can appear UN-evaluated
    // inside a compiled expression — it must erase there too.
    expect(jsCode(ce, ['Add', ['mm', 'x'], 1])).toBe(
      jsCode(ce, ['Add', 'x', 1])
    );
    expect(jsCode(ce, ['Add', ['mm', 'x'], 1])).toBe('_.x + 1');
  });

  test('a non-scalar (list) body erases to its operand', () => {
    const ce = new ComputeEngine();
    ce.declareType('ids', 'list<integer>');
    ce.declare('L', 'list<integer>');
    expect(jsCode(ce, ['ids', 'L'])).toBe(jsCode(ce, 'L'));
    expect(jsCode(ce, ['ids', 'L'])).toBe('_.L');
  });
});

describe('REFERENCE UNFOLDING at the compile type gates (§4.6 step 1)', () => {
  test('an alias-typed scalar symbol compiles in arithmetic', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number', { alias: true });
    ce.declare('m', 'meters');
    const expr = ce.box(['Add', 'm', 1]);
    expect(expr.isValid).toBe(true);
    expect(jsCode(ce, ['Add', 'm', 1])).toBe('_.m + 1');
    expect(compile(expr).run!({ m: 4 })).toBe(5);
    expect(glslCode(ce, ['Add', 'm', 1])).toBe('m + 1.0');
  });

  test('an alias of a tuple derives the same shader WIDTH as the tuple', () => {
    // Before the unfold, `At(p, 1)` failed closed on GLSL with "the base
    // (type `pt`) is not a statically counted collection" while the
    // structurally identical `q` compiled to `q.x`.
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    ce.declare('p', 'pt');
    ce.declare('q', 'tuple<number, number>');
    // Same emission up to the operand's own name.
    expect(glslCode(ce, ['At', 'p', 1])).toBe(
      glslCode(ce, ['At', 'q', 1]).replace('q', 'p')
    );
    expect(glslCode(ce, ['At', 'p', 1])).toBe('p.x');
    expect(glslCode(ce, ['Norm', 'p'])).toBe(
      glslCode(ce, ['Norm', 'q']).replace('q', 'p')
    );
    expect(glslCode(ce, ['Norm', 'p'])).toBe('length(p)');
  });

  test('a NOMINAL tuple-typed symbol: representation unfolds, admissibility does not', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<number, number>');
    ce.declare('n', 'point');
    ce.declare('q', 'tuple<number, number>');
    // A `vecN` component must be a scalar, so a vec2-valued component has no
    // shader lowering: both fail closed, identically. (Before the unfold, the
    // nominal one emitted `vec2(n, n)` — invalid shader source behind
    // `success: true`.)
    expect(glslCode(ce, ['Tuple', 'n', 'n'])).toBe('DECLINE');
    expect(glslCode(ce, ['Tuple', 'q', 'q'])).toBe('DECLINE');
    // Opacity (D3) is untouched: a `point` is not an indexed collection, so
    // `At(n, 1)` never reaches the compiler at all.
    expect(ce.box(['At', 'n', 1]).isValid).toBe(false);
    expect(ce.box(['At', 'q', 1]).isValid).toBe(true);
  });
});

describe('TUPLE-BODY CONSTRUCTOR — follows `Tuple` (D11 step B)', () => {
  test('JS: compiles where `Tuple` compiles, to the same emission', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    expect(jsCode(ce, ['point', 1, 2])).toBe(jsCode(ce, ['Tuple', 1, 2]));
    expect(jsCode(ce, ['point', 1, 2])).toBe('[1, 2]');
    expect(jsCode(ce, ['point', 'x', 'y'])).toBe(
      jsCode(ce, ['Tuple', 'x', 'y'])
    );
    expect(jsCode(ce, ['point', 'x', 'y'])).toBe('[_.x, _.y]');
    expect(compile(ce.box(['point', 'x', 'y'])).run!({ x: 3, y: 4 })).toEqual([
      3, 4,
    ]);
  });

  test('GLSL: a fixed-width numeric tuple body is the target `vecN`', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    ce.declareType('rgb', 'tuple<number, number, number>');
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    ce.declare('z', 'number');
    expect(glslCode(ce, ['point', 'x', 'y'])).toBe(
      glslCode(ce, ['Tuple', 'x', 'y'])
    );
    expect(glslCode(ce, ['point', 'x', 'y'])).toBe('vec2(x, y)');
    expect(glslCode(ce, ['rgb', 'x', 'y', 'z'])).toBe(
      glslCode(ce, ['Tuple', 'x', 'y', 'z'])
    );
    expect(glslCode(ce, ['rgb', 'x', 'y', 'z'])).toBe('vec3(x, y, z)');
  });

  test('the compiled point agrees with the interpreter, numerically', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    ce.declare('x', 'number');
    const run = compile(ce.box(['point', 'x', ['Sin', 'x']])).run!;
    for (const v of [0.3, 1.7, -2.1]) {
      const n = ce
        .box([
          'Block',
          ['Declare', 'x', 'number'],
          ['Assign', 'x', v],
          ['Tuple', 'x', ['Sin', 'x']],
        ])
        .N();
      const expected = [n.op1.re, n.op2.re];
      const got = run({ x: v }) as number[];
      expect(got[0]).toBeCloseTo(expected[0], 12);
      expect(got[1]).toBeCloseTo(expected[1], 12);
    }
  });

  test('an ALIAS tuple constructor emits the same tuple', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    expect(jsCode(ce, ['pt', 1, 2])).toBe(jsCode(ce, ['Tuple', 1, 2]));
    expect(jsCode(ce, ['pt', 1, 2])).toBe('[1, 2]');
  });

  test('JS: DECLINES exactly where `Tuple` declines', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<number, number>');
    ce.declare('x', 'number');
    // An operand with no lowering takes the whole construction down — for the
    // plain tuple and for the constructor alike.
    expect(jsCode(ce, ['Tuple', 1, ['Unknown9', 'x']])).toBe('');
    expect(jsCode(ce, ['point', 1, ['Unknown9', 'x']])).toBe('');
  });

  test('GLSL: DECLINES exactly where `Tuple` declines', () => {
    const ce = new ComputeEngine();
    ce.declareType('pair', 'tuple<tuple<number,number>, tuple<number,number>>');
    ce.declare('q', 'tuple<number, number>');
    // A `vecN` component must be a scalar: a tuple of tuples has no shader
    // lowering. Both fail closed.
    expect(glslCode(ce, ['Tuple', 'q', 'q'])).toBe('DECLINE');
    expect(glslCode(ce, ['pair', 'q', 'q'])).toBe('DECLINE');
    // The very same body DOES compile on JS, where a tuple is a plain array —
    // "wherever the plain shape compiles" is answered per target.
    expect(jsCode(ce, ['pair', 'q', 'q'])).toBe(
      jsCode(ce, ['Tuple', 'q', 'q'])
    );
    expect(jsCode(ce, ['pair', 'q', 'q'])).toBe('[_.q, _.q]');
  });
});

describe('DECLINES CLEANLY — never throws', () => {
  test('a record body has no constructor at all (D4b)', () => {
    const ce = new ComputeEngine();
    ce.declareType('rec', 'record{x: number, y: number}');
    expect(ce.lookupDefinition('rec')).toBeUndefined();
    // Nothing minted, so `rec(…)` is an unknown operator: it declines with no
    // code, and does not throw out of `compile()`.
    expect(() => compile(ce.box(['rec', 1]))).not.toThrow();
    expect(jsCode(ce, ['rec', 1])).toBe('');
  });

  test('an uncompilable payload declines like the payload does', () => {
    const ce = new ComputeEngine();
    ce.declareType('bag', 'dictionary<number>');
    const d = ce.box(['Dictionary', ['KeyValuePair', "'a'", 1]]);
    expect(() => compile(ce.box(['bag', d]))).not.toThrow();
    expect(jsCode(ce, ['bag', d])).toBe(jsCode(ce, d));
  });
});

describe('ERASURE IS FLAG-DRIVEN, never a name table', () => {
  test('an ordinary operator named like a type is unaffected', () => {
    const ce = new ComputeEngine();
    // Not minted by a type declaration: no `_mintedTypeConstructor` marker,
    // so no erasure — it keeps the ordinary "no lowering" decline.
    ce.declare('meters', { signature: '(number) -> number' });
    expect(jsCode(ce, ['meters', 5])).toBe('');
  });

  test('a user operator shaped like a tuple constructor is unaffected', () => {
    const ce = new ComputeEngine();
    ce.declare('point', {
      signature: '(number, number) -> tuple<number,number>',
    });
    expect(jsCode(ce, ['point', 1, 2])).toBe('');
  });
});

describe('ABSENCE AXIS — the reference unfolds BEFORE the missing-strip', () => {
  // `stripMissingFromType` is structural: it does not see through a
  // `reference`, so an alias of `T | missing` survives the strip intact. If the
  // strip runs first, the still-unstripped union is not `<: number` and the
  // JavaScript target picks the OBJECT (null) absence axis for what is a
  // numeric-domain hole — compiled `IsMissing`/`Coalesce` then disagree with
  // the interpreter (`IsMissing(NaN)` came out `false`). Unfolding first makes
  // the alias spelling indistinguishable from the inline one, which is the
  // erasure rule of this phase.
  test('an alias of `number | missing` selects the NaN axis, like the inline spelling', () => {
    const ce = new ComputeEngine();
    ce.declareType('maybe_n', 'number | missing', { alias: true });
    ce.declare('x', 'maybe_n');
    ce.declare('y', 'number | missing');

    expect(jsCode(ce, ['IsMissing', 'x'])).toBe('Number.isNaN(_.x)');
    expect(jsCode(ce, ['IsMissing', 'x'])).toBe(
      jsCode(ce, ['IsMissing', 'y']).replace(/_\.y/g, '_.x')
    );
    // …and it agrees with the interpreter, which reads a numeric-slot hole as
    // `NaN` (I6).
    const isMissing = compile(ce.box(['IsMissing', 'x'])).run!;
    expect(isMissing({ x: NaN })).toBe(true);
    expect(isMissing({ x: 5 })).toBe(false);
    expect(ce.box(['IsMissing', 'NaN']).evaluate().symbol).toBe('True');
  });

  test('`Coalesce` over an alias of `number | missing` discharges on the NaN axis', () => {
    const ce = new ComputeEngine();
    ce.declareType('maybe_n', 'number | missing', { alias: true });
    ce.declare('x', 'maybe_n');
    ce.declare('y', 'number | missing');

    expect(jsCode(ce, ['Coalesce', 'x', 0])).toBe(
      jsCode(ce, ['Coalesce', 'y', 0]).replace(/_\.y/g, '_.x')
    );
    // NOT the `??` object axis: `NaN ?? 0` is `NaN`, which would disagree.
    expect(jsCode(ce, ['Coalesce', 'x', 0])).not.toMatch(/\?\?/);
    const coalesce = compile(ce.box(['Coalesce', 'x', 0])).run!;
    expect(coalesce({ x: NaN })).toBe(0);
    expect(coalesce({ x: 5 })).toBe(5);
  });

  test('an OBJECT-domain alias still picks the object (null) axis', () => {
    const ce = new ComputeEngine();
    ce.declareType('maybe_s', 'string | missing', { alias: true });
    ce.declare('s', 'maybe_s');
    ce.declare('t', 'string | missing');
    expect(jsCode(ce, ['IsMissing', 's'])).toBe('(_.s === undefined)');
    expect(jsCode(ce, ['IsMissing', 's'])).toBe(
      jsCode(ce, ['IsMissing', 't']).replace(/_\.t/g, '_.s')
    );
    expect(jsCode(ce, ['Coalesce', 's', { str: 'd' }])).toBe(
      jsCode(ce, ['Coalesce', 't', { str: 'd' }]).replace(/_\.t/g, '_.s')
    );
  });

  test('a NOMINAL reference answers the axis from its definition too (D3 is admissibility, not layout)', () => {
    // Reachable: `IsMissing`/`Coalesce` accept `any`, so opacity does not
    // reject the operand upstream — the compiler really does get asked the
    // layout question about a nominal reference.
    const ce = new ComputeEngine();
    ce.declareType('mn', 'number | missing');
    ce.declare('x', 'mn');
    expect(ce.box('x').type.toString()).toBe('mn');
    expect(jsCode(ce, ['IsMissing', 'x'])).toBe('Number.isNaN(_.x)');
    expect(compile(ce.box(['IsMissing', 'x'])).run!({ x: NaN })).toBe(true);
  });
});

describe('PARAMETERIZED NOMINAL — erasure at the INSTANTIATED body', () => {
  //
  // Phase 4 of `docs/TYPE-SYSTEM.md`
  // (§7). Nothing new is claimed: `tree<integer>` erases to whatever the
  // equivalent tuple compiles to, and declines identically where that would.
  // What is new is WHICH body answers — an applied reference unfolds to its
  // definition INSTANTIATED at the application's arguments, so the layout
  // question is asked about `integer`, never about the declaration's `T`.
  //
  test('an applied reference unfolds to the body instantiated at its arguments', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    const resolved = (t: string) =>
      typeToString(resolveTypeForCompilation(ce.type(t as never).type));

    expect(resolved('tree<integer>')).toBe(
      'tuple<value: integer, children: list<tree<integer>>>'
    );
    // One level deep: the recursive occurrence stays an UNEXPANDED reference,
    // instantiated at the same argument — so the walk terminates on a
    // recursive body without a special case.
    expect(resolved('tree<tree<integer>>')).toBe(
      'tuple<value: tree<integer>, children: list<tree<tree<integer>>>>'
    );
    // Two applications of one declaration are two different layouts.
    expect(resolved('tree<string>')).toBe(
      'tuple<value: string, children: list<tree<string>>>'
    );
  });

  test('a generic ALIAS still expands eagerly — no applied node reaches the gate', () => {
    // The regression the design's §3 guards: generic aliases keep their
    // zero-unfold-site property, so `resolveTypeForCompilation` is the
    // identity on one.
    const ce = new ComputeEngine();
    ce.declareType('Pair', 'tuple<T, T>', { alias: true, typeParams: ['T'] });
    const t = ce.type('Pair<number>').type;
    expect(typeof t === 'object' && t.kind).toBe('tuple');
    expect(typeToString(resolveTypeForCompilation(t))).toBe(
      'tuple<number, number>'
    );
  });

  test('the ABSENCE AXIS is chosen at the instantiated type, not at `T`', () => {
    // The gate that actually discriminates: the JavaScript target picks the
    // NaN axis for a numeric-domain hole and the `undefined` axis otherwise,
    // from `isSubtype(resolveTypeForCompilation(t), 'number')`. Without the
    // substitution both instantiations resolve to the bare variable `T`,
    // which is not `<: number` — so `qty<number>` would silently take the
    // OBJECT axis and the compiled `IsMissing` would disagree with the
    // interpreter (I6: a numeric-slot hole reads as `NaN`).
    const ce = new ComputeEngine();
    ce.declareType('qty', 'T', { typeParams: ['T'] });
    ce.declare('a', 'qty<number>');
    ce.declare('b', 'qty<string>');
    ce.declare('n', 'number');
    ce.declare('s', 'string');

    expect(ce.box('a').type.toString()).toBe('qty<number>');
    expect(jsCode(ce, ['IsMissing', 'a'])).toBe(
      jsCode(ce, ['IsMissing', 'n']).replace(/_\.n/g, '_.a')
    );
    expect(jsCode(ce, ['IsMissing', 'a'])).toBe('Number.isNaN(_.a)');
    // The SAME declaration, instantiated at an object-domain argument, takes
    // the other axis — exactly as the inline spelling does.
    expect(jsCode(ce, ['IsMissing', 'b'])).toBe(
      jsCode(ce, ['IsMissing', 's']).replace(/_\.s/g, '_.b')
    );
    expect(jsCode(ce, ['IsMissing', 'b'])).toBe('(_.b === undefined)');

    const isMissing = compile(ce.box(['IsMissing', 'a'])).run!;
    expect(isMissing({ a: NaN })).toBe(true);
    expect(isMissing({ a: 5 })).toBe(false);
  });

  test('`Coalesce` discharges on the instantiated axis', () => {
    const ce = new ComputeEngine();
    ce.declareType('qty', 'T', { typeParams: ['T'] });
    ce.declare('a', 'qty<number>');
    ce.declare('n', 'number');
    expect(jsCode(ce, ['Coalesce', 'a', 0])).toBe(
      jsCode(ce, ['Coalesce', 'n', 0]).replace(/_\.n/g, '_.a')
    );
    // NOT the `??` object axis: `NaN ?? 0` is `NaN`, which would disagree.
    expect(jsCode(ce, ['Coalesce', 'a', 0])).not.toMatch(/\?\?/);
    const coalesce = compile(ce.box(['Coalesce', 'a', 0])).run!;
    expect(coalesce({ a: NaN })).toBe(0);
    expect(coalesce({ a: 5 })).toBe(5);
  });

  test('a value at an instantiated nominal type erases like the inline spelling', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    ce.declare('t', 'tree<integer>');
    ce.declare('u', 'tuple<value: integer, children: list<tree<integer>>>');
    // A tuple is an object-domain layout at either spelling.
    expect(jsCode(ce, ['IsMissing', 't'])).toBe(
      jsCode(ce, ['IsMissing', 'u']).replace(/_\.u/g, '_.t')
    );
    expect(jsCode(ce, ['IsMissing', 't'])).toBe('(_.t === undefined)');
  });

  test('a construction at a parameterized nominal compiles like the plain value', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    expect(ce.box(['tree', 1, ['List']]).type.toString()).toBe(
      'tree<finite_integer>'
    );
    expect(jsCode(ce, ['tree', 1, ['List']])).toBe(
      jsCode(ce, ['Tuple', 1, ['List']])
    );
    expect(jsCode(ce, ['tree', 1, ['List']])).toBe('[1, []]');

    // A 3-deep tree — every level erases, and the compiled value is the plain
    // nested one.
    const deep = (ctor: string) => [
      ctor,
      1,
      ['List', [ctor, 2, ['List', [ctor, 3, ['List']]]]],
    ];
    expect(jsCode(ce, deep('tree'))).toBe(jsCode(ce, deep('Tuple')));
    expect(compile(ce.box(deep('tree') as never)).run!({})).toEqual([
      1,
      [[2, [[3, []]]]],
    ]);
  });

  test('GLSL: a parameterized tuple body is the target `vecN`, and declines identically', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<T, T>', { typeParams: ['T'] });
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    ce.declare('q', 'tuple<number, number>');
    expect(glslCode(ce, ['pt', 'x', 'y'])).toBe(
      glslCode(ce, ['Tuple', 'x', 'y'])
    );
    expect(glslCode(ce, ['pt', 'x', 'y'])).toBe('vec2(x, y)');
    // A `vecN` component must be a scalar: a tuple of tuples has no shader
    // lowering, at either spelling.
    expect(glslCode(ce, ['pt', 'q', 'q'])).toBe(
      glslCode(ce, ['Tuple', 'q', 'q'])
    );
    expect(glslCode(ce, ['pt', 'q', 'q'])).toBe('DECLINE');
  });

  test('DECLINES cleanly where the plain shape declines — never throws', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    ce.declare('x', 'number');
    expect(() =>
      compile(ce.box(['tree', 1, ['List', ['Unknown9', 'x']]]))
    ).not.toThrow();
    expect(jsCode(ce, ['tree', 1, ['List', ['Unknown9', 'x']]])).toBe(
      jsCode(ce, ['Tuple', 1, ['List', ['Unknown9', 'x']]])
    );
    expect(jsCode(ce, ['tree', 1, ['List', ['Unknown9', 'x']]])).toBe('');
  });
});

describe('BOUNDARY MARSHALLING — the current world (§4.6 step 4)', () => {
  // FINDING (2026-08-01): no compiled-kernel seam can carry a nominal type
  // end to end today, so no unwrap/re-tag machinery is built.
  //
  //   - `CompilationResult` carries no signature: `calling`, `run`, `code`,
  //     `freeSymbols`, `unsupported`, `error` — a consumer holding one has no
  //     static result type to re-tag FROM.
  //   - Every boxed→raw seam is runtime-shape driven and numeric-only: the
  //     auto-compile/drain paths require `isNumber(item)` and push `item.re`
  //     (`library/map-auto-compile.ts`), or are gated on
  //     `type.matches('collection<real>')` (`library/collections.ts` Reduce).
  //     A tagged value is an APPLICATION, and a nominal type matches neither
  //     `real` nor `number` (opacity, D3), so neither gate ever admits one.
  //
  // ACTIVATION POINT: when a compiled entry point gains a declared signature
  // whose parameter or result type is nominal, unwrap-on-input /
  // re-tag-on-result belongs at that seam — skipping it would silently
  // launder a `point` into a tuple across the compile boundary. The pins
  // below record what the boundary does until then.
  test('a compiled kernel yields the RAW payload; the tag lives on the engine side', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    ce.declareType('point', 'tuple<number, number>');
    // Engine side: the tag survives evaluation (that IS nominal-ness).
    expect(ce.box(['meters', 5]).evaluate().toString()).toBe('meters(5)');
    expect(ce.box(['point', 1, 2]).evaluate().toString()).toBe('point(1, 2)');
    // Compiled side: erased, and NOT re-tagged on the way out.
    expect(compile(ce.box(['meters', 5])).run!({})).toBe(5);
    expect(compile(ce.box(['point', 1, 2])).run!({})).toEqual([1, 2]);
  });

  test('a nominal-typed collection is not admitted by the auto-compile seam', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    const list = ce.box(['List', ['meters', 1], ['meters', 2]]);
    // The drain/auto-compile gates are numeric: a tagged element is not a
    // number literal, so the interpreter keeps the values (tags intact).
    expect(list.evaluate().toString()).toBe('[meters(1),meters(2)]');
  });
});

//
// A NOMINAL-TYPED ARGUMENT IS ATOMIC at a compiled user-function call site —
// ruled 2026-08-12 (context in
// `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md`), matching the
// interpreter and the pre-existing TUPLE precedent.
//
// The two halves of the design pull in opposite directions at a call site:
// D3 makes a nominal OPAQUE, so the interpreter binds the whole tagged value
// and never looks through it; D11 ERASES the tag, so `bag([1,2,3])` reaches
// the emitted call as a bare JS array. The JS call-site broadcast
// (`_SYS.bcastFn`) dispatches on `Array.isArray` at RUN time, so it used to
// map the callee over that array — `size(bag([1,2,3]))` answering
// `[42,42,42]` where the interpreter answers `42`.
//
// The carve-out keys on the argument's STATIC type, never on its expression
// shape, and is deliberately narrow: opaque nominals, plus the transparent
// alias a sugar-declared SUM is (every arm of one is a nominal, so every
// runtime value is atomic). A plain `type alias` is NOT covered — the
// interpreter does look through those, and does broadcast over them.
//
describe('NOMINAL ATOMICITY at a user-function call site (ruled 2026-08-12)', () => {
  /** The `bag`/`size` repro, in one engine. */
  const bagEngine = (): ComputeEngine => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type bag = list<number>
       function size(b: bag) -> number { 42 }`
    );
    expect(r.diagnostics.map((d) => String(d.message))).toEqual([]);
    return ce;
  };

  test('the repro: a constructor-literal argument is bound whole, not mapped', () => {
    const ce = bagEngine();
    const expr = ce.box(['size', ['bag', ['List', 1, 2, 3]]] as never);
    // The interpreter binds the tagged value whole (D3 opacity).
    expect(expr.evaluate().re).toBe(42);
    // The call has no free variables, so compile-time constant folding would
    // emit its value (42) instead of the call these tests pin; off here.
    const r = compile(expr, { fallback: false, constantFold: false });
    // …and so does the emitted call: no runtime broadcast dispatch at all.
    expect(r.code).toBe('_fn_size([1, 2, 3])');
    expect(r.code).not.toContain('bcastFn');
    expect(r.run!({})).toBe(42);
  });

  test('keyed on the static TYPE, not the expression shape: a bag-typed VARIABLE', () => {
    const ce = bagEngine();
    ce.declare('b', 'bag');
    const r = compile(ce.box(['size', 'b'] as never), { fallback: false });
    expect(r.code).toBe('_fn_size(_.b)');
    expect(r.code).not.toContain('bcastFn');
    expect(r.run!({ b: [1, 2, 3] })).toBe(42);
  });

  test('a plain TRANSPARENT alias still broadcasts — the carve-out is not over-broad', () => {
    // `type alias mylist = list<number>` is looked THROUGH by the interpreter,
    // so `q(L)` maps `q` element-wise. Pinning the pre-existing correct
    // behavior: the carve-out must not swallow it.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(ce, 'type alias mylist = list<number>');
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    ce.box([
      'Assign',
      'q',
      ['Function', ['Add', ['Multiply', 4, 't'], 1], 't'],
    ] as never).evaluate();
    // The interpreter's answer for the same values.
    expect(ce.box(['q', ['List', 1, 2, 3]] as never).evaluate().toString()).toBe(
      '[5,9,13]'
    );
    ce.declare('L', 'mylist');
    expect(ce.box('L').type.toString()).toBe('mylist');
    const r = compile(ce.box(['q', 'L'] as never), { fallback: false });
    expect(r.code).toContain('_SYS.bcastFn');
    expect(r.run!({ L: [1, 2, 3] })).toEqual([5, 9, 13]);
  });

  test('an ERASED-policy sum with a list-payload variant is atomic too', () => {
    // `jarr(list<json>)` erases to a bare JS array under the erased policy —
    // exactly the shape `bcastFn` would map. Both the variant type (`jarr`,
    // an opaque nominal) and the sum type (`json`, the transparent alias
    // carrying `_sumVariants`) must read as atomic.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(
      ce,
      `type json = jnull | jbool(boolean) | jnum(number) | jstr(string) | jarr(list<json>)
       function kind(v: json) -> number { 7 }`
    );
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);

    const expr = ce.box([
      'kind',
      ['jarr', ['List', ['jnum', 1], ['jnum', 2]]],
    ] as never);
    expect(expr.evaluate().re).toBe(7);
    // Constant folding off: this pins the emitted call, not its value.
    const r = compile(expr, { fallback: false, constantFold: false });
    expect(r.code).toBe('_fn_kind([1, 2])');
    expect(r.code).not.toContain('bcastFn');
    expect(r.run!({})).toBe(7);

    // …and through a `json`-typed variable (the sum alias, not the variant).
    ce.declare('v', 'json');
    const r2 = compile(ce.box(['kind', 'v'] as never), { fallback: false });
    expect(r2.code).toBe('_fn_kind(_.v)');
    expect(r2.code).not.toContain('bcastFn');
    expect(r2.run!({ v: [1, 2] })).toBe(7);
  });

  test('a SCALAR-wrapping nominal keeps the direct path', () => {
    // `meters` was never mapped at run time (`5` is not an array), so this
    // one only loses a dead dispatch — but it must still be correct.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(
      ce,
      `type meters = number
       function f(m: meters) -> number { 3 }`
    );
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    const expr = ce.box(['f', ['meters', 5]] as never);
    expect(expr.evaluate().re).toBe(3);
    // Constant folding off: this pins the emitted call, not its value.
    const r = compile(expr, { fallback: false, constantFold: false });
    expect(r.code).toBe('_fn_f(5)');
    expect(r.code).not.toContain('bcastFn');
    expect(r.run!({})).toBe(3);
  });

  test('MIXED arguments: the carve-out is all-or-nothing, like the tuple one', () => {
    // One nominal argument puts the WHOLE call on the direct path — the same
    // all-or-nothing shape the `isTuple` clause has always had.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(
      ce,
      `type bag = list<number>
       function g(x: number, b: bag) -> number { x + 1 }`
    );
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    const expr = ce.box(['g', 10, ['bag', ['List', 1, 2, 3]]] as never);
    expect(expr.evaluate().re).toBe(11);
    // Constant folding off: this pins the emitted call, not its value.
    const r = compile(expr, { fallback: false, constantFold: false });
    expect(r.code).toBe('_fn_g(10, [1, 2, 3])');
    expect(r.code).not.toContain('bcastFn');
    expect(r.run!({})).toBe(11);
  });

  test('a `broadcastable<T>` slot the nominal SATISFIES no longer fails closed', () => {
    // `checkDeclaredBroadcast` runs just ahead of the call-site gate and used
    // to decline here, contradicting the carve-out: the argument it called
    // "possibly mapped" is atomic. Exempt on the same terms as an atomic
    // tuple — only when the slot's element contract admits it.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(ce, 'type bag = list<number>');
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    ce.declare('h', { type: '(broadcastable<bag>) -> number' });
    ce.assign('h', ce.box(['Function', 5, 'u'] as never));
    expect(
      ce.box(['h', ['bag', ['List', 1, 2, 3]]] as never).evaluate().re
    ).toBe(5);
    ce.declare('B', 'bag');
    const r = compile(ce.box(['h', 'B'] as never), { fallback: false });
    expect(r.code).toBe('_fn_h(_.B)');
    expect(r.run!({ B: [1, 2, 3] })).toBe(5);
  });

  test('…but a `broadcastable<T>` slot the nominal REFUTES still fails closed', () => {
    const ce = new ComputeEngine();
    const r0 = executeEpsil(ce, 'type bag = list<number>');
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    ce.declare('k', { type: '(broadcastable<number>) -> number' });
    ce.assign('k', ce.box(['Function', ['Add', 'u', 1], 'u'] as never));
    ce.declare('B', 'bag');
    // The interpreter answers `incompatible-type`; no emitted form says that.
    expect(
      ce.box(['k', ['bag', ['List', 1, 2, 3]]] as never).evaluate().toString()
    ).toContain('incompatible-type');
    expect(() =>
      compile(ce.box(['k', 'B'] as never), { fallback: false })
    ).toThrow(/broadcastable<T>/);
  });
});
