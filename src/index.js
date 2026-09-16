#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = new McpServer({ name: pkg.name, version: pkg.version });

const BUILTIN_RULES = [
  {
    id: "no-trailing-whitespace",
    description: "Changed lines must not end with spaces or tabs",
    regex: "[ \\t]+$",
    message: "Trailing whitespace on a changed line",
    severity: "warning",
    files: ["**/*"],
  },
  {
    id: "no-debug-leftovers",
    description: "Changed lines must not introduce debug statements",
    regex: "\\b(console\\.(log|debug)|debugger)\\b",
    message: "Debug statement left in changed code",
    severity: "warning",
    files: ["**/*.js", "**/*.ts", "**/*.jsx", "**/*.tsx", "**/*.mjs", "**/*.cjs", "**/*.py", "**/*.go", "**/*.rs"],
  },
  {
    id: "no-committed-secrets",
    description: "Changed lines must not contain secret shaped values",
    regex: "(api[_-]?key|secret|password|passwd|token|client[_-]?secret)\\s*[:=]\\s*[\"'][A-Za-z0-9_\\-]{12,}[\"']|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}",
    message: "Secret shaped value on a changed line",
    severity: "blocker",
    files: ["**/*"],
  },
  {
    id: "no-tabs",
    description: "Changed lines must not use tab indentation",
    regex: "\\t",
    message: "Tab character on a changed line",
    severity: "info",
    files: ["**/*.js", "**/*.ts", "**/*.jsx", "**/*.tsx", "**/*.mjs", "**/*.py", "**/*.astro", "**/*.css"],
  },
];

function loadCustomRules(root) {
  const rulesFile = join(root, ".harmony", "rules.json");
  if (!existsSync(rulesFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(rulesFile, "utf8"));
    const rules = Array.isArray(parsed) ? parsed : parsed.rules;
    if (!Array.isArray(rules)) return [];
    return rules
      .map((r) => ({
        id: String(r.id || "custom-rule"),
        description: String(r.description || r.message || "Custom rule"),
        regex: String(r.regex),
        message: String(r.message || "Violates a custom repo rule"),
        severity: r.severity || "warning",
        files: Array.isArray(r.files) && r.files.length ? r.files : ["**/*"],
      }))
      .filter((r) => {
        try {
          new RegExp(r.regex);
          return true;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function globToRegex(pattern) {
  const parts = pattern.split("/");
  let out = "";
  parts.forEach((part, i) => {
    if (part === "**") {
      out += i === parts.length - 1 ? ".*" : "(.*/)?";
      return;
    }
    const escaped = part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
    out += escaped + (i < parts.length - 1 ? "/" : "");
  });
  return new RegExp("^" + out + "$");
}

function matchesFile(pattern, file) {
  return globToRegex(pattern).test(file);
}

function parseDiff(diff) {
  const changed = [];
  let currentFile = null;
  let addLine = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ b/")) {
      currentFile = raw.slice(6);
      continue;
    }
    if (raw.startsWith("diff --git")) {
      const m = raw.match(/diff --git a\/(\S+) b\/(\S+)/);
      if (m) currentFile = m[2];
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      addLine = parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      if (currentFile) {
        changed.push({ file: currentFile, line: addLine, content: raw.slice(1) });
      }
      addLine += 1;
    }
  }
  return changed;
}

function gitDiff(repoPath) {
  const cwd = resolve(repoPath || ".");
  try {
    return execSync("git diff --unified=0 HEAD -- . 2>/dev/null || git diff --unified=0 2>/dev/null", {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function checkLines(changed, rules, root) {
  const findings = [];
  for (const rule of rules) {
    let re;
    try {
      re = new RegExp(rule.regex);
    } catch {
      continue;
    }
    const files = rule.files && rule.files.length ? rule.files : ["**/*"];
    for (const line of changed) {
      if (!files.some((p) => matchesFile(p, line.file))) continue;
      if (re.test(line.content)) {
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          message: rule.message,
          file: relative(root, join(root, line.file)) || line.file,
          line: line.line,
          content: line.content.slice(0, 200),
        });
      }
    }
  }
  return findings;
}

server.registerTool(
  "rules.load",
  {
    description: "Load the rule set for a repository, built in rules plus custom rules from .harmony/rules.json",
    inputSchema: {
      path: z.string().optional().describe("Path to the repository root. Defaults to the current directory."),
    },
  },
  async ({ path }) => {
    const root = resolve(path || ".");
    const builtins = BUILTIN_RULES;
    const custom = loadCustomRules(root);
    const rules = [...builtins, ...custom];
    const manifestFile = join(root, ".harmony", "rules.json");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              repo: root,
              total: rules.length,
              builtin: builtins.length,
              custom: custom.length,
              customRulesFile: existsSync(manifestFile) ? manifestFile : null,
              rules: rules.map((r) => ({
                id: r.id,
                severity: r.severity,
                files: r.files,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "rules.check",
  {
    description:
      "Check a diff against the repository rule set. If diff is omitted, the working tree diff of the repo is used. Returns findings with file, line, rule, and severity.",
    inputSchema: {
      path: z.string().optional().describe("Path to the repository root. Defaults to the current directory."),
      diff: z.string().optional().describe("A unified diff to check. If omitted, git diff HEAD of the repo is used."),
    },
  },
  async ({ path, diff }) => {
    const root = resolve(path || ".");
    const diffText = diff && diff.length ? diff : gitDiff(root);
    if (!diffText || !diffText.trim()) {
      return {
        content: [{ type: "text", text: JSON.stringify({ clean: true, findings: [], diffLines: 0 }) }],
      };
    }
    const changed = parseDiff(diffText);
    const rules = [...BUILTIN_RULES, ...loadCustomRules(root)];
    const findings = checkLines(changed, rules, root);
    const counts = findings.reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    }, {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              clean: findings.length === 0,
              diffLines: changed.length,
              findings: findings.slice(0, 200),
              counts,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);