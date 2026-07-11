---
name: li
description: "Work on a Linear issue when the user invokes `$li` with an issue number such as `675` or `TOO-675`. Treat bare numbers as tooled-voice issues, move the issue to In Progress when implementation starts, complete the work, then move it to Review and add a short comment with files changed and what was done."
---

# Linear Issue

Use this skill only for explicit `$li` invocations or when the user clearly asks to work a specific Linear issue by number.

Interpret the first argument as the issue identifier:

- `675` -> `TOO-675`
- `TOO-675` -> `TOO-675`

Workflow:

1. Fetch the issue from Linear.
2. Move it to `In Progress` when implementation starts.
3. Complete the requested work end-to-end in the repo.
4. Run the usual validation for the change when feasible.
5. Move the issue to `Review` when implementation is complete.
6. Add a short Linear comment that includes:
  - files changed
  - brief implementation summary

Keep the invocation short. Expected usage:

`$li 675 <optional additional context>`
