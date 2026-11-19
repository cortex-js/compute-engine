# Completion for Epsil sources (CE-1521)

Status: approved 2026-11-19: (a) the hole technique; the VS Code provider ships with step 1.

## Goal

An exported function gives the completion items at an offset of an Epsil
source, for Tycho's CodeMirror editor and the VS Code extension. The items
come from four sources (user direction, 2026-11-19):

1. the fix-its of the diagnostics at the offset (CE-1520 adds the first ones
   for an unclosed string or bracket);
2. the names in scope at the offset: variables, functions and types of the
   source;
3. the names of the standard library, with their signatures;
4. likely values for the expected type: `0` for `let a: integer = ▮`.

## API

```ts
function epsilCompletions(
  ce: ComputeEngine,
  source: string,
  offset: number,
  options?: { typeNames?: …; protocolNames?: …; sumVariants?: … } // as parseEpsil
): EpsilCompletions;

type EpsilCompletions = {
  /** The text that an item replaces: the word being typed before the offset
   *  (`[offset, offset]` when there is none). */
  range: [start: number, end: number];
  /** The type expected at the offset, when the context gives one. */
  expectedType?: string;
  items: EpsilCompletionItem[];
};

type EpsilCompletionItem = {
  label: string;
  kind: 'fixit' | 'variable' | 'function' | 'type' | 'library-function'
      | 'library-constant' | 'keyword' | 'value';
  /** The text inserted over `range`; for a fix-it, `edits` instead. */
  insertText?: string;
  edits?: [start: number, end: number, text: string][];
  /** A signature (`(real, integer) -> real`) or a type. */
  detail?: string;
  /** The first line of the library description, for a library name. */
  documentation?: string;
  /** Smaller first. Items are returned sorted. */
  rank: number;
};
```

The host filters further as the user types; CE returns the items that match
the word typed so far (prefix, ignoring case).

## Finding the context: a hole at the offset

The function replaces the word being typed with a placeholder name (a name
that does not occur in the source), parses the result with `parseEpsil`, and
finds the placeholder in the MathJSON by its `sourceOffsets`. The parent of
that node gives the context. Measured against the current source
(scratch probe, 2026-11-19):

| Source (▮ is the offset)                          | Node around the hole                         | Expected type                 |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------- |
| `let a: integer = ▮`                              | `Declare(a, "integer", {value: ▮})`          | `integer`                     |
| `let s: string = ▮`                               | `Declare(s, "string", {value: ▮})`           | `string`                      |
| `function f(x: real, n: integer) {x}` `f(1, ▮)`   | `f(1, ▮)`, `f` defined with `Typed(n, integer)` | `integer` (parameter 2)    |
| `let L: list<real> = [1, ▮` (unclosed)            | `List(1, ▮)` inside the `Declare` of `list<real>` | `real` (the element type) |
| `let b = Sin(▮` (unclosed)                        | `Sin(▮)`                                     | the engine signature of `Sin` |
| `let a: ▮`                                        | none: the statement is dropped               | (a type position, see below)  |
| `if ▮`                                            | none: the statement is dropped               | none                          |

The parser's recovery keeps the context inside an unclosed bracket, so
the context of most expression positions is known without changing the
parser.

Rules for the expected type, from the parent of the hole:

- the value of a `Declare` with a type: that type;
- the operand of a call to a function of the source: the type of the
  parameter (`Typed`), when it has one;
- the operand of a call to a library function: the parameter type of its
  engine signature (`ce.operatorInfo(name).signature`);
- an element of a `List` whose declared type is `list<T>`: `T`;
- an operand of an assignment to a declared variable: its declared type;
- otherwise: none.

**Type positions.** After `:` in a declaration or a parameter, the items are
the type names: the built-in type names, and the `typeNames`, protocol and
sum types of the options and of the source. The function detects a type
position from the tokens before the offset (`:` after a `let` name or a
parameter name, `->` after a parameter list), because the parser drops a
statement whose annotation does not parse.

**Dropped statements** (`if ▮`): no expected type; the items are the names
and the keywords. A parser change that keeps a partial statement is step 3.

## The items

1. **Fix-its**: those of the diagnostics of the parse of the real source
   (not the source with the hole) whose range contains the offset or ends
   at it. Rank 0.
2. **Likely values** for the expected type: `integer`, `real`, `number` →
   `0`; `boolean` → `true`, `false`; `string` → `""`; `list<…>` → `[]`;
   `tuple<T1, T2>` → `(0, 0)` built from the element types; a record type →
   `{field: 0, …}` from its fields; a sum type → its variants. Rank 1.
3. **Names in scope** at the offset: `documentBindings` and the visibility
   test of `isNameVisibleAt` (`src/epsil/occurrences.ts`), with the kind of
   the binding group and its declared type, or its signature for a function.
   When the expected type is known, a name whose declared type matches comes
   first (rank 2), the others after (rank 4). Locals before globals.
4. **Library names**: `epsilLibraryNames()`, with the signature and the first
   description line of `describeName` (`src/cli/doc.ts`, which moves to
   `src/epsil/` so the package can export it). Rank 3 when the signature's
   result type matches the expected type, 5 otherwise.
5. **Keywords** valid at the position: statement keywords (`let`,
   `function`, `if`, `for`, `while`, `match`, …) at the start of a
   statement, expression keywords (`if`, `match`, `true`, `false`) in an
   expression. Rank 6.

## Steps

1. `epsilCompletions` with the hole context, likely values, names in scope,
   library names and keywords; exported from `src/epsil.ts`; a completion
   provider in the VS Code server on the same function. Size M.
2. Fix-its as items, once CE-1520 adds them (the merge is a few lines).
3. Parser recovery that keeps a partial statement (`if ▮`, `let a: ▮`) so
   that the context of these positions is known. Separate, after measuring
   how often Tycho users reach those positions.

## Cost and tests

One parse, one `documentBindings` pass and one hole lookup per request. The
hosts call it on a key press, after their own delay; measure the time on the
largest source of Tycho's showcase before shipping, and report it.

Tests: one per row of the table above, one per likely value, the scope rules
(a local not visible before its `let`, a parameter visible only in its body),
ranking order, and the VS Code provider through the server test harness.

## Decisions for the board

- (a) Use the hole technique for the context (recommended: no parser change
  for step 1), or (b) record the context in the parser.
- Ship the VS Code completion provider with step 1 (recommended: it tests
  the function on a real editor).
