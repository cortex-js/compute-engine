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
`///` lines joined, the ` * ` gutter of a block removed. It is what `About(f)` 
prints, what an editor hover shows. Markdown is the intended format.

```epsil
/// Doubles its argument.
twice(x) = 2x
```
