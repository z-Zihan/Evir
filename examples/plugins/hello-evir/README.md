# hello-evir — example Evir plugin

Demonstrates every v1.1 contribution point without any JS runtime:

- `contributes.slashCommands` — `/hello` inserts a prompt template.
- `contributes.skillsFrom: "skills/"` — at install time Evir reads
  `skills/<id>/SKILL.md` (plus optional `manifest.json` metadata) through its
  Rust path boundary and copies the body into the plugin record. Nothing is
  read from this folder afterwards.
- `contributes.settings` — one boolean toggle.

## Install

Settings → 插件 / Plugins → 从本地文件夹安装 → choose this folder → review
the permission list → confirm. Uninstalling removes the plugin record and its
contributions; this folder on disk is never touched.
