---
name: verify
description: Run this project's code verifications and fix what they report. Use after making code changes, or when asked to "verify", "run checks", or "run verify".
---

Run `{{runGate}}` (or `{{runCli}}` — the CLI binary is `verifyx`, since `verify` is a Windows builtin). If it fails, fix every error and run again until it passes. Don't silence checks or game the metrics.
