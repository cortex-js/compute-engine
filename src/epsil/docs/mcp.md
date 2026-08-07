---
title: Epsil MCP Server
sidebar_label: MCP Server
slug: /epsil/mcp/
description: "Connect AI assistants to Epsil with the built-in Model Context Protocol server: exact arithmetic, symbolic computation, and library documentation as tools."
hide_title: true
date: Last Modified
---
# Using Epsil with AI Assistants

<Intro>
The `epsil` command includes a [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server. Connect it to ChatGPT, Claude Code, Claude Desktop, or another
MCP client, and your AI assistant can evaluate Epsil programs — exact
arithmetic, symbolic computation, calculus, linear algebra — instead of doing
math "in its head".
</Intro>

:::warning[Experimental]
Epsil is experimental. Its syntax and behavior may change between releases.
:::

## Setup for Local MCP Clients

With **Claude Code**, register the server with a single command:

```shell
claude mcp add epsil -- npx -y @cortex-js/compute-engine mcp
```

For **Claude Desktop** and most other MCP clients, add the server to the
client's JSON configuration:

```json
{
  "mcpServers": {
    "epsil": {
      "command": "npx",
      "args": ["-y", "@cortex-js/compute-engine", "mcp"]
    }
  }
}
```

If the Compute Engine package is already installed in your project, you can
run the local copy instead of downloading one: use `npx epsil mcp` (that
is, `"command": "npx", "args": ["epsil", "mcp"]`).

That's it. The next time you start the client, the Epsil tools are
available to the assistant.

## Setup for ChatGPT

ChatGPT developer mode connects to a public HTTPS MCP endpoint using
Streamable HTTP or to an
[OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels);
it cannot start the local stdio command directly. A Secure MCP Tunnel is the
recommended way to connect the local Epsil server without opening an inbound
port or making it public.

1. In ChatGPT, open **Settings → Security and login** and enable
   **Developer mode**. Availability depends on your account and workspace
   policy.

2. Create a tunnel in the
   [OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels),
   associate it with the ChatGPT workspace that will use Epsil, and copy its
   `tunnel_id`. Download `tunnel-client` from the link in those settings or
   from its
   [latest release](https://github.com/openai/tunnel-client/releases/latest).

3. Configure `tunnel-client` to launch Epsil over stdio, validate the
   configuration, and run it:

   ```shell
   export CONTROL_PLANE_API_KEY="sk-..."

   tunnel-client init \
     --sample sample_mcp_stdio_local \
     --profile epsil \
     --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
     --mcp-command "npx -y @cortex-js/compute-engine mcp"

   tunnel-client doctor --profile epsil --explain
   tunnel-client run --profile epsil
   ```

   Replace the example API key and tunnel ID with your own values. Keep
   `tunnel-client run` running while using Epsil from ChatGPT.

4. In ChatGPT, open **Settings → Plugins**, select the plus button, choose
   **Tunnel** under **Connection**, and select the tunnel you created.

5. Start a new conversation, add Epsil from the tools menu, and try one of
   the prompts below. ChatGPT should discover the five Epsil tools and use
   `evaluate` for a computation.

See OpenAI's
[developer-mode connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
for current availability and interface details.

### Alternative: Public Development Endpoint

You can instead start Epsil's native Streamable HTTP transport and expose it
through an HTTPS development tunnel.

1. Start the local HTTP endpoint:

   ```shell
   npx -y @cortex-js/compute-engine mcp \
     --transport streamable-http \
     --port 8000
   ```

   The MCP endpoint is now available locally at
   `http://localhost:8000/mcp`.

2. In another terminal, expose port 8000 with an HTTPS tunnel that supports
   streaming. For example, with [ngrok](https://ngrok.com/docs/getting-started/):

   ```shell
   ngrok http 8000
   ```

3. Append `/mcp` to the HTTPS forwarding URL printed by ngrok. For example:
   `https://example.ngrok.app/mcp`.

4. In ChatGPT, open **Settings → Plugins**, select the plus button, and create
   a connection using the public `/mcp` URL. Do not enter the localhost URL;
   ChatGPT must be able to reach the endpoint from the Internet.

:::warning[Development only]
The public development URL is temporary and, unless you configure tunnel
authentication, reachable by anyone who knows it while both processes are
running. Stop the tunnel and Epsil server after testing. For shared or
production use, use Secure MCP Tunnel or put the HTTP endpoint behind a stable
HTTPS reverse proxy with appropriate authentication, rate limits, logging,
and monitoring.
:::

## What the Assistant Gets

| Tool        | Purpose                                                        |
| :---------- | :------------------------------------------------------------- |
| `evaluate`  | Run an Epsil program and return its value — as display text, Epsil source, and MathJSON — along with any diagnostics |
| `check`     | Validate a program's syntax without evaluating it              |
| `doc`       | Look up a library function by name, or search the library by keywords |
| `parse`     | Convert Epsil source to MathJSON                              |
| `serialize` | Convert MathJSON to Epsil source                              |

The server also publishes the [language card for AI agents](/epsil/for-agents/)
as a resource (`epsil://docs/for-agents`), and its setup instructions tell
the assistant to read it before writing Epsil — so the assistant learns the
language's syntax and idioms on its own.

## Trying It Out

Ask your assistant something that benefits from exact computation, and
mention Epsil if it doesn't reach for the tools on its own:

- _"Use Epsil to compute the exact value of the sum of 1/k² for k from 1
  to 100."_
- _"Solve x³ − 6x² + 11x − 6 = 0 exactly with Epsil."_
- _"What does the Epsil function `Reduce` do?"_

The assistant writes a small Epsil program, runs it with the `evaluate`
tool, and reports the result — exact fractions, radicals, and symbolic
constants included, with none of the rounding or slips of doing arithmetic
token by token.

## Good to Know

- **Each `evaluate` call is independent.** A call runs a complete program in
  a fresh session; definitions do not carry over from one call to the next.
  The assistant knows this and writes self-contained programs.
- **Evaluations have a deadline.** By default a program is canceled after
  10 seconds. Start the server with `epsil mcp --time-limit <ms>` to change
  the default (`0` disables it); the assistant can also adjust it per call.
- **The computation runs locally by default.** The server is part of the npm
  package, and programs evaluate in the Node.js process that runs
  `epsil mcp`. A ChatGPT connection still uses the configured Secure MCP
  Tunnel or HTTPS endpoint to reach that process.
- **The HTTP transport is local by default.** It binds to `127.0.0.1`, limits
  requests to 1 MiB, and rejects unapproved browser origins. Use `--host`,
  `--port`, and `--path` to configure the listener. Repeat
  `--allow-origin <origin>` for browser clients that run on another origin.
  Binding to a public interface does not add authentication or TLS.

<ReadMore path="/epsil/cli/">
The same package also provides a **command-line interface and interactive
REPL** for using Epsil yourself.
</ReadMore>
