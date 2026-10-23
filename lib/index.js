/**
 * dsh-research-commands — one-click slash commands for installed research skills.
 *
 * DSH registers human slash commands in code via `ctx.commands.register()`; they
 * cannot be created by dropping files. ARIS's documented `/xxx` syntax is
 * Claude Code-only, so this plugin bridges the gap: each registered command
 * reads the matching skill's SKILL.md and injects it into the conversation as a
 * user message, which makes the model execute that skill.
 *
 * Design constraints (verified against the running DSH 0.2.0-rc.2):
 *  - No `@deepseek-ai/*` imports. Those packages are host-provided
 *    peerDependencies pinned to 0.2.0-rc.2, while npm publishes a different,
 *    older 0.0.1-rc.1 — importing them would risk a second, mismatched copy of
 *    the harness core. Only Node builtins are used.
 *  - The message the command injects is built as a plain object literal and
 *    handed to `agent.steer()`, mirroring how the built-in `/plan` command
 *    drives model-visible work.
 *
 * @module dsh-research-commands
 */

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Plugin identity for the loader roster. */
export const name = "research-commands";

/** The command registry is the only host service this plugin needs. */
export const inject = ["commands"];

/**
 * Command table: slash name -> skill directory under the user skill root.
 *
 * Names are deliberately short and never collide with DSH built-ins
 * (/model, /plan, /compact, /permission, /export, /file).
 */
const COMMANDS = [
  { cmd: "idea",     skill: "idea-discovery",       label: "找idea全流程",   hint: "[研究方向]" },
  { cmd: "novelty",  skill: "novelty-check",        label: "查新",           hint: "[idea 或方法描述]" },
  { cmd: "figure",   skill: "nature-figure",        label: "论文配图",       hint: "[数据或图的描述]" },
  { cmd: "polish",   skill: "nature-polishing",     label: "论文润色",       hint: "[文件路径或正文]" },
  { cmd: "review",   skill: "nature-reviewer",      label: "模拟审稿",       hint: "[论文路径或片段]" },
  { cmd: "cite",     skill: "citation-audit",       label: "审查引用",       hint: "[论文目录或 .bib 文件]" },
  { cmd: "read",     skill: "nature-paper-xray",    label: "精读论文",       hint: "[论文路径或 arXiv ID]" },
  { cmd: "poster",   skill: "paper-poster-html",    label: "做海报",         hint: "[论文目录或 PDF]" },
  { cmd: "slides",   skill: "paper-slides",         label: "做PPT",          hint: "[论文目录或时长]" },
  { cmd: "paper",    skill: "paper-writing",        label: "写论文全流程",   hint: "[报告路径或主题]" },
  { cmd: "exp",      skill: "experiment-plan",      label: "实验计划",       hint: "[方法或提案描述]" },
  { cmd: "analyze",  skill: "analyze-results",      label: "分析结果",       hint: "[结果路径或描述]" },
  { cmd: "lit",      skill: "research-lit",         label: "文献综述",       hint: "[主题或论文 URL]" },
  { cmd: "respond",  skill: "nature-response",      label: "审稿意见回复",   hint: "[审稿意见路径]" },
  { cmd: "html",     skill: "render-html",          label: "渲染HTML",       hint: "<input.md>" },
];

/** Candidate skill roots, in resolution order. */
function skillRoots() {
  const home = homedir();
  return [
    join(home, ".dsh", "skills"),
    join(home, ".agents", "skills"),
  ];
}

/** Cap on injected skill text, so a pathological file cannot blow up the turn. */
const MAX_SKILL_CHARS = 120_000;

/**
 * Read one skill's SKILL.md from the user skill roots.
 * @param {string} skill - skill directory name.
 * @returns {Promise<{text: string, path: string}|null>} the file text, or null when absent.
 */
async function readSkill(skill) {
  for (const root of skillRoots()) {
    const file = join(root, skill, "SKILL.md");
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      let text = await readFile(file, "utf8");
      if (text.length > MAX_SKILL_CHARS) {
        text = `${text.slice(0, MAX_SKILL_CHARS)}\n\n[truncated: SKILL.md exceeded ${MAX_SKILL_CHARS} characters]`;
      }
      return { text, path: file };
    } catch {
      // try the next root
    }
  }
  return null;
}

/** Strip the leading YAML frontmatter block; the body is what the model follows. */
function stripFrontmatter(text) {
  const m = /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/**
 * Build the user message a command injects.
 *
 * Shaped the same way the harness's own `createUserMessage` output is
 * (`{ role, content, source }`); built locally to avoid the host import.
 */
function userMessage(text) {
  return {
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  };
}

/**
 * Compose the instruction that makes the model run the requested skill.
 * @param {string} label - human label, e.g. 论文配图.
 * @param {string} skill - skill directory name.
 * @param {string} body - SKILL.md body (frontmatter stripped).
 * @param {string} userInput - text the user typed after the command name.
 */
function composePrompt(label, skill, body, userInput) {
  const ask = userInput.trim();
  const request = ask === ""
    ? "(no extra input was provided — if the skill needs a target, ask me for it before proceeding)"
    : ask;
  return [
    `Use the \`${skill}\` skill for this task (${label}). Follow its instructions below as the procedure.`,
    "",
    "## My request",
    request,
    "",
    `## Skill instructions (\`${skill}\`)`,
    body.trim(),
  ].join("\n");
}

/**
 * Register every research command.
 * @param {object} ctx - plugin context carrying the command registry.
 */
export function apply(ctx) {
  for (const { cmd, skill, label, hint } of COMMANDS) {
    ctx.effect(function* () {
      yield ctx.commands.register({
        name: cmd,
        description: `${label} — run the \`${skill}\` skill`,
        input: { hint },
        handler: async ({ agent, rawInput }) => {
          const found = await readSkill(skill);
          if (found === null) {
            return {
              kind: "error",
              text: `Skill "${skill}" was not found under ~/.dsh/skills or ~/.agents/skills.`,
            };
          }
          const body = stripFrontmatter(found.text);
          const steer = agent?.steer;
          if (typeof steer !== "function") {
            return {
              kind: "error",
              text: `This harness does not expose agent.steer, so /${cmd} cannot start the skill.`,
            };
          }
          steer.call(agent, userMessage(composePrompt(label, skill, body, rawInput ?? "")));
          return {
            kind: "success",
            text: `Started ${label} (\`${skill}\`).`,
          };
        },
      });
    }, `research-command-${cmd} lifecycle`);
  }
}
