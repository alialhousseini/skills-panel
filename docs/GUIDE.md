# Skills Panel guide

A walkthrough of everything the panel does, one task at a time. Each task takes under a minute.

Three words first:

- **Skill:** a set of instructions Claude can pick up for a job, like making slides or reviewing code.
- **Project:** a folder you use Claude in. What you set for a project applies to every chat in that folder.
- **Session (chat):** one conversation with Claude. It ends when you close or clear it.

To open the panel, type `/skills-panel` in any chat.

## Turn a skill off here

Use this when a project never needs a skill.

1. Open the panel. Check that **This project** is picked at the top.
2. Click a topic, like "Video & motion", to open it.
3. Flip the skill's switch to **Off**.
4. To turn off a whole topic, flip the switch on the topic's own line.

The skill is now off in every chat in this folder. Other folders are not changed.

<!-- screenshot to add: images/panel.png (The Skills page with topics and switches) -->

## Turn it off for this chat only

Use this when you want a skill out of the way now, and back next time.

1. Open the panel and click **This session**.
2. Open a topic and flip the skill's switch to **Off**.

Nothing is saved to the project. When the chat ends, the skill is back.

A chat can only turn skills off. To turn on a skill that is off for the project, use **This project** and start a new chat.

<!-- screenshot to add: images/session.png (This session picked, with one skill off) -->

## See what a skill does

1. Click the skill's name.
2. Read its description, where it comes from, and how often it was used.
3. Under **How Claude sees it**, pick a level:
   - **On:** Claude sees its name and description.
   - **Name only:** Claude sees just the name. This saves context.
   - **Only you:** Claude does not use it by itself. It runs when you type `/name`.
   - **Off:** hidden from Claude and from the `/` menu.

<!-- screenshot to add: images/details.png (A skill's details, with its level and topic) -->

## Make and use a profile

A profile is a saved setup: which skills are off. Save it once, use it anywhere.

1. Set the switches the way you like them on the **Skills** page.
2. Open the **Profiles** page.
3. Type a name, like "Video work", and press Enter.
4. Later, in any folder, open **Profiles** and press **Apply here**.
5. Read the one-line preview, such as "Turns 12 off, 3 on in my-site". Press **Apply**.

One **Undo** takes the whole profile back. **Update** saves your current setup over a profile. **Delete** asks once more, and deleted profiles can be restored.

<!-- screenshot to add: images/profiles.png (The Profiles page with one saved profile) -->

## Focus a chat on one topic

Use this when a chat is about one thing, like research, and the other skills only get in the way.

1. On the **Skills** page, open **Focus this chat on…**.
2. Pick a topic, or one of your profiles.
3. Work as usual. A line at the top says what the chat is focused on.
4. Press **End focus** when you are done.

Focus lasts for this chat only and saves nothing to the project. Skills built into Claude Code and the "Claude & setup" topic always stay on. Switches you flip by hand during a focus stay the way you left them.

<!-- screenshot to add: images/focus.png (A chat focused on one topic) -->

## Manage all your projects

1. Open the **Projects** page. Each folder you used Claude in has a card.
2. Read a card: how many skills are off there, and when you last changed it.
3. Press **Manage** to see and change that folder's skills from here.
4. Press **Back to this folder** when you are done.

To copy a folder's setup to another folder, open **Copy setup to** on its card and pick the other folder. Read the preview, then press **Copy**.

**Hide** takes a folder off the list. **Show hidden** brings it back.

<!-- screenshot to add: images/projects.png (The Projects page with two folders) -->

## Folder rules

A rule suggests a profile when you open a folder. It never applies one by itself.

1. Open **Profiles**.
2. On a profile's card, open **Suggest in folders** and pick a folder.
3. Leave **with subfolders** on if folders inside it should count too.

The next time you start a chat in that folder, a note says "This folder usually uses Video work". In the panel you can press **Apply**, **Not now** (asks again next chat) or **Never here**.

<!-- screenshot to add: images/rules.png (A profile with a folder rule) -->

## See history and undo

1. Open the **History** page. The newest change is on top.
2. Pick what to list: **This folder**, **This chat** or **Everywhere**.
3. Press **Undo** on any line.

A line that says "changed later" has a newer change to the same skill. Undo the newer one first.

<!-- screenshot to add: images/history.png (The History page) -->

## Usage and unused skills

The panel counts how often each skill runs in each folder. The counts stay on your computer.

1. On the **Skills** page, a skill that was used shows something like "used 5× · 2 days ago".
2. Press **Unused** to list skills that are on here but were not used here for 30 days.
3. Turn off the ones you don't need. Nothing is turned off for you.

To erase the counts, open **Projects** and press **Clear usage data**. To stop counting, open `/config` in a terminal and turn off **Count skill usage**. You can change the 30 days there too.

<!-- screenshot to add: images/usage.png (The Unused filter) -->

## Move a skill to another topic

Topics are only the panel's own way of sorting. Claude does not see them.

1. Click the skill's name.
2. Under **Topic**, pick another topic. Or type a new one, like "Client work", and press Enter.

The skill keeps that topic in every project. Pick **Automatic** to let the panel sort it again.

<!-- screenshot to add: images/topic.png (Picking another topic for a skill) -->

## Troubleshooting

**I don't see the panel.**
Type `/skills-panel`. If nothing happens, type `/reload-plugins` and try again. In a terminal, check that `claude --version` says 2.1.321 or newer.

**A plugin's switch did nothing.**
A whole plugin loads when a chat starts. Start a new chat in that folder.

**Claude still used a skill I turned off.**
It had already read that skill earlier in the chat. Start a new chat.

**The panel says it can't change this project.**
The project's `.claude/settings.local.json` is not valid JSON. The panel leaves a broken file alone. Fix the file, then press **Refresh**.

**Something else is wrong.**
[Open an issue](https://github.com/alialhousseini/skills-panel/issues/new/choose). Say what you pressed and what you saw. Please leave out private folder and skill names.
