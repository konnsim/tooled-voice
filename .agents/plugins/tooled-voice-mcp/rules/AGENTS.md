# Tooled Voice MCP Servers (Lazy-Loaded)

This plugin exposes the Tooled Voice MCP servers as **lazy-loaded** tools under `<mcp_servers>`. They do not appear in the top-level eager tool declarations — invoke them via `call_mcp_tool` after reading their schema file from `<appDataDir>/mcp/<serverName>/<toolName>.json`.

Always check `<mcp_servers>` before assuming a service is unavailable or falling back to CLI/env/other tools.

## Available Plugin Servers

- **Linear (`tooled-voice-mcp_linear-tooled-voice`)**: Use this for all Tooled Voice Linear issues, projects, statuses, comments, and cycles.
  - **Team key**: `TOO` (bare issue numbers mean `TOO-<n>`).
  - **Do not use `t3-code`'s `list_issues` / `read_issue` / `create_issue` for Linear** — those only query GitHub Issues for this repository.
- **Supabase (`tooled-voice-mcp_supabase-tooled-voice`)**: Use this for inspection and Supabase operations on the Tooled Voice project (following `AGENTS.md` approval rules).
