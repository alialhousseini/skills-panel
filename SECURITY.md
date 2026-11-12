# Security

## Report a problem privately

Please do not open a public issue for a security problem.

1. Open the [private report form](https://github.com/alialhousseini/skills-panel/security/advisories/new) (the **Security** tab, then **Report a vulnerability**).
2. Say what you found, how to see it, and which version of the plugin and of Claude Code you use.

Only the maintainers can read your report. One of them will reply there as soon as they can, and will tell you when a fix is released.

## Which versions get fixes

The newest release. Update with `claude plugin update skills-panel@skills-panel`.

## What the plugin can reach

It helps to know what is normal, so you can tell what is not.

- It **writes** three keys in a project's `.claude/settings.local.json` (`skillOverrides`, `Skill(...)` deny rules, `enabledPlugins`), one line in a repository's `.git/info/exclude` when it has just created that settings file, and its own store.
- It **reads** your skills' `SKILL.md` files, the list of installed plugins, the list of folder names Claude Code keeps, and each listed folder's `.claude/settings.local.json`.
- It **runs** one program, `git`, with two read-only commands (`check-ignore` and `rev-parse`), and only right after it created a settings file.
- It makes **no network calls**.

Anything beyond this is a bug worth reporting.
