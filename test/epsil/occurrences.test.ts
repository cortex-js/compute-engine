import { parseEpsil } from '../../src/epsil/parse-epsil';
import {
  documentBindings,
  isNameVisibleAt,
  occurrenceAt,
  unresolvedLabels,
  type BindingGroup,
} from '../../src/epsil/occurrences';

//
// Scope-aware occurrence resolution over the raw Epsil AST — the analysis
// behind the editor's go-to-definition, find-references, occurrence
// highlighting, and rename. The properties pinned here are the ones a rename
// depends on: occurrences group by BINDING (a shadowing `let x` does not
// join the outer `x`), synthesized parser nodes never surface (they borrow
// spans they do not spell), and every binder form the parser produces —
// parameters, tuple patterns, loop variables, match-arm patterns, function
// clauses — claims exactly its own uses.
//

function groupsOf(source: string): BindingGroup[] {
  const [ast] = parseEpsil(source);
  return documentBindings(ast, source);
}

/** The offset of the `n`-th (0-based) occurrence of `needle` in `source`. */
function at(source: string, needle: string, n = 0): number {
  let offset = -1;
  for (let i = 0; i <= n; i++) {
    offset = source.indexOf(needle, offset + 1);
    if (offset < 0) throw new Error(`"${needle}" #${n} not in source`);
  }
  return offset;
}

/** A group's occurrences as `spelling@offset`, in source order. */
function spans(source: string, group: BindingGroup): string[] {
  return group.occurrences.map(
    (o) => `${source.slice(o.start, o.end)}@${o.start}`
  );
}

/** The group owning the occurrence at `offset`, which must exist. */
function groupAt(
  groups: readonly BindingGroup[],
  offset: number
): BindingGroup {
  const found = occurrenceAt(groups, offset);
  if (found === undefined) throw new Error(`no occurrence at ${offset}`);
  return found.group;
}

/** A group's occurrences as `role:slice` strings, in source order. */
function shape(source: string, group: BindingGroup): string[] {
  return group.occurrences.map(
    (o) => `${o.role}:${source.slice(o.start, o.end)}@${o.start}`
  );
}

describe('EPSIL OCCURRENCES — shadowing', () => {
  // Interpreter-verified ground truth: this program evaluates to 3, i.e.
  // `let y = x` reads the OUTER `x` even though a `let x` follows in the
  // same block (visibility starts after the `let` statement).
  const SRC =
    'let x = 1\nfunction f() {\n let y = x\n let x = 2\n x + y\n}\nf()';

  test('a use above a shadowing let binds outward', () => {
    const groups = groupsOf(SRC);
    const outer = groupAt(groups, at(SRC, 'x'));
    const readBeforeShadow = at(SRC, 'x', 1); // the x in `let y = x`
    expect(groupAt(groups, readBeforeShadow)).toBe(outer);
    expect(shape(SRC, outer)).toEqual([
      `definition:x@${at(SRC, 'x')}`,
      `read:x@${readBeforeShadow}`,
    ]);
  });

  test('the shadowing let claims the uses after it', () => {
    const groups = groupsOf(SRC);
    const inner = groupAt(groups, at(SRC, 'let x = 2') + 4);
    expect(inner).not.toBe(groupAt(groups, at(SRC, 'x')));
    expect(inner.occurrences).toHaveLength(2); // its definition + `x + y`
    expect(inner.occurrences[1].role).toBe('read');
  });

  test('a local is not visible outside its scope', () => {
    const groups = groupsOf(SRC);
    expect(isNameVisibleAt(groups, 'y', SRC.length - 1)).toBe(false);
    expect(isNameVisibleAt(groups, 'x', SRC.length - 1)).toBe(true);
  });
});

describe('EPSIL OCCURRENCES — parameters and lambdas', () => {
  test('a lambda parameter does not join the outer binding of its name', () => {
    const src = 'let a = 1\nlet g = (a, b) => a * b\ng(a, 2)';
    const groups = groupsOf(src);
    const outer = groupAt(groups, at(src, 'a'));
    const param = groupAt(groups, at(src, '(a, b)') + 1);
    expect(param).not.toBe(outer);
    expect(param.kind).toBe('parameter');
    // The body's `a * b` reads the parameter; the call's `g(a, 2)` reads the
    // outer `a`.
    expect(groupAt(groups, at(src, 'a * b'))).toBe(param);
    expect(groupAt(groups, at(src, 'g(a, 2)') + 2)).toBe(outer);
  });

  test('a tuple-destructuring parameter binds each name', () => {
    const src = '((p, q)) => p + q';
    const groups = groupsOf(src);
    const p = groupAt(groups, at(src, 'p'));
    expect(p.kind).toBe('parameter');
    expect(shape(src, p)).toEqual([
      `definition:p@${at(src, 'p')}`,
      `read:p@${at(src, 'p + q')}`,
    ]);
  });

  test('a let with a tuple pattern binds each name', () => {
    const src = 'let (a, b) = pt\na + b';
    const groups = groupsOf(src);
    const a = groupAt(groups, at(src, 'a'));
    expect(a.kind).toBe('variable');
    expect(a.occurrences.map((o) => o.role)).toEqual(['definition', 'read']);
    expect(groupAt(groups, at(src, 'pt')).kind).toBe('free');
  });
});

