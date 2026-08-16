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

**To indicate that a comment is part of the documentation and is formatted using
markdown**, use `///` for single line comments and `/** */` for block comments.

```epsil
// This is a line comment

/* This is a block comment */

```

## Documentation comments

```epsil
/// This is a documentation line comment

/** This is a documentation block comment */

```

A documentation comment written **immediately before a function definition**
(either form, with or without `hold`) is attached to it as the function's
**description** — markers stripped, `///` lines joined, the ` * ` gutter of a
block removed. It is what `About(f)` prints, what an editor hover shows, and
it is carried in MathJSON as the `description` attribute of the
`DefineFunction` statement, so it survives a read-write round trip (it comes
back as `///` lines). Markdown is the intended format.

```epsil
/// Doubles its argument.
twice(x) = 2x
```

Documentation comments before anything else — a `let`, an expression — are
still discarded.

## Comments are lossy

Apart from a documentation comment before a function definition, the parser
**discards** comments: they are not attached to the expression that follows
them, so reading a program and writing it back out does not reproduce them.
Comments carry no semantic weight.

This is a deliberate scope decision. Notebooks keep prose in dedicated
markdown cells rather than in code comments, so comment preservation is not
required for the notebook workflow.

