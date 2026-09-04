import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';
import { formatDiagnostics } from '../../src/cli/format';

//
// The `match` EXHAUSTIVENESS lint (`src/epsil/match-exhaustiveness.ts`): a
// `match` whose subject is annotated with a CLOSED type — a sugar-declared
// sum, or `boolean` — reports a `match-not-exhaustive` warning naming the
// alternatives no case covers. It runs in the static pass, so it reaches both
// `epsil check` and a program run, and it never fires on a type it cannot
// enumerate from a declaration.
//

const SUMS = `type light = red | green | yellow
type tree<T> = leaf | node(value: T, children: list<tree<T>>)
type json = jbool(boolean) | jnum(number)
type alias signal = light
`;

/** The diagnostics a program run reports, as `[code, ...args]` arrays. */
function runDiagnostics(source: string): string[][] {
  const ce = new ComputeEngine();
  return executeEpsil(ce, source).diagnostics.map((d) =>
    (Array.isArray(d.message) ? d.message : [d.message]).map(String)
  );
}

/** The diagnostics `epsil check` reports, as `[code, ...args]` arrays. */
function checkDiagnostics(source: string): string[][] {
  return checkSource(source).diagnostics.map((d) =>
    (Array.isArray(d.message) ? d.message : [d.message]).map(String)
  );
}

/** Both routes must agree: the lint lives in the static pass they share. */
function diagnostics(source: string): string[][] {
  const run = runDiagnostics(source);
  expect(checkDiagnostics(source)).toEqual(run);
  return run;
}

