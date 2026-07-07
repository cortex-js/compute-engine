---
title: Cortex Comments
permalink: /cortex/comments/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
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

## Comments are lossy (v0)

In v0, the parser **discards** comments: they are not attached to the
MathJSON of the following expression, and a round-trip
(`parseCortex` → `serializeCortex`) does not reproduce them. Comments carry no
semantic weight and are dropped during tokenization.

This is a deliberate scope decision. Notebooks keep prose in dedicated
markdown cells rather than in code comments, so comment preservation is not
required for the notebook workflow. (The serializer can still *emit* a
`/* … */` comment when a MathJSON expression carries a `comment` metadata
field — that path is used when serializing engine-produced expressions — but
nothing on the parse side ever populates that field.)
