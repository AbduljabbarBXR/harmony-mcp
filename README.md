# harmony-mcp

Repo rules enforcement for AI agents. Harmony checks diffs against the repository rule set and returns findings before a change lands. It gives an agent the same guard rails a senior reviewer would: no trailing whitespace, no debug leftovers, no committed secrets, and any custom policy the repo declares.

Built as an MCP server, so it works in any platform that speaks Model Context Protocol: CLI agents, Cursor style editors, VS Code extensions, Kilo, and terminals.

## Why

Agents follow instructions inconsistently. A repo declares a convention in AGENTS.md, an agent edits ten files, and the convention is broken on the eleventh. No one notices until a human reviews. Harmony turns declared rules into a check that runs on every diff, before the patch is applied.

## Tools

### rules.load

Load the rule set for a repository. Returns the built in rules plus any custom rules from `.harmony/rules.json`.

### rules.check

Check a diff against the rule set. If no diff is provided, the working tree diff of the repository is used. Returns findings with file, line, rule, severity, and the offending content.

## Built in rules

| id | severity | checks |
| --- | --- | --- |
| no-trailing-whitespace | warning | lines ending in spaces or tabs |
| no-debug-leftovers | warning | console.log, console.debug, debugger |
| no-committed-secrets | blocker | api keys, passwords, tokens, and common secret shapes |
| no-tabs | info | tab indentation in changed code |

## Custom rules

Add a `.harmony/rules.json` at the repository root. Each rule declares an id, a regex, a message, matching files, and a severity.

```json
{
  "rules": [
    {
      "id": "no-hyphens-ui",
      "regex": "[a-z]-[a-z]",
      "message": "No dashes in UI text",
      "files": ["**/*.astro", "**/*.md", "**/*.html"],
      "severity": "warning"
    },
    {
      "id": "no-todo-merge",
      "regex": "TODO\\s*:\\s*(merge|rebase)",
      "message": "TODO markers must not reference merge or rebase work",
      "files": ["**/*"],
      "severity": "blocker"
    }
  ]
}
```

File patterns support `*` and `**` globs.

## Usage

Run the server:

```bash
harmony-mcp
```

Configure it as an MCP server in your client:

```json
{
  "mcpServers": {
    "harmony": {
      "command": "harmony-mcp",
      "args": []
    }
  }
}
```

Then ask the agent:

* "Check the current diff against the repo rules."
* "Block any change that adds a secret."
* "Does the diff violate AGENTS.md?"

## Install

```bash
npm install -g harmony-mcp
```

## License

MIT. Part of the Tawakkul Labs open source family alongside HEIDES, Heides Lens, Cornea, and HEIDES VOLT.