describe('EPSIL OCCURRENCES — loops and match arms', () => {
  test('a for-loop variable shadows without joining, and ends with the loop', () => {
    const src = 'let i = 9\nfor i in 1..3 { i + 1 }\ni';
    const groups = groupsOf(src);
    const outer = groupAt(groups, at(src, 'i'));
    const loop = groupAt(groups, at(src, 'for i') + 4);
    expect(loop).not.toBe(outer);
    expect(loop.kind).toBe('loop');
    expect(groupAt(groups, at(src, 'i + 1'))).toBe(loop);
    expect(groupAt(groups, src.length - 1)).toBe(outer);
  });

  test('match-arm patterns bind their variables in the arm only', () => {
    const src = 'match v { (0, y) => y\n (x, _) => x }';
    const groups = groupsOf(src);
    const y = groupAt(groups, at(src, 'y'));
    expect(y.kind).toBe('pattern');
    expect(shape(src, y)).toEqual([
      `definition:y@${at(src, 'y')}`,
      `read:y@${at(src, 'y', 1)}`,
    ]);
    const x = groupAt(groups, at(src, 'x'));
    expect(x.occurrences).toHaveLength(2);
    // The wildcard `_` never becomes a group.
    expect(groups.some((g) => g.name === '_')).toBe(false);
    expect(groupAt(groups, at(src, 'v')).kind).toBe('free');
  });
});

describe('EPSIL OCCURRENCES — function definitions', () => {
  test('multi-clause definitions join one group; literal params never surface', () => {
    const src = 'fib(0) = 0\nfib(n) = fib(n - 1)\nfib(9)';
    const groups = groupsOf(src);
    const fib = groupAt(groups, at(src, 'fib'));
    expect(fib.kind).toBe('function');
    expect(fib.occurrences.map((o) => o.role)).toEqual([
      'definition',
      'definition',
      'read', // the recursive call
      'read', // fib(9)
    ]);
    // The desugared literal parameter (`literalParam_1`) borrows the span of
    // `0` and must not appear.
    expect(groups.some((g) => g.name.startsWith('literalParam'))).toBe(false);
  });

  test('a call above the definition resolves to it', () => {
    const src = 'twice(3)\ntwice(x) = 2 * x';
    const groups = groupsOf(src);
    expect(groupAt(groups, at(src, 'twice'))).toBe(
      groupAt(groups, at(src, 'twice', 1))
    );
    expect(groupAt(groups, at(src, 'twice')).kind).toBe('function');
  });
});

