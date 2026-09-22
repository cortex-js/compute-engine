/**
 * A WRITTEN absence symbol in a compiled expression (2026-09-22).
 *
 * `Missing` and `Undefined` are values, not inputs the caller supplies. They
 * used to fall through to the compiler's free-symbol read, so a compiled
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
  test.each([['Missing'], ['Undefined']])(
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

  test.each([['Missing'], ['Undefined']])(
    'a %s inside an expression reports no free symbol either',
    (name) => {
      expect(js(['IsMissing', name]).freeSymbols).toEqual([]);
      expect(js(['Coalesce', name, 2]).freeSymbols).toEqual([]);
      expect(js(['Median', ['List', 1, name, 3]]).freeSymbols).toEqual([]);
    }
  );
});

describe('the discharge primitives answer what the interpreter answers', () => {
  test.each([['Missing'], ['Undefined']])('IsMissing(%s) is true', (name) => {
    expect(js(['IsMissing', name]).run!({})).toBe(true);
    expect(ce.box(['IsMissing', name]).evaluate().symbol).toBe('True');
  });

  test.each([['Missing'], ['Undefined']])('Coalesce(%s, 2) is 2', (name) => {
    expect(js(['Coalesce', name, 2]).run!({})).toBe(2);
    expect(ce.box(['Coalesce', name, 2]).evaluate().re).toBe(2);
  });
});

describe('an absent cell reaches the statistics reducers as absent', () => {
  // `Array.prototype.sort` moves an `undefined` element to the END of the
  // array without calling the comparator, so an un-normalized absent cell
  // shifted the median instead of poisoning it: `Median([1, Missing, 3])` was
  // `3`.
  test.each([['Missing'], ['Undefined']])(
    'Median([1, %s, 3]) is NaN',
    (name) => {
      const r = js(['Median', ['List', 1, name, 3]]);
      expect(r.success).toBe(true);
      expect(Number.isNaN(r.run!({}) as number)).toBe(true);
      expect(ce.box(['Median', ['List', 1, name, 3]]).evaluate().isNaN).toBe(
        true
      );
    }
  );

  test.each([['Missing'], ['Undefined']])('Mean([1, %s, 3]) is NaN', (name) => {
    expect(Number.isNaN(js(['Mean', ['List', 1, name, 3]]).run!({}))).toBe(
      true
    );
  });

  // Normalizing the cell to `NaN` and reducing anyway was not enough: the
  // sorting reducers select a middle element, so an absent cell at either END
  // left an ordinary number. The reducers now answer absent BEFORE they run.
  test.each([
    [0, 'Missing'],
    [1, 'Missing'],
    [2, 'Missing'],
    [0, 'Undefined'],
    [1, 'Undefined'],
    [2, 'Undefined'],
  ])('Median with the absent cell at position %i (%s) is NaN', (at, name) => {
    const cells: any[] = [1, 2, 3];
    cells[at as number] = name;
    const expr = ['Median', ['List', ...cells]];
    expect(Number.isNaN(js(expr).run!({}) as number)).toBe(true);
    expect(ce.box(expr).evaluate().isNaN).toBe(true);
  });

  // A HOLE in a sparse array the caller supplies is absent too. The scan is
  // an index loop, not `Array.prototype.some`, which skips holes.
  describe('a hole in a caller-supplied array', () => {
    function overList(head: string) {
      const listEngine = new ComputeEngine();
      listEngine.declare('L', 'list<number>');
      const r = compile(listEngine.box([head, 'L']), { fallback: false })!;
      expect(r.success).toBe(true);
      return r;
    }
    const sparse: any[] = [1, , 3];

    test('Median of an array with a hole is NaN', () => {
      expect(Number.isNaN(overList('Median').run!({ L: sparse } as any))).toBe(
        true
      );
    });

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
        ce.box(['Quartiles', ['List', 1, 'NaN', 3]]).evaluate().toString()
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
  test.each([['Missing'], ['Undefined']])(
    'a bare %s operand answers the reducer absent result',
    (name) => {
      expect(Number.isNaN(js(['Mean', name]).run!({}) as number)).toBe(true);
      expect(Number.isNaN(js(['Median', name]).run!({}) as number)).toBe(true);
      const q = js(['Quartiles', name]).run!({}) as number[];
      expect(q).toHaveLength(3);
      expect(q.every((x) => Number.isNaN(x))).toBe(true);
    }
  );
});

describe('an absent operand in a numeric slot still answers NaN', () => {
  test.each([['Missing'], ['Undefined']])('Cos(%s) is NaN', (name) => {
    expect(Number.isNaN(js(['Cos', name]).run!({}) as number)).toBe(true);
  });

  test.each([['Missing'], ['Undefined']])('%s + 1 is NaN', (name) => {
    expect(Number.isNaN(js(['Add', name, 1]).run!({}) as number)).toBe(true);
  });
});

describe('an absent list cell stays distinct from a NaN cell', () => {
  // The whole-collection equality rule of 2026-09-21: an absent cell can stand
  // for any value, so a pair of collections holding one is UNDECIDED (the
  // compiled marker is `NaN`), while a `NaN` cell is a number that equals
  // nothing and decides the comparison `false`.
  test('Equal([1, Missing], [1, Missing]) is the undecided marker', () => {
    const r = js(['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']]);
    expect(r.success).toBe(true);
    expect(Number.isNaN(r.run!({}) as number)).toBe(true);
  });

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
    const r = compile(ce.box(['Cos', 'Missing']), {
      to: 'glsl',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    expect(r.code).toBe('cos(_gpu_nan())');
    expect(r.freeSymbols).toEqual([]);
    // The preamble scan reads the EMITTED code, so the helper the marker calls
    // is declared with it — a shader that calls an undeclared function does
    // not compile in the driver.
    expect(r.preamble).toContain('float _gpu_nan()');
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
    expect(coalesced.run!({})).toEqual({ lo: 7, hi: 7 });
  });
});
