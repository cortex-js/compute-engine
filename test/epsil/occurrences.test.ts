import { parseEpsil } from '../../src/epsil/parse-epsil';
import {
  documentBindings,
  isNameVisibleAt,
  occurrenceAt,
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
    expect(res.occurrences).toHaveLength(1);
  });

  test('a multi-clause declaration span covers every clause', () => {
    const src = 'fib(0) = 0\nfib(n) = fib(n - 1)\nfib(9)';
    const groups = groupsOf(src);
    const fib = groupAt(groups, at(src, 'fib'));
    // From the first clause's start to the last clause's end — the outline
    // range must contain a declaration inside ANY clause's body.
    expect(fib.declaration).toEqual([0, at(src, 'fib(9)') - 1]);
  });

  test('a type declaration is a type-kind group; its string uses are not tracked', () => {
    const src = 'type Point = tuple<number, number>\nlet p: Point = (1, 2)';
    const groups = groupsOf(src);
    const point = groupAt(groups, at(src, 'Point'));
    expect(point.kind).toBe('type');
    // The annotation `: Point` lives in a STRING — deliberately not an
    // occurrence (which is why the server refuses to rename a type).
    expect(point.occurrences).toHaveLength(1);
    // And the annotation's `number`s never resolve as symbol uses either.
    expect(groups.some((g) => g.name === 'number')).toBe(false);
  });
});
