---
title: Cortex Comments
sidebar_label: Comments
slug: /cortex/comments/
description: "Cortex Comments"
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

```cortex
// This is a line comment

/* This is a block comment */

```

## Documentation comments

```cortex
/// This is a documentation line comment

/** This is a documentation block comment */

```

## Comments are lossy

The parser currently **discards** comments: they are not attached to the
MathJSON of the following expression, and a round-trip
(`parseCortex` → `serializeCortex`) does not reproduce them. Comments carry no
semantic weight. The lexer recognizes the documentation-comment spellings, but
the parser does not currently attach them to nodes.

This is a deliberate scope decision. Notebooks keep prose in dedicated
markdown cells rather than in code comments, so comment preservation is not
required for the notebook workflow. (The serializer can still *emit* a
`/* … */` comment when a MathJSON expression carries a `comment` metadata
field, but nothing on the parse side currently populates that field.)

