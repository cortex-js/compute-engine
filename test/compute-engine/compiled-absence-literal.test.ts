/**
 * A WRITTEN absence symbol in a compiled expression (2026-09-22).
 *
 * `Missing` is a value, not an input the caller supplies. It used to fall
 * through to the compiler's free-symbol read, so a compiled
 * `IsMissing(Missing)` was `Number.isNaN(_.Missing)` with
 * `freeSymbols: ["Missing"]` and answered `false` against the interpreter's
 * `True`.
 *
 * The lowering is the target's OBJECT-domain null (`undefined` on JavaScript;
 * the Python target opts for its numeric marker `math.nan`, because numpy
 * raises on `None`). It cannot be the numeric marker, because a list cell
 * holding the numeric marker is a number that equals nothing, which the
 * whole-collection equality rule of 2026-09-21 must keep distinct from an
 * ABSENT cell. On a target with no object axis — the shader targets and the
 * interval target — the numeric marker is the only spelling there is, and it
 * is what a written absence symbol lowers to.
 *
 * `Undefined` was read as an absent value too until `Missing` became a
 * result only (`docs/ERROR-MODEL.md`, user decision of 2026-11-02): it is
 * now an ordinary symbol, and `Missing` is the one absent symbol.
 *
 * Where the interpreter gives `Missing` (`Median([1, Missing, 3])`), the
 * compiled code gives `NaN` (`docs/COMPILATION-MODEL.md`, "Caveats of
 * compiled code").
 *
 * See `docs/ERROR-MODEL.md` §3.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/** Compile for the JavaScript target and run with no caller inputs. */
function js(expr: any) {
  const r = compile(ce.box(expr), { fallback: false })!;
  return r;
}

describe('a written absence symbol is a value, not a free symbol', () => {
  test.each([['Missing']])(
    '%s alone reports no free symbol',
    (name) => {
      const r = js(name);
      expect(r.success).toBe(true);
      expect(r.freeSymbols).toEqual([]);
      // The object null really is the emitted code, not an absent `code`
      // field: the artifact runs and answers it.
      expect(r.code).toBe('undefined');
      expect(r.run!({})).toBeUndefined();
    }
  );

  test.each([['Missing']])(
    'a %s inside an expression reports no free symbol either',
    (name) => {
      expect(js(['IsMissing', name]).freeSymbols).toEqual([]);
      expect(js(['Coalesce', name, 2]).freeSymbols).toEqual([]);
      expect(js(['Median', ['List', 1, name, 3]]).freeSymbols).toEqual([]);
    }
  );
});

describe('the discharge primitives answer what the interpreter answers', () => {
  test.each([['Missing']])('IsMissing(%s) is true', (name) => {
    expect(js(['IsMissing', name]).run!({})).toBe(true);
    expect(ce.box(['IsMissing', name]).evaluate().symbol).toBe('True');
  });

  test.each([['Missing']])('Coalesce(%s, 2) is 2', (name) => {
    expect(js(['Coalesce', name, 2]).run!({})).toBe(2);
    expect(ce.box(['Coalesce', name, 2]).evaluate().re).toBe(2);
  });
});