describe('EPSIL OCCURRENCES — spelling guard and special forms', () => {
  test('synthesized nodes never surface as occurrences', () => {
    // `let x = 3` desugars through a `value` key symbol spanning the whole
    // statement; the spelling guard keeps it out.
    const groups = groupsOf('let x = 3');
    expect(groups.map((g) => g.name)).toEqual(['x']);
  });

  test('a verbatim symbol groups with its plain occurrences, spans including backticks', () => {
    const src = 'let `while` = 1\n`while` + 2';
    const groups = groupsOf(src);
    const w = groupAt(groups, at(src, '`while`') + 1);
    expect(w.occurrences).toHaveLength(2);
    expect(src.slice(w.occurrences[1].start, w.occurrences[1].end)).toBe(
      '`while`'
    );
  });

  test('an assignment declares on first sight and writes thereafter', () => {
    const src = 'z = 1\nz = 2\nz + 1';
    const groups = groupsOf(src);
    const z = groupAt(groups, 0);
    expect(z.occurrences.map((o) => o.role)).toEqual([
      'definition',
      'write',
      'read',
    ]);
  });

  test('a string interpolation hole is a real occurrence', () => {
    const src = 'let x = 1\n"value: \\(x)"';
    const groups = groupsOf(src);
    const x = groupAt(groups, at(src, 'x'));
    expect(x.occurrences.map((o) => o.role)).toEqual(['definition', 'read']);
  });

  test('a typed match pattern yields ONE occurrence per span', () => {
    // `x: number` in pattern position desugars into a pattern variable AND an
    // implicit type-guard `Element` whose operand sits at the same span; a
    // duplicate would become overlapping rename edits.
    const src = 'match v { x: number => x }';
    const groups = groupsOf(src);
    const x = groupAt(groups, at(src, 'x'));
    expect(shape(src, x)).toEqual([
      `definition:x@${at(src, 'x')}`,
      `read:x@${at(src, 'x', 1)}`,
    ]);
  });

  test('a match rest capture binds its name, anchored past the ellipsis', () => {
    const src = 'match v { (1, ...rest) => rest }';
    const groups = groupsOf(src);
    const rest = groupAt(groups, at(src, 'rest'));
    expect(rest.kind).toBe('pattern');
    expect(shape(src, rest)).toEqual([
      `definition:rest@${at(src, 'rest')}`,
      `read:rest@${at(src, 'rest', 1)}`,
    ]);
  });

  test('a glyph alias occurrence groups under its cooked name', () => {
    // `π` lexes to the symbol `Pi` while keeping the glyph's 1-character
    // span; the lex-based spelling fallback keeps it as an occurrence.
    const src = 'let f = (t) => π * t';
    const groups = groupsOf(src);
    const pi = groups.find((g) => g.name === 'Pi');
    expect(pi?.kind).toBe('free');
    expect(pi?.occurrences).toHaveLength(1);
    expect(src.slice(pi!.occurrences[0].start, pi!.occurrences[0].end)).toBe(
      'π'
    );
  });

  test('a sum-type declaration is a type-kind group, not a free read', () => {
    const src = 'type res = ok(v: res) | err';
    const groups = groupsOf(src);
    const res = groupAt(groups, at(src, 'res'));
    expect(res.kind).toBe('type');
    // The declaration, and the recursive use inside the `ok` payload. The
    // variant names `ok` and `err` and the field label `v` are not uses.
    expect(spans(src, res)).toEqual(['res@5', 'res@17']);
  });

  test('a multi-clause declaration span covers every clause', () => {
    const src = 'fib(0) = 0\nfib(n) = fib(n - 1)\nfib(9)';
    const groups = groupsOf(src);
    const fib = groupAt(groups, at(src, 'fib'));
    // From the first clause's start to the last clause's end — the outline
    // range must contain a declaration inside ANY clause's body.
    expect(fib.declaration).toEqual([0, at(src, 'fib(9)') - 1]);
  });

  test('a type declaration is a type-kind group that owns its annotation uses', () => {
    const src = 'type Point = tuple<number, number>\nlet p: Point = (1, 2)';
    const groups = groupsOf(src);
    const point = groupAt(groups, at(src, 'Point'));
    expect(point.kind).toBe('type');
    // The annotation `: Point` is a STRING in the raw AST; its use of the
    // name is found by lexing the source text the string was read from.
    expect(spans(src, point)).toEqual(['Point@5', 'Point@42']);
    expect(groupAt(groups, at(src, 'Point', 1))).toBe(point);
    // And the annotation's `number`s never resolve as symbol uses.
    expect(groups.some((g) => g.name === 'number')).toBe(false);
  });
});

