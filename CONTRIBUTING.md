# Contributing

Thanks for wanting to help. You need Claude Code 2.1.321 or newer and a GitHub account. Nothing else: no build step, no packages to install.

## Five steps

1. **Fork and clone.** Fork this repository on GitHub, then:

   ```bash
   git clone https://github.com/<you>/skills-panel
   ```

2. **Run your copy.** Start Claude Code with your clone loaded:

   ```bash
   claude --plugin-dir <path to your clone>
   ```

   Type `/skills-panel`. Each time you save a file, Claude Code loads it again. If you already have the published plugin installed, turn it off first (`claude plugin disable skills-panel@skills-panel`), so two copies don't run at once.

   To keep your copy installed for every session instead:

   ```bash
   claude plugin marketplace add <path to your clone>
   ```

   ```bash
   claude plugin install skills-panel@skills-panel
   ```

   After an edit, type `/reload-plugins`.

3. **Make the change.** Keep it small. One pull request, one idea.

4. **Check it.** Both must pass, and both run with no login:

   ```bash
   claude plugin validate .
   ```

   ```bash
   claude plugin test .
   ```

5. **Open a pull request.** The template has a short checklist. CI runs the same two checks.

Not sure an idea fits? Open a [discussion](https://github.com/alialhousseini/skills-panel/discussions) first. Issues marked [good first issue](https://github.com/alialhousseini/skills-panel/labels/good%20first%20issue) are a good place to start.

## Rules the panel keeps

A change that breaks one of these will not be merged.

- **Keep it simple.** If a feature needs a paragraph to explain, simplify the feature. At most one line of help per screen, in plain words.
- **Never touch skill files.** The panel does not edit, move or delete them.
- **Write only three things** in a project's `.claude/settings.local.json`: `skillOverrides`, `Skill(...)` deny rules and `enabledPlugins`. Every other key stays as it was. A file that is not valid JSON is never overwritten.
- **One action, one journal entry.** Undo must put back exactly what was there.
- **Nothing automatic.** The panel may suggest. It changes settings only when someone presses a button.
- **Local only.** No network calls and no telemetry.
- **Nothing private in the repository.** Tests use neutral names (`alpha`, `beta`, `gamma`, `C:/proj`). No real folder names, client names or personal skill names in code, tests, docs or commit messages.

## Where things are

| File | What it holds |
| --- | --- |
| `hooks/register.tsx` | All state, what each press does, and the hooks |
| `hooks/page-*.tsx` | One file per page: Skills, Profiles, Projects, History |
| `hooks/ui.tsx` | What the pages share: tabs, switches, captions |
| `hooks/lib.ts`, `model.ts`, `profiles.ts`, `history.ts`, `usage.ts`, `folders.ts` | Logic with no engine calls, so tests can call it directly |
| `hooks/disk.ts`, `store.ts` | Reading files and the panel's own store |
| `types/index.d.ts` | Types, and the list of state values |
| `tests/world.ts` | The fake computer every test runs on |
| `tests/*.test.tsx` | One file per feature |

## Things that cost time before

- Claude Code refuses a local variable named `on` or `next` in a plugin.
- A state value (an `atom`) must be defined in the file that reads or writes it. Keep them in `hooks/register.tsx`.
- A `Button` may hold only text. The terminal has no `Svg`, so every picture needs a text fallback.
- Decide what a switch does when it is pressed, from the state at that moment, not from what was drawn.
- When a stored value changes shape, change its shape tag (`view-3` becomes `view-4`), so an old value is not read as a new one.
- Every engine call the plugin makes needs an answer in `tests/world.ts`, or the test fails.

## Types

Once Claude Code has loaded your clone, it writes its type files into `.claude-plugin/types/` (git ignores that folder). Then this checks your types:

```bash
npx -p typescript tsc -p .
```

## Updating the Claude Code version CI uses

CI installs a pinned version of Claude Code. To move it, change the version in `.github/workflows/ci.yml` and `.github/workflows/release.yml` in one pull request.

## Releases (maintainers)

1. Set the new version in `.claude-plugin/plugin.json` and add it to `CHANGELOG.md`.
2. Merge to `main` and wait for CI.
3. Tag it: `git tag v1.2.3`, then `git push origin v1.2.3`. The release workflow checks the tag against `plugin.json`, runs the tests, and attaches `skills-panel.plugin` to the release.
