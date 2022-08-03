---
title: Cortex Pragmas
permalink: /cortex/pragmas/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Pragmas

Pragmas, or compiler directives, are annotations in the source code that provide
instructions to the parser/compiler about how to interpret the source code.
These instructions are executed during the parsing/compilation phase, not during
the execution phase.

## Environment Variables

Environment variables are defined in the execution environment of the compiler
process when executed from a `node` process. In Unix, they are set using a
shell-specific syntax (`export VARIABLE=value` in bash shells, for example).

Environment variables are not available when the compilation/parsing is taking
place in a browser process.

**To access an environment variable**, use the `#env()` pragma.

```cortex
#env("DEBUG")
```

Some common environment variables include:

- `NO_COLOR`: if set, color output to the terminal should be avoided
- `TERM`: describe the capabilities of the output terminal, e.g.
  `xterm-256color`
- `HOME`: path to the user home directory
- `TEMP`: path to a temporary file directory

### Navigator Properties

The navigator properties are available when the compilation/parsing is taking
place in a browser process.

**To access the properties of the `navigator` JavaScript global object**, use
the `#navigator()` pragma function. It returns 'Nothing' if the property is not
available.

```cortex
#navigator("userAgent")
```

## Compile-Time Diagnostic Statement

A compile-time diagnostic statement causes the compiler to emit an error or a
warning during compilation.

**To output a message to the console and immediately interrupt the
parsing/compilation**, use the `#error()` pragma function.

```cortex
#error("File cannot be compiled")
```

**To output a message to the console**, but continue the parsing/compilation,
use the `#warning()` pragma function.

```cortex
#warning("TODO: Implement function")
```

## Line Control Statements

The name and URL of the source file being parsed/compiled can be accessed using
the `#sourceFile` and `#sourceUrl` pragmas. The current line is indicated by
`#line` and column by `#column`.

When generating and pre-processing code, it might be useful to indicate the
original source code and location, rather than the current one. To change the
source URL and line of the current file, use the `#sourceLocation()` pragma
function.

```cortex
#sourceLocation(145, "file://localhost/~user/dev/source.ctx")
```

**To number the following line to 146**, use:

```cortex
#sourceLocation(145)
```

**To reset the source location to the actual source and line**, use
`#sourceLocation()`.

## Other Pragmas

The following pragmas are replaced with the indicated value:

- `#line`: the current source line number, which is either the actual source
  line number, or as calculated based on `#sourceLocation()`. The first line is
  line 1.
- `#column`: the current column number. The first column is column 1.
- `#url`: the URL of the current source file.
- `#filename`: the filename of the current source file.
- `#date`: the current date in the `YYYY-MM-DD` format.
- `#time`: the current time in the `HH:MM:SS` format.