describe('EPSIL OCCURRENCES — type names inside type text', () => {
  // A type is an opaque string in the raw AST, so a use of a declared type
  // name is found by lexing the source the string was read from. What a
  // rename needs is completeness: EVERY spelling of the name that denotes
  // the type, and nothing else.

  /** The offset of every word of `source` spelling `name` that the type
   * group of that name does not own — what a rename of the type would
   * leave behind. */
  function leftBehind(source: string, name: string): number[] {
    // A statement the parser rejects is dropped from the tree, and its uses
    // with it: the census is meaningful only on a clean parse.
    expect(parseEpsil(source)[1]).toEqual([]);
    const groups = groupsOf(source);
    const type = groups.find((g) => g.kind === 'type' && g.name === name);
    const owned = new Set(type?.occurrences.map((o) => o.start));
    const offsets: number[] = [];
    for (const m of source.matchAll(new RegExp(`\\b${name}\\b`, 'g')))
      if (!owned.has(m.index)) offsets.push(m.index);
    return offsets;
  }

  test('annotations of declarations, parameters, results and literals', () => {
    const src = [
      'type point = tuple<number, number>',
      'let p: point = (1, 2)',
      'let q: list<list<point>> = []',
      'const h : (point) -> point = (x) => x',
      'f(a: point) -> point = a',
      'function g(a: point, n: integer) -> list<point> { [a] }',
      'let k = (b: point) => b',
    ].join('\n');
    expect(leftBehind(src, 'point')).toEqual([]);
  });

  test('other type declarations, a generic clause, and a type test', () => {
    const src = [
      'type point = tuple<number, number>',
      'type alias pair = tuple<point, point>',
      'type box<T> = tuple<T, T>',
      'type shape = circle(point) | square(box<point>) | empty',
      'if (v is point) { 1 } else { 2 }',
    ].join('\n');
    expect(leftBehind(src, 'point')).toEqual([]);
    expect(leftBehind(src, 'box')).toEqual([]);
  });

  test('protocols: member signatures, conformances, a `where` constraint', () => {
    const src = [
      'type point = tuple<number, number>',
      'protocol Located {',
      '  readonly position: point',
      '  function move(self: Self, to: point) -> Self',
      '}',
      'type point is Located {',
      '  get position(self) { self }',
      '  function move(self: point, to: point) -> point { to }',
      '}',
      'function nearest(xs: list<T>) -> T where T is Located { xs[1] }',
    ].join('\n');
    expect(leftBehind(src, 'point')).toEqual([]);
    expect(leftBehind(src, 'Located')).toEqual([]);
  });

  test('a generic bound is a use; only the declared parameters are type variables', () => {
    const src = [
      'type point = integer',
      'type U = integer',
      'function f<T: point>(x: T, y: point) -> T { x }',
      'function g<T: list<point>, U>(x: T, y: U) -> U { y }',
    ].join('\n');
    expect(leftBehind(src, 'point')).toEqual([]);
    // `U` is a type variable of `g`, declared after a NESTED bound: the
    // clause ends at the `>` that returns to depth zero, not the first one.
    const groups = groupsOf(src);
    expect(groupAt(groups, at(src, 'U')).occurrences).toHaveLength(1);
  });

  test('types and values are separate namespaces', () => {
    // The parameter `point` and the type `point` are two bindings: the
    // annotation belongs to the type, the body's use to the parameter.
    const src =
      'type point = tuple<number, number>\nlet g = (point: point) => point';
    const groups = groupsOf(src);
    const type = groupAt(groups, at(src, 'point'));
    const parameter = groupAt(groups, at(src, 'point', 1));
    expect(type.kind).toBe('type');
    expect(spans(src, type)).toEqual(['point@5', 'point@51']);
    expect(parameter.kind).toBe('parameter');
    expect(spans(src, parameter)).toEqual(['point@44', 'point@61']);
  });

  test('a type and its constructor function are one group, in either order', () => {
    // The constructor shares the type's name, so a rename must take the
    // definition, the declaration, the annotation and the call together —
    // also when the function is written above the type.
    for (const src of [
      'type point = tuple<number, number>\npoint(x: number) = (x, x)\nlet q: point = point(1)',
      'point(x: number) = (x, x)\ntype point = tuple<number, number>\nlet q: point = point(1)',
    ]) {
      expect(parseEpsil(src)[1]).toEqual([]);
      const groups = groupsOf(src);
      const point = groupAt(groups, at(src, 'point'));
      expect(point.kind).toBe('type');
      expect(point.occurrences).toHaveLength(4);
      expect(leftBehind(src, 'point')).toEqual([]);
    }
  });

  test('a bare parameter spelled like a type is a parameter', () => {
    const src =
      'type point = tuple<number, number>\nfunction g(point, n: integer) -> point { point }';
    const groups = groupsOf(src);
    const type = groupAt(groups, at(src, 'point'));
    expect(spans(src, type)).toEqual([
      'point@5',
      `point@${at(src, '-> point') + 3}`,
    ]);
    expect(groupAt(groups, at(src, 'point', 1)).kind).toBe('parameter');
  });

  test('labels, sum variants, type variables and builtin names are not uses', () => {
    const src = [
      'type T = integer',
      'type box<T> = tuple<T, T>',
      'function first<T>(xs: list<T>) -> T { xs[1] }',
      'function last(xs: list<T>) -> T where T is Showable { xs[1] }',
      'type point = tuple<point: number, y: number>',
      'type shape = point(number) | other',
      'let t: T = 1',
    ].join('\n');
    const groups = groupsOf(src);
    // `T`: its declaration and the one annotation outside a generic clause.
    expect(spans(src, groupAt(groups, at(src, 'T')))).toEqual([
      'T@5',
      `T@${src.lastIndexOf('T =')}`,
    ]);
    // `point`: the field label and the variant of the same spelling are not
    // uses of the type.
    const declared = at(src, 'type point') + 5;
    expect(spans(src, groupAt(groups, declared))).toEqual([
      `point@${declared}`,
    ]);
    // A builtin type name never becomes a group.
    expect(groups.find((g) => g.name === 'integer')).toBeUndefined();
    expect(groups.find((g) => g.name === 'number')).toBeUndefined();
  });

  test('a value named like a builtin type is not tied to annotations', () => {
    const src = 'let number = 3\nlet x: number = number';
    const groups = groupsOf(src);
    expect(spans(src, groupAt(groups, at(src, 'number')))).toEqual([
      'number@4',
      'number@31',
    ]);
  });
});

