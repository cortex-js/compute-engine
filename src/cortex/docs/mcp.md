---
title: Cortex MCP Server
sidebar_label: MCP Server
slug: /cortex/mcp/
description: "Connect AI assistants to Cortex with the built-in Model Context Protocol server: exact arithmetic, symbolic computation, and library documentation as tools."
hide_title: true
date: Last Modified
---
# Using Cortex with AI Assistants

<Intro>
The `cortex` command includes a [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server. Connect it to Claude Code, Claude Desktop, or any other MCP
client, and your AI assistant can evaluate Cortex programs — exact
arithmetic, symbolic computation, calculus, linear algebra — instead of
doing math "in its head".
</Intro>

:::warning[Experimental]
Cortex is experimental. Its syntax and behavior may change between releases.
:::

## Setup

With **Claude Code**, register the server with a single command:

```shell
claude mcp add cortex -- npx -y @cortex-js/compute-engine mcp
```

For **Claude Desktop** and most other MCP clients, add the server to the
client's JSON configuration:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["-y", "@cortex-js/compute-engine", "mcp"]
    }
  }
}
```

If the Compute Engine package is already installed in your project, you can
run the local copy instead of downloading one: use `npx cortex mcp` (that
is, `"command": "npx", "args": ["cortex", "mcp"]`).

That's it. The next time you start the client, the Cortex tools are
available to the assistant.

## What the Assistant Gets

| Tool        | Purpose                                                        |
| :---------- | :------------------------------------------------------------- |
| `evaluate`  | Run a Cortex program and return its value — as display text, Cortex source, and MathJSON — along with any diagnostics |
| `check`     | Validate a program's syntax without evaluating it              |
| `doc`       | Look up a library function by name, or search the library by keywords |
| `parse`     | Convert Cortex source to MathJSON                              |
| `serialize` | Convert MathJSON to Cortex source                              |

The server also publishes the [language card for AI agents](/cortex/for-agents/)
as a resource (`cortex://docs/for-agents`), and its setup instructions tell
the assistant to read it before writing Cortex — so the assistant learns the
language's syntax and idioms on its own.

## Trying It Out

Ask your assistant something that benefits from exact computation, and
mention Cortex if it doesn't reach for the tools on its own:

- _"Use Cortex to compute the exact value of the sum of 1/k² for k from 1
  to 100."_
- _"Solve x³ − 6x² + 11x − 6 = 0 exactly with Cortex."_
- _"What does the Cortex function `Reduce` do?"_

The assistant writes a small Cortex program, runs it with the `evaluate`
tool, and reports the result — exact fractions, radicals, and symbolic
constants included, with none of the rounding or slips of doing arithmetic
token by token.

## Good to Know

- **Each `evaluate` call is independent.** A call runs a complete program in
  a fresh session; definitions do not carry over from one call to the next.
  The assistant knows this and writes self-contained programs.
- **Evaluations have a deadline.** By default a program is canceled after
  10 seconds. Start the server with `cortex mcp --time-limit <ms>` to change
  the default (`0` disables it); the assistant can also adjust it per call.
- **Everything runs locally.** The server is part of the npm package: no
  network service is involved, and programs evaluate in the local Node.js
  process.

<ReadMore path="/cortex/cli/">
The same package also provides a **command-line interface and interactive
REPL** for using Cortex yourself.
</ReadMore>
