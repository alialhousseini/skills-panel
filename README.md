# Skills Panel for Claude Code

Switch Claude's skills on and off with simple switches, for one project or just one chat.

[![CI](https://github.com/alialhousseini/skills-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/alialhousseini/skills-panel/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alialhousseini/skills-panel)](https://github.com/alialhousseini/skills-panel/releases/latest)
[![License: MIT](https://img.shields.io/github/license/alialhousseini/skills-panel)](LICENSE)
[![Stars](https://img.shields.io/github/stars/alialhousseini/skills-panel?style=social)](https://github.com/alialhousseini/skills-panel/stargazers)

## Why you'd want it

- **Too many skills make Claude pick the wrong one.** Turn off the ones a project doesn't need.
- **Every skill costs context.** The panel shows how much your skill list takes, and what you save.
- **Different projects need different skills.** Save a setup once, then use it in any folder.

## Install (1 minute)

**Claude desktop app**

1. Click **+** next to the message box.
2. Click **Plugins**, then **Add marketplace**.
3. Type `alialhousseini/skills-panel`.
4. Click **Add plugin**.

**Claude Code in a terminal**

```
/plugin install skills-panel --marketplace alialhousseini/skills-panel
```

Answer `y` to add the source, then press Enter to install it for yourself. If it shows two options, keep them as they are.

**From a shell**

```bash
claude plugin install skills-panel --marketplace alialhousseini/skills-panel
```

Needs Claude Code 2.1.321 or newer. The desktop app already has it. In a terminal, `claude --version` shows yours and `claude update` gets the newest.

## Use it (30 seconds)

1. Type `/skills-panel`. The panel opens beside your chat.
2. Pick **This project** (kept for this folder) or **This session** (this chat only).
3. Flip a switch to turn a skill off or on. A topic's switch flips the whole topic.
4. Click a skill's name to see what it does and how often it is used.
5. Press **Undo** to take back anything.

## The four pages

| Page | What you do there |
| --- | --- |
| **Skills** | Flip switches. Or pick "Focus this chat on…" to keep one topic on for one chat. |
| **Profiles** | Save your setup under a name, like "Video work". Apply it in any folder. |
| **Projects** | See all your folders. Manage one from here, or copy its setup to another. |
| **History** | See every change, newest first. Undo any of them. |

## What it changes, and what it never touches

| When you switch… | The panel changes… |
| --- | --- |
| a skill, for a project | `skillOverrides` in that project's `.claude/settings.local.json` |
| a plugin's skill, for a project | a `Skill(plugin:skill)` line under `permissions.deny` in the same file |
| a whole plugin, for a project | `enabledPlugins` in the same file |
| anything, for one chat | no file. The panel hides the skill from Claude for that chat. |

- It never edits your skill files. It never moves or deletes them either.
- No internet, no tracking. Everything stays on your computer.
- Every change to your settings can be undone, even days later.
- Every other line in that settings file stays as it was.

## FAQ

**Does it send data anywhere?**
No. The panel makes no network calls. Your profiles, history and usage counts stay on your computer.

**Why can't I turn a plugin skill on for one chat?**
One chat can only turn skills off. A skill that is off for the project is not loaded into the chat, so there is nothing to switch on. Turn it on under **This project**, then start a new chat.

**Nothing happens in my terminal.**
Your Claude Code is older than 2.1.321. Run `claude update`, then start it again.

**How do I undo?**
Press **Undo** on the Skills page to take back the last change. For an older one, open **History** and press **Undo** on its line.

**Where are my profiles stored?**
In the panel's own file under `~/.claude/plugins/store/`. They are not in your projects, so they are never committed with your code.

**Will my teammates see my switches?**
No. They go in `settings.local.json`, which is your own file. If the panel has to create it inside a git repository, it also adds it to `.git/info/exclude` so it is not committed by accident.

**Claude still used a skill I turned off.**
It had already read that skill earlier in the chat. Start a new chat and it is gone.

**How do I turn off the usage counts?**
In a terminal, type `/plugin configure skills-panel@skills-panel` and turn off **Count skill usage**. The **Projects** page has a button that clears what was counted.

## Uninstall

First put your projects back if you want to: on the Skills page press **Changed**, then **Back to default**. Switches you leave in place keep working without the panel.

- **Desktop app:** click **+** next to the message box, then **Plugins**, and remove Skills Panel.
- **Terminal:** `/plugin uninstall skills-panel@skills-panel`
- **Shell:** `claude plugin uninstall skills-panel@skills-panel`

## Links

[Guide](docs/GUIDE.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [License](LICENSE)

⭐ Star it if it helps you.
