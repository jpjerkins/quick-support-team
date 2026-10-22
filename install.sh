#!/usr/bin/env bash
# Installs a copy of this repo (never run live from the source folder) and links the command and skills.
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
dest="${QST_INSTALL_DIR:-$HOME/.local/share/quick-support-team}"
mkdir -p "$(dirname "$dest")" "$HOME/.local/bin"
rm -rf "$dest.new"
mkdir -p "$dest.new"
cp -a "$src/bin" "$src/src" "$src/skills" "$src/templates" "$dest.new/"
git -C "$src" rev-parse HEAD > "$dest.new/VERSION" 2>/dev/null || echo unknown > "$dest.new/VERSION"
rm -rf "$dest.old"; [ -d "$dest" ] && mv "$dest" "$dest.old"; mv "$dest.new" "$dest"; rm -rf "$dest.old"
ln -sfn "$dest/bin/qst" "$HOME/.local/bin/qst"
for dir in "$HOME/.claude/skills" "$HOME/.agents/skills"; do
  mkdir -p "$dir"
  for s in "$dest"/skills/*/; do ln -sfn "$s" "$dir/$(basename "$s")"; done
done
echo "installed $(cat "$dest/VERSION") to $dest; qst -> ~/.local/bin/qst; skills linked into ~/.claude/skills and ~/.agents/skills"
