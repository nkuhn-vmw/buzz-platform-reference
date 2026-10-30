#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
revision=5d70622ac0b1b7bf940803cc8f912f0e82a4c946
source_dir="$root/upstream/agent"
target_dir="$root/.state/build-cache/agent-target"
builder='rust@sha256:93ce27a88655056a51dbdd8f5f2d7ddc071c7b0070fb288a37b5a285fc83971e'
mkdir -p "$root/upstream" "$target_dir"
if [[ ! -d "$source_dir/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/block/buzz.git "$source_dir"
  git -C "$source_dir" fetch --depth=1 origin "$revision"
  git -C "$source_dir" checkout --detach "$revision"
fi
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$revision" ]] || { echo 'Agent source revision mismatch' >&2; exit 1; }
[[ "$(git -C "$source_dir" remote get-url origin)" == 'https://github.com/block/buzz.git' ]] || { echo 'Unexpected agent source origin' >&2; exit 1; }
patch="$root/integrations/agent/buzz-acp-nip-fi.patch"
if git -C "$source_dir" apply --check "$patch"; then
  [[ -z "$(git -C "$source_dir" status --porcelain)" ]] || { echo 'Agent checkout must be clean before applying the patch' >&2; exit 1; }
  git -C "$source_dir" apply "$patch"
else
  git -C "$source_dir" apply --reverse --check "$patch" || { echo 'Agent patch mismatch; use a fresh checkout' >&2; exit 1; }
  # Compare the checkout to the exact pinned source plus this patch. Temporarily
  # reverse only the known patch, inspect cleanliness, then restore it on every
  # exit path. This catches extra edits in files touched by the patch too.
  restore_patch=0
  restore_applied_patch() {
    if [[ "$restore_patch" == 1 ]]; then
      git -C "$source_dir" apply --check "$patch" && git -C "$source_dir" apply "$patch" || {
        echo 'Could not restore the agent patch after repeat-build validation' >&2
        return 1
      }
      restore_patch=0
    fi
  }
  trap restore_applied_patch EXIT
  git -C "$source_dir" apply --reverse "$patch"
  restore_patch=1
  [[ -z "$(git -C "$source_dir" status --porcelain)" ]] || { echo 'Unexpected changes in agent checkout beyond the pinned patch' >&2; exit 1; }
  restore_applied_patch
  trap - EXIT
fi
docker run --rm --platform linux/amd64 \
  -v "$source_dir:/workspace" -v "$target_dir:/target" \
  -w /workspace "$builder" \
  cargo build --locked --release -j1 -p sprig --target-dir /target
"$root/scripts/package-agent.sh" "$target_dir/release/sprig"
