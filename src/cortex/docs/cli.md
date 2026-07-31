---
title: Cortex CLI
sidebar_label: CLI
slug: /cortex/cli/
description: "The cortex command-line interface: run files, evaluate inline programs, or start an interactive REPL."
hide_title: true
date: Last Modified
---
# Cortex CLI

The `@cortex-js/compute-engine` package installs a `cortex` command for
evaluating Cortex source from a terminal. It can run a source file, evaluate an
inline program, read a program from standard input, or start an interactive
REPL.

:::warning

Cortex and its command-line interface are experimental. Their syntax and
behavior may change between releases.

:::

## Installation

Install the Compute Engine package in a project:

```shell
npm install @cortex-js/compute-engine
```

The package exposes `cortex` through npm's local executable directory. Run it
through `npx` or from a package script:

```shell
npx cortex --version
```

## Running Programs

With a source file:

```shell
npx cortex program.cx
```

With an inline program:

```shell
npx cortex --eval 'Simplify(2 + 2x)'
```

From standard input:

```shell
printf '1/2 + 1\n' | npx cortex
```

Use `-` as the file name to explicitly read standard input:

```shell
npx cortex - < program.cortex
```

The conventional Cortex file extensions are `.cx` and `.cortex`. A source file
can be made directly executable with a hashbang:

```cortex
#!/usr/bin/env cortex

let radius = 3
Pi * radius^2
```

## Options