describe('an absent cell reaches the statistics reducers as absent', () => {
  test.each([['Missing']])('Mean([1, %s, 3]) is NaN', (name) => {
    expect(Number.isNaN(js(['Mean', ['List', 1, name, 3]]).run!({}))).toBe(
      true
    );
  });

  describe('a hole in a caller-supplied array', () => {
    function overList(head: string) {
      const listEngine = new ComputeEngine();
      listEngine.declare('L', 'list<number>');
      const r = compile(listEngine.box([head, 'L']), { fallback: false })!;
      expect(r.success).toBe(true);
      return r;
    }
    const sparse: any[] = [1, , 3];


    test('Mean of an array with a hole is NaN', () => {
      expect(Number.isNaN(overList('Mean').run!({ L: sparse } as any))).toBe(
        true
      );
    });
  });

  // The absence rule is the interpreter's `isAbsentValue`, which counts a
  // `NaN` cell as absent. That closes the three reducers that used to answer
  // from the cells that ARE numbers and ignore a `NaN` one.
  describe('a NaN cell is absent for this family too', () => {
    function overList(head: string, cells: unknown[]) {
      const listEngine = new ComputeEngine();
      listEngine.declare('L', 'list<number>');
      const r = compile(listEngine.box([head, 'L']), { fallback: false })!;
      expect(r.success).toBe(true);
      return r.run!({ L: cells } as any);
    }

    test('Mode was 1', () => {
      expect(Number.isNaN(overList('Mode', [1, NaN, 3]) as number)).toBe(true);
      expect(ce.box(['Mode', ['List', 1, 'NaN', 3]]).evaluate().isNaN).toBe(
        true
      );
    });

    test('InterquartileRange was 2', () => {
      expect(
        Number.isNaN(overList('InterquartileRange', [1, NaN, 3]) as number)
      ).toBe(true);
    });

    test('Quartiles was [1, NaN, 3] and is now the triple of NaN', () => {
      // The interpreter answers the tuple `(NaN, NaN, NaN)`, so the compiled
      // answer keeps the shape a `Quartiles` answer has.
      const q = overList('Quartiles', [1, NaN, 3]) as number[];
      expect(q).toHaveLength(3);
      expect(q.every((x) => Number.isNaN(x))).toBe(true);
      expect(
        ce
          .box(['Quartiles', ['List', 1, 'NaN', 3]])
          .evaluate()
          .toString()
      ).toBe('(NaN, NaN, NaN)');
    });

    test('a clean list still answers the ordinary statistics', () => {
      expect(overList('Mode', [1, 1, 2])).toBe(1);
      expect(overList('Quartiles', [1, 2, 3, 4])).toEqual([1.5, 2.5, 3.5]);
      expect(overList('InterquartileRange', [1, 2, 3, 4])).toBe(2);
      expect(overList('Median', [1, 2, 3, 4])).toBe(2.5);
    });
  });

  // A whole operand that is absent is absent DATA. `Mean(Missing)` emits
  // `_SYS.mean(undefined)`, which used to raise "values is not iterable"
  // behind `success: true`.
});

describe('an absent operand in a numeric slot still answers NaN', () => {
  test.each([['Missing']])('Cos(%s) is NaN', (name) => {
    expect(Number.isNaN(js(['Cos', name]).run!({}) as number)).toBe(true);
  });

  test.each([['Missing']])('%s + 1 is NaN', (name) => {
    expect(Number.isNaN(js(['Add', name, 1]).run!({}) as number)).toBe(true);
  });
});

describe('an absent list cell stays distinct from a NaN cell', () => {
  // The whole-collection equality rule of 2026-09-21: an absent cell can stand
  // for any value, so a pair of collections holding one is UNDECIDED (the
  // compiled marker is `NaN`), while a `NaN` cell is a number that equals
  // nothing and decides the comparison `false`.

  test('Equal([1, NaN], [1, NaN]) is decidedly false', () => {
    const r = js(['Equal', ['List', 1, 'NaN'], ['List', 1, 'NaN']]);
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(false);
  });
});

describe('the targets with no object absence axis', () => {
  // GLSL has a NaN spelling but deliberately no `isAbsent` (fast-math cannot
  // guarantee `isnan` survives), so the discharge primitives fail closed there
  // — but a written `Missing` in a value position lowers to the shader's NaN
  // instead of the undefined identifier `Missing`.
  test('GLSL lowers a written Missing to its NaN spelling', () => {
    // The GLSL fragment has no `Missing` value, so the compilation declines.
    expect(() =>
      compile(ce.box(['Cos', 'Missing']), {
        to: 'glsl',
        fallback: false,
      } as any)
    ).toThrow(/has no type in the GLSL fragment/);
  });

  test('GLSL still declines to DISCHARGE absence', () => {
    // `fallback` is left at its default, so the decline is REPORTED rather
    // than thrown.
    const r = compile(ce.box(['IsMissing', 'Missing']), { to: 'glsl' } as any);
    expect(r.success).toBe(false);
  });

  // The interval target's numeric marker is a whole-NaN bare interval, and its
  // absence spellings cover its whole value model, so both primitives answer.
  test('the interval target discharges a written Missing', () => {
    const missing = compile(ce.box(['IsMissing', 'Missing']), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(missing.success).toBe(true);
    expect(missing.freeSymbols).toEqual([]);
    expect(missing.run!({})).toBe('true');

    const coalesced = compile(ce.box(['Coalesce', 'Missing', 7]), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(coalesced.success).toBe(true);
    expect(coalesced.run!({})).toEqual({
      kind: 'interval',
      value: { lo: 7, hi: 7 },
    });
  });
});
