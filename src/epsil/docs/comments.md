---
title: Epsil Comments
sidebar_label: Comments
slug: /epsil/comments/
description: "Line and nestable block comments in Epsil, documentation comments, and why comments are lossy — they do not survive a read-write round trip."
hide_title: true
date: Last Modified
---
# Comments

**Line Comments** start with `//`. Everything after a `//` is ignored until the
end of the line.

**Block (multi-line) Comments** start with `/*` and end with `*/`. Block
comments can be nested.

```epsil
// This is a line comment

/* This is a block comment */

```

## Documentation comments

**To indicate that a comment is part of the documentation and is formatted using
markdown**, use `///` for single line comments and `/** */` for block comments.


```epsil
/// This is a documentation line comment

/** This is a documentation block comment */

```

A documentation comment written **immediately before a function definition**
is attached to it as the function's **description** — markers stripped, 
`///` lines joined, the ` * ` gutter of a block removed. It is what `about(f)` 
prints, what an editor hover shows. Markdown is the intended format.

```epsil
/// Doubles its argument.
twice(x) = 2x
```

### Documenting the parameters

Tag lines in the documentation comment of a function document its
parameters, the keys of a parameter that takes a dictionary of options, and
give examples. A tag line starts with one of these tags and runs to the end of
the line; a following line that starts with a space continues it:

| Tag | Documents |
| --- | --- |
| `@param name text` | the parameter `name` (Markdown) |
| `@key param.key: type -- text` | a key of the options parameter `param`; the `: type --` part is optional |
| `@sample name source` | a sample value of a parameter, or of a key with `@sample param.key` |
| `@default param.key source` | the value of a key that the dictionary leaves out |
| `@example source` | one line of Epsil that uses the function |

```epsil
/// Draws a plot.
/// @param series the function to plot
/// @sample series x => x^2
/// @param options the options of the plot
/// @key options.grid: boolean -- whether to draw a grid
/// @default options.grid false
/// @key options.theme: "light" | "dark" -- the colors
/// @example plot(x => sin(x), {grid -> true})
function plot(series, options = {}) { series }
```

The tag lines are not part of the description: `about(f)` prints them with
it, and an editor shows them in their own places. The signature help shows
the documentation of the parameter at the cursor, or of the key whose name or
value holds the cursor. An empty argument shows the sample as faint text, and
the completion of a key inserts its sample. In the dictionary of the options,
the completion lists the keys that the dictionary does not write yet. A
sample, a default and an example are Epsil source, and a rest parameter
(`...xs`) is documented by its name (`@param xs`).

A documentation comment before a `protocol` statement documents the protocol,
and one before a member of its body documents that member. The engine keeps
them with the protocol, so an editor shows them in the hover of the protocol
and in the help of a member, also when the protocol was declared by a program
that ran earlier on the same engine:

```epsil
/// Things that move.
protocol Movable {
  /// Moves the thing by `d`.
  function move(self: Self, d: real) -> Self
}
```
