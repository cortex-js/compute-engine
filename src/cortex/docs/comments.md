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
