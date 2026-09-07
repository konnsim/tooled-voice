---
name: li
description: "Work on a Linear issue when the user invokes `$li` with an issue number such as `675` or `TOO-675`. Treat bare numbers as tooled-voice issues, move the issue to In Progress when implementation starts, implement and validate the work, and move it to Review only after its code is committed and pushed for client review."
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
5. Keep the issue `In Progress` until the code implementing it is committed and successfully pushed. Local completion, passing checks, or a local commit alone do not qualify for `Review`.
6. Commit and push only when the user authorizes those actions; invoking this skill does not authorize them. When a later authorized commit/push publishes the issue's completed changes, verify that the relevant commits reached the remote, then move the issue to `Review`.
7. Add a short Linear comment with files changed, implementation summary, validation, and whether the changes are still local or published.

`Review` means the client can check the published changes and provide feedback or accept them. Client follow-up work returns to `In Progress` when implementation resumes and follows the same commit-and-push requirement before returning to review.

Keep the invocation short. Expected usage:

`$li 675 <optional additional context>`
