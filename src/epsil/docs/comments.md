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

## Comments are lossy

The parser currently **discards** comments: they are not attached to the
expression that follows them, so reading a program and writing it back out
does not reproduce them. Comments carry no semantic weight. The lexer
recognizes the documentation-comment spellings, but the parser does not
currently attach them to anything.

This is a deliberate scope decision. Notebooks keep prose in dedicated
markdown cells rather than in code comments, so comment preservation is not
required for the notebook workflow.

