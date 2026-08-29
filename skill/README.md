# Wiring an agent to Donald

Two pieces: connect the agent to the MCP server, then give it the skill so it
knows to use it. The client's agents are not ours to modify, so both are
additive — no change to how their agents work.

## 1. Connect to the MCP server

Transport is **streamable HTTP**. There is **no authentication** (demo).

```
https://mcp.donald.todes.mx/v1/mcp
```

**Claude Code** — `.mcp.json` in the project, or `~/.claude.json` for every project:

```json
{
  "mcpServers": {
    "donald": {
      "type": "http",
      "url": "https://mcp.donald.todes.mx/v1/mcp"
    }
  }
}
```

**Claude Agent SDK** — add the same entry to the `mcpServers` option when
constructing the agent.

**Any other MCP client** — point it at that URL as a streamable-HTTP server.
Nothing else to configure; there are no headers, tokens or scopes.

Verify the connection by asking the agent to list its tools. You should see
fifteen `donald` tools, starting with `start_run`.

## 2. Give the agent the skill

**Agents that support skills** (Claude Code and anything reading the same
format): copy `donald-flow/` into the agent's skills directory —
`.claude/skills/donald-flow/` for a project, `~/.claude/skills/donald-flow/`
for a user. The `description` in its frontmatter is what makes the agent load it
at the right moment, so keep it intact.

**Agents that do not support skills**: paste the body of
`donald-flow/SKILL.md` (everything below the frontmatter) into the agent's
system prompt. It is written to work standalone.

## Do I need the skill at all?

The MCP server already sends its own instructions at connect time, and a capable
agent will often follow them unprompted. The skill exists because that is not
reliable enough: server instructions tell an agent *how* the tools work, while
the skill is what makes it decide to *use* them, keep its node keys stable, and
report as it goes rather than in one batch at the end.

If an agent connects but never calls `start_run`, the skill is the missing piece.

## 3. Give the demo agent its operational world

For the Nauta demo, also install `nauta-operations/` beside `donald-flow/`. It
gives a real general-purpose agent a small, internally consistent importer world:
suppliers, purchase orders, amendments, invoices, documents, messages and
shipment OP-4471. The operator can then type any free-form request grounded in
those records; there is no scenario selector.

`donald-flow` is the reusable reporting contract. `nauta-operations` is demo
domain knowledge and is not required for agents working in another domain.

## Checking it worked

While an agent runs, the graph is at `https://donald.todes.mx`.

To check without the UI:

```sh
# runs, newest first
curl -s 'https://api.donald.todes.mx/v1/agent-runs?page_size=5'

# live event stream for one run (replace the key)
curl -N 'https://api.donald.todes.mx/v1/runs/<run_key>/stream?after=0'
```

The stream prints `id:`, `event:` and `data:` lines as the agent reports. If it
connects and stays silent, the agent is not reporting — check that it can see
the tools before suspecting the server.

## Known gaps

- **Artifact file uploads are not functional** until R2 credentials are added to
  the deployed config. `attach_artifact` with a `url` or `text` works fine;
  uploading file bytes through the storage API currently returns HTTP 500.
- **No authentication.** Anyone who can reach the MCP URL can write runs, and
  every run lands under one demo tenant. Fine for a demo, not for production.