describe('MATCH EXHAUSTIVENESS — a sugar-declared sum subject', () => {
  test('an uncovered variant is reported, spelled as its pattern', () => {
    expect(
      diagnostics(`${SUMS}
        function canGo(t: light) -> boolean {
          match t {
            green() => true
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'red(), yellow()']]);
  });

  test('every variant covered by constructor patterns is quiet', () => {
    expect(
      diagnostics(`${SUMS}
        function canGo(t: light) -> boolean {
          match t {
            green() => true
            red() => false
            yellow() => false
          }
        }`)
    ).toEqual([]);
  });

  test('a final wildcard, `otherwise`, or bare binding covers everything', () => {
    for (const catchAll of ['_', 'otherwise', 'other']) {
      expect(
        diagnostics(`${SUMS}
          function canGo(t: light) -> boolean {
            match t {
              green() => true
              ${catchAll} => false
            }
          }`)
      ).toEqual([]);
    }
  });

  test('or-alternatives cover the union of their arms', () => {
    expect(
      diagnostics(`${SUMS}
        function canGo(t: light) -> boolean {
          match t {
            green() => true
            red() | yellow() => false
          }
        }`)
    ).toEqual([]);
  });

  test('a payload variant is covered by an all-wildcard constructor pattern', () => {
    // Bindings, `_`, and a rest `...` are all wildcards; the message spells
    // a missing payload variant with one `_` per payload element.
    expect(
      diagnostics(`${SUMS}
        function total(t: tree<number>) -> number {
          match t {
            node(v, _) => v
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'tree<number>', 'leaf()']]);
    expect(
      diagnostics(`${SUMS}
        function total(t: tree<number>) -> number {
          match t {
            node(v, ...) => v
            leaf() => 0
          }
        }`)
    ).toEqual([]);
    expect(
      diagnostics(`${SUMS}
        function total(t: tree<number>) -> number {
          match t {
            leaf() => 0
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'tree<number>', 'node(_, _)']]);
  });

  test('a constructor pattern with a literal or pinned operand is conditional', () => {
    expect(
      diagnostics(`${SUMS}
        function isZero(j: json) -> boolean {
          match j {
            jnum(0) => true
            jnum(_) => false
            jbool(_) => false
          }
        }`)
    ).toEqual([]);
    expect(
      diagnostics(`${SUMS}
        function isZero(j: json) -> boolean {
          match j {
            jnum(0) => true
            jbool(_) => false
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'json', 'jnum(_)']]);
    expect(
      diagnostics(`${SUMS}
        let zero = 0
        function isZero(j: json) -> boolean {
          match j {
            jnum(== zero) => true
            jbool(_) => false
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'json', 'jnum(_)']]);
  });

  test('an operand count that does not fit the variant is conditional', () => {
    // `red(_)` never matches the nullary `red()`, and `node(v)` never matches
    // a two-element payload — the runtime pins both — so neither covers.
    expect(
      diagnostics(`${SUMS}
        function f(t: light) -> number {
          match t {
            red(_) => 1
            green() => 2
            yellow() => 3
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'red()']]);
    expect(
      diagnostics(`${SUMS}
        function f(t: tree<number>) -> number {
          match t {
            node(v) => v
            leaf() => 0
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'tree<number>', 'node(_, _)']]);
  });

  test('a literal `true` guard cannot fail, so the case is unconditional', () => {
    expect(
      diagnostics(`${SUMS}
        function f(t: light) -> number {
          match t {
            red() if true => 1
            green() => 2
            yellow() => 3
          }
        }`)
    ).toEqual([]);
  });

  test('a guarded case covers nothing', () => {
    expect(
      diagnostics(`${SUMS}
        function f(t: light) -> number {
          match t {
            red() => 1
            green() if 1 > 0 => 2
            yellow() => 3
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green()']]);
  });

  test('a typed binding covers the alternatives of its own type', () => {
    expect(
      diagnostics(`${SUMS}
        function f(t: light) -> number {
          match t {
            red() => 1
            g: green => 2
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'yellow()']]);
    expect(
      diagnostics(`${SUMS}
        function f(t: light) -> number {
          match t {
            x: light => 1
          }
        }`)
    ).toEqual([]);
    // A typed binding with an explicit guard is conditional again.
    expect(
      diagnostics(`${SUMS}
        function f(t: light) -> number {
          match t {
            red() => 1
            x: light if 1 > 0 => 2
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green(), yellow()']]);
  });

  test('a binding typed `any` or `unknown` is a catch-all', () => {
    expect(
      diagnostics(`${SUMS}
        function f(t: light) -> number {
          match t {
            red() => 1
            x: unknown => 2
          }
        }`)
    ).toEqual([]);
  });
});

describe('MATCH EXHAUSTIVENESS — where the subject type comes from', () => {
  test('a typed `let` at the top level types the following statements', () => {
    expect(
      diagnostics(`${SUMS}
        let u: light = red()
        match u {
          red() => 1
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green(), yellow()']]);
  });

  test('a typed lambda parameter', () => {
    expect(
      diagnostics(`${SUMS}
        let g = (t: light) => match t { red() => 1 }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green(), yellow()']]);
  });

  test('an alias of a sum resolves to the sum', () => {
    expect(
      diagnostics(`${SUMS}
        let u: signal = red()
        match u {
          red() => 1
          green() => 2
        }`)
    ).toEqual([['match-not-exhaustive', 'signal', 'yellow()']]);
  });

  test('a union of variants is closed over exactly those variants', () => {
    expect(
      diagnostics(`${SUMS}
        function f(t: red | green) -> number {
          match t {
            red() => 1
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'red | green', 'green()']]);
    expect(
      diagnostics(`${SUMS}
        function f(t: red | green) -> number {
          match t {
            red() => 1
            green() => 2
          }
        }`)
    ).toEqual([]);
  });

  test('a typed `match` binding types a nested match on it', () => {
    expect(
      diagnostics(`${SUMS}
        let u: light = red()
        match u {
          x: light => match x { red() => 1 }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green(), yellow()']]);
  });

  test('a typed capture nested in a shape types the body', () => {
    expect(
      diagnostics(`${SUMS}
        type box = wrap(inner: light)
        function f(b: box) -> number {
          match b {
            wrap(x: light) => match x { red() => 1 }
            _ => 0
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green(), yellow()']]);
    // The typed capture is known even with an explicit guard alongside it,
    // since the body only runs when the whole guard holds.
    expect(
      diagnostics(`${SUMS}
        type box = wrap(inner: light)
        function f(b: box) -> number {
          match b {
            wrap(x: light) if 1 > 0 => match x { red() => 1 }
            _ => 0
          }
        }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green(), yellow()']]);
  });

  test('a destructuring `let` shadows the names it binds', () => {
    expect(
      diagnostics(`${SUMS}
        let u: light = red()
        function f() -> number {
          let (u, v) = (1, 2)
          match u { red() => 1 }
        }`)
    ).toEqual([]);
  });

  test('a shadowing binding makes the name unknown again', () => {
    // A `for` element, an untyped `let` in a block, and a `match` capture all
    // rebind the name with no annotation, so the inner match is not checked.
    expect(
      diagnostics(`${SUMS}
        let u: light = red()
        for u in [1, 2] {
          match u { red() => 1 }
        }`)
    ).toEqual([]);
    expect(
      diagnostics(`${SUMS}
        let u: light = red()
        function f() -> number {
          let u = 3
          match u { red() => 1 }
        }`)
    ).toEqual([]);
    expect(
      diagnostics(`${SUMS}
        let u: light = red()
        match [1, 2] {
          [u, _] => match u { red() => 1 }
        }`)
    ).toEqual([]);
    // …and the shadow ends with its block: the outer name is typed again.
    expect(
      diagnostics(`${SUMS}
        let u: light = red()
        function f() -> number {
          let u = 3
          u
        }
        match u { red() => 1 }`)
    ).toEqual([['match-not-exhaustive', 'light', 'green(), yellow()']]);
  });

  test('an unannotated subject is never reported', () => {
    expect(
      diagnostics(`${SUMS}
        function f(t) -> number {
          match t {
            red() => 1
          }
        }`)
    ).toEqual([]);
    expect(
      diagnostics(`${SUMS}
        match red() {
          red() => 1
        }`)
    ).toEqual([]);
  });
});

describe('MATCH EXHAUSTIVENESS — which types are closed', () => {
  test('`boolean` is closed over `true` and `false`', () => {
    expect(
      diagnostics(`
        let b: boolean = true
        match b {
          true => 1
        }`)
    ).toEqual([['match-not-exhaustive', 'boolean', 'false']]);
    expect(
      diagnostics(`
        let b: boolean = true
        match b {
          true => 1
          false => 0
        }`)
    ).toEqual([]);
  });

  test('a union with a non-variant member is open', () => {
    expect(
      diagnostics(`${SUMS}
        function f(t: light | nothing) -> number {
          match t {
            red() => 1
          }
        }`)
    ).toEqual([]);
  });

  test('a hand-assembled union of nominals is open', () => {
    // `type red = nothing` (no sugar) mints a nominal with no sum membership:
    // the lint does not claim to enumerate it.
    expect(
      diagnostics(`
        type on = nothing
        type off = nothing
        type alias switch = on | off
        function f(s: switch) -> number {
          match s {
            on() => 1
          }
        }`)
    ).toEqual([]);
  });

  test('ordinary types are open', () => {
    expect(
      diagnostics(`
        function f(n: integer, s: string) -> number {
          match n {
            0 => 0
          }
          match s {
            "a" => 1
          }
        }`)
    ).toEqual([]);
  });
});

describe('MATCH EXHAUSTIVENESS — presentation', () => {
  test('it is a warning, anchored to the `match` expression', () => {
    const source = `${SUMS}let u: light = red()\nmatch u {\n  red() => 1\n}`;
    const { diagnostics: diags } = checkSource(source);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    const [start, end] = diags[0].range;
    expect(source.slice(start, end)).toBe('match u {\n  red() => 1\n}');
  });

  test('the message names the type and spells the missing patterns', () => {
    const source = `${SUMS}let u: light = red()\nmatch u {\n  red() => 1\n}`;
    const { diagnostics: diags } = checkSource(source);
    const text = formatDiagnostics(diags, source, undefined, false);
    expect(text).toContain(
      'The "match" on a "light" value has no case for green(), yellow(); add a case for each, or a final "_" case'
    );
    expect(text).toContain('match-not-exhaustive');
  });

  test('the program still runs: the uncovered subject is the `match-no-case` error value', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      `${SUMS}let u: light = green()\nmatch u {\n  red() => 1\n}`
    );
    expect(result.diagnostics.map((d) => d.message[0])).toContain(
      'match-not-exhaustive'
    );
    expect(result.value.toString()).toMatch(/^Error\("match-no-case"/);
  });
});