| Option | Description |
|:--|:--|
| `-e`, `--eval <source>` | Evaluate Cortex source supplied on the command line. |
| `--json` | Write the result as formatted MathJSON. Finite lazy collections (`Range`, `Map` results, …) are materialized into their elements, up to 10,000. |
| `--cortex` | Write the result as serialized Cortex source. |
| `--diagnostics <fmt>` | Write diagnostics as `text` (the default) or as a `json` array. |
| `--time-limit <ms>` | Set the evaluation deadline in milliseconds. The default is `10000`; `0` disables it. |
| `--no-color` | Disable color in diagnostics. The [`NO_COLOR`](https://no-color.org/) environment variable is also honored. |
| `-h`, `--help` | Display command help. |
| `-v`, `--version` | Display the package version. |

`--json` and `--cortex` are mutually exclusive. With neither option, results
use the Compute Engine's ordinary textual representation.

## Checking a Program Without Evaluating It

`cortex check` parses a program and reports its diagnostics — syntax errors,
malformed strings, invalid type annotations, `match` shape problems, and the
trap lints (`=` inside a call argument, a literal index `0`, a `//` comment
that reads as floor division) — without evaluating anything. It also
canonicalizes the program (still without running it) and reports the problems
that surface there — type errors such as `"a" + 1`, but also a wrong argument
count — as `static-type-error` diagnostics anchored to the offending statement.
An `Error(…)` value the program itself builds is not reported: errors are
values. It accepts the same source forms as evaluation: a file,
`--eval`, or standard input.

```shell
npx cortex check program.cx
npx cortex check --eval 'let x = 5; x +'
```

The exit status is `0` when there are no error diagnostics (warnings are
allowed) and `1` otherwise. With `--json`, a machine-readable envelope is
written to standard output instead of formatted text on standard error:

```shell
$ npx cortex check --eval 'a+ b' --json
{
  "ok": true,
  "diagnostics": [
    {
      "severity": "warning",
      "code": "asymmetric-operator-whitespace",
      "args": ["+"],
      "message": "asymmetric operator whitespace: +",
      "start": 1,
      "end": 2,
      "line": 1,
      "column": 3,
      "fixits": [{ "start": 1, "end": 2, "value": " + " }]
    }
  ]
}
```

`start`/`end` are 0-based character offsets into the source; `line`/`column`
are 1-based. A `fixits` entry is a replacement (`value`) for the source range
`[start, end)`. The same structured form is available during evaluation with
`--diagnostics json`, which writes the array to standard error.

Because `check` does not evaluate, it does not report runtime problems —
unknown-function suggestions, type mismatches at call sites, or error values.
Those surface when the program runs.

## Looking Up Documentation

`cortex doc` shows the definition of a library symbol — its kind, signature
or type, description, and keywords — or searches the library when the
argument is not an exact name. Search matches identifiers, descriptions,
curated keywords, and LaTeX commands:

```shell
$ npx cortex doc Sin
Sin (function) (number) -> number — Sine of an angle.
  keywords: sine

$ npx cortex doc greatest common divisor
GCD (function) (any*) -> number — Greatest Common Divisor
...
```

Use `--limit <n>` for more search matches (default 10) and `--json` for a
structured `{ query, matches }` envelope. The exit status is `1` when
nothing matches.

## MCP Server

`cortex mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io)
server, giving AI agents structured access to the same operations as the CLI.
The default transport is standard input/output:

```shell
npx cortex mcp
```

Use the native Streamable HTTP transport for clients that connect to a URL:

```shell
npx cortex mcp --transport streamable-http
```

The HTTP endpoint defaults to `http://127.0.0.1:8000/mcp`. Configure it with
`--host <address>`, `--port <number>`, and `--path <path>`. The server binds
only to loopback by default; using a public bind address does not add HTTPS or
authentication. Repeat `--allow-origin <origin>` to allow a browser client
from a non-local origin.

| Tool        | Purpose                                                        |
| :---------- | :------------------------------------------------------------- |
| `evaluate`  | Run a complete program; returns the value as display text, Cortex source and MathJSON, plus diagnostics |
| `check`     | Parse and report diagnostics without evaluating                |
| `doc`       | Look up a library symbol, or search the library by keywords    |
| `parse`     | Convert Cortex source to MathJSON                              |
| `serialize` | Convert MathJSON to Cortex source                              |

The server also exposes the agent-facing language card
(`/cortex/for-agents/`) as the resource `cortex://docs/for-agents`.

Each `evaluate` call runs in a fresh session: definitions do not persist
between calls, so every program must be self-contained. The
`--time-limit <ms>` option sets the default evaluation deadline for the
`evaluate` tool (default 10000; each call can override it with its
`timeLimit` argument).

<ReadMore path="/cortex/mcp/">
See how to **connect ChatGPT, Claude Code, Claude Desktop, or another MCP
client**, and what to expect once it is connected.
</ReadMore>

## Interactive REPL

Run `cortex` with no file or `--eval` while standard input is a terminal:

```text
$ npx cortex
Cortex 0.92.1
Type .help for more information.

cortex> let x = 5
5
cortex> x^2
25
```

The REPL keeps one `ComputeEngine` for the session, so top-level declarations
and assignments persist between inputs. `.clear` creates a fresh engine and
clears that state.

Unclosed blocks, collections, strings, and expressions ending with an operator
continue at a secondary prompt:

```text
cortex> if (x > 0) {
...   x + 1
... }
6
```

### REPL Commands

| Command | Description |
|:--|:--|
| `.help` | List the available REPL commands. |
| `.clear` | Reset the session to a fresh `ComputeEngine`. |
| `.load <file>` | Execute a Cortex source file in the current session. |
| `.ast` | Toggle MathJSON result output. |
| `.time` | Toggle elapsed-time output. |
| `.editor` | Enter Node's multiline editor mode. |
| `.break` | Abandon the current multiline input. |
| `.save <file>` | Save the entered REPL source to a file. |
| `.exit` | Exit the REPL. |

Command history is stored in `~/.cortex_history`. Set
`CORTEX_REPL_HISTORY` to use a different path.

## Results, Diagnostics, and Exit Status

The value of the last statement is written to standard output. Diagnostics are
written to standard error with their source location and an excerpt:

```text
1:4 error: Unexpected symbol "+"
1 | 1 +
       ^
```

The process exits with:

- `0` after successful evaluation, including evaluations that emit warnings;
- `1` for source, runtime, cancellation, or file errors;
- `2` for invalid command-line usage.

Evaluation is symbolic and exact by default, just like `executeCortex()`. Use
`N(expr)` in the program when a numeric approximation is required.

Host-state pragmas such as `#env` and `#navigator` remain disabled in the CLI.
The command does not provide an option to enable them.

## Evaluation Limits

Each input has a 10-second evaluation deadline by default. This prevents a
runaway synchronous calculation from leaving an interactive session
unresponsive:

```shell
npx cortex --time-limit 30000 long-running.cx
```

Set `--time-limit 0` for no deadline. The Compute Engine's iteration and
recursion limits continue to apply independently.
