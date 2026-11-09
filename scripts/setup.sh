#!/usr/bin/env bash
# One-time setup after cloning: install the tracked git hooks.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
chmod +x scripts/hooks/*
git config core.hooksPath scripts/hooks
echo "Hooks installed (core.hooksPath=scripts/hooks)."
python3 scripts/sync_title.py