describe('EPSIL OCCURRENCES — named-argument labels', () => {
  // `g(a: 2)` binds by the parameter's NAME, so the label is an occurrence
  // of the parameter — when the callee's parameters are certain.

  test('a label names the parameter of a single-clause function', () => {
    const src = 'g(a: 2)\ng(a) = a + 1';
    const groups = groupsOf(src);
    const a = groupAt(groups, at(src, 'a', 1));
    expect(a.kind).toBe('parameter');
    // The call precedes the definition: labels resolve after the walk.
    expect(spans(src, a)).toEqual(['a@2', 'a@10', 'a@15']);
    expect(unresolvedLabels(parseEpsil(src)[0], groups)).toEqual([]);
  });

  test('labels of a `function` statement and of a `let`-bound literal', () => {
    const src = [
      'function area(w: number, h: number) -> number { w * h }',
      'area(h: 2, w: 3) + area(1, h: 4)',
      'let f = (x: number) => x',
      'f(x: 1)',
    ].join('\n');
    const groups = groupsOf(src);
    expect(unresolvedLabels(parseEpsil(src)[0], groups)).toEqual([]);
    // Definition, body use, and two labels.
    expect(groupAt(groups, at(src, 'h: number')).occurrences).toHaveLength(4);
    // Definition, body use, and one label.
    expect(groupAt(groups, at(src, 'x: number')).occurrences).toHaveLength(3);
  });

  test('an uncertain callee leaves its labels unresolved, with the parameters they could name', () => {
    const src = [
      'g(a) = a + 1',
      'g(a, b) = a * b',
      'g(a: 2)', // two clauses: one parameter list per clause
      'q(a) = a',
      'h(a: 2)', // an undeclared callee
      'let w = (z) => z(a: 1)', // the callee is a parameter
      'let f = (x: number) => x',
      'f = (x: number) => x + 1',
      'f(x: 1)', // reassigned: the name may hold either literal
    ].join('\n');
    const groups = groupsOf(src);
    const unresolved = unresolvedLabels(parseEpsil(src)[0], groups);
    const owned = groups
      .filter((g) => g.kind === 'parameter')
      .flatMap((g) => g.occurrences.map((o) => o.start));
    for (const label of unresolved) expect(owned).not.toContain(label.start);

    const describe = (label: (typeof unresolved)[number]): string =>
      label.candidates === 'any'
        ? 'any'
        : label.candidates.map((c) => c.occurrences[0].start).join(',');
    expect(unresolved.map((l) => `${l.name}:${describe(l)}`)).toEqual([
      // The `a` of either clause of `g` — but not `q`'s `a`.
      `a:${at(src, 'a')},${at(src, 'g(a, b)') + 2}`,
      // No parameter of this document.
      'a:',
      // Whatever function `z` receives.
      'a:any',
      // The `x` of either literal.
      `x:${at(src, 'x: number')},${at(src, 'x: number', 1)}`,
    ]);
  });

  test('the parameter names of a signature annotation join the parameter', () => {
    // The parser requires the annotation's names and the literal's to
    // agree, so a rename must take both.
    const src = 'const f: (a: number) -> number = (a) => a\nf(a: 1)';
    expect(parseEpsil(src)[1]).toEqual([]);
    const groups = groupsOf(src);
    const a = groupAt(groups, at(src, '(a) =>') + 1);
    expect(spans(src, a)).toEqual(['a@10', 'a@34', 'a@40', 'a@44']);

    // A label deeper in the annotation names a parameter of a CALLBACK type.
    const nested =
      'const c: (k: (a: number) -> number, a: integer) -> number = (k, a) => k(a)';
    expect(parseEpsil(nested)[1]).toEqual([]);
    const outer = groupAt(groupsOf(nested), at(nested, '(k, a)') + 4);
    expect(spans(nested, outer)).toEqual([
      `a@${at(nested, 'a: integer')}`,
      `a@${at(nested, '(k, a)') + 4}`,
      `a@${at(nested, 'k(a)') + 2}`,
    ]);
  });
});
