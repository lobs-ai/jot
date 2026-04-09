# Jot Development Guide

## Project Overview

**Jot** is a local AI note-taking CLI and mini-agent that learns about you over time. Captures notes, analyzes with local AI models, and builds context that makes future analysis smarter. All data stays offline and private.

## Tech Stack

- **Runtime:** Node.js + TypeScript (ESM)
- **Storage:** SQLite via `better-sqlite3`
- **Backends:** LM Studio / Ollama (OpenAI-compatible API)
- **Build:** TypeScript compiler (`npm run build`)
- **Entry point:** `src/index.ts` → `dist/index.js`
- **Testing:** Vitest

## Commands

| Command | Description |
|---------|-------------|
| `jot note "text"` | Capture a note (instant return, async analysis) |
| `jot edit <id> "content"` | Edit an existing note |
| `jot delete <id> [--force]` | Delete a note (prompts for confirmation) |
| `jot archive <id> [--unarchive]` | Archive or restore a note |
| `jot link <id1> <id2>` | Link two related notes |
| `jot search "query"` | Search notes by content |
| `jot tags [#tag]` | List notes by tag, or show all tags |
| `jot list [--raw] [--archived] [--tag #tag] [--from YYYY-MM-DD] [--to YYYY-MM-DD]` | List all notes with filters |
| `jot summarize` | Summary: counts, top tags, action items |
| `jot analyze` | Run analysis on unanalyzed notes |
| `jot process [--notify]` | Background processing with notifications |
| `jot insights` | Deep corpus analysis (AI-powered) |
| `jot context [user\|gmail\|calendar]` | View learned context |
| `jot google [setup\|gmail\|calendar]` | Google integration settings |
| `jot todo [add\|list\|done\|delete\|edit]` | Manage todos |
| `jot export [--json\|--markdown]` | Export notes |
| `jot config [subcommand]` | View or update configuration |
| `jot init [--wizard]` | Initialize jot directory (runs setup wizard) |

## Todo Commands

```
jot todo add "task" [--due YYYY-MM-DD] [--priority high|medium|low]
jot todo list [--all] [--overdue] [--today] [--high] [--low]
jot todo done <id>      Mark todo complete
jot todo delete <id>    Delete todo
jot todo edit <id> "content" [--due YYYY-MM-DD] [--priority high|medium|low]
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Build and run
npm link             # Link globally for CLI testing
npm test             # Run tests (15 passing)
npm run lint         # Lint code
npm run typecheck    # Type check
```

## Key Source Files

- `src/index.ts` — CLI routing and all commands
- `src/db.ts` — SQLite database operations
- `src/analyzer.ts` — Background analysis worker
- `src/insights.ts` — Deep insights generation
- `src/config.ts` — Configuration management
- `src/wizard.ts` — Interactive setup wizard
- `src/context.ts` — Learned context (projects, people, patterns)
- `src/notifier.ts` — Notification system (Discord, Terminal, Webhook)
- `src/google.ts` — Google integration (Gmail, Calendar)
- `src/todos.ts` — Todo management
- `src/agent.ts` — Background agent logic

## Configuration

Config stored at `~/.jot/config.json`:
```json
{
  "backends": {
    "lmstudio": { "url": "http://localhost:1234/v1/chat/completions", "model": "qwen2.5-7b-instruct", "enabled": true, "apiType": "openai" },
    "ollama": { "url": "http://localhost:11434/v1/chat/completions", "model": "llama3.2", "enabled": false, "apiType": "ollama" }
  },
  "defaultBackend": "lmstudio",
  "analysis": { "extractActionItems": true, "linkRelatedNotes": true, "autoAnalyze": true },
  "notifier": "none",
  "discordWebhook": "",
  "deliveryMode": "urgent"
}
```

## Data Storage

```
~/.jot/
  notes.db              SQLite — notes, tags, action items, projects, people
  todos.db              SQLite — todos with due dates, priorities
  context.json           Learned memory (projects, people, patterns)
  user.md                User context (auto-learned sections)
  config.json            Backends, URLs, notifier config
  google-config.json     Google integration settings
  credentials/           Google OAuth/service account credentials
  logs/                  Agent logs
```

## Architecture

### Async Processing
- Notes are saved instantly to SQLite
- AI analysis runs asynchronously in background (detached child process)
- `analysis.autoAnalyze` controls whether analysis happens automatically after adding notes
- `jot process` runs full background cycle with notifications

### Note Lifecycle
```
jot note "note" → SQLite (instant, ~10ms)
             → detached worker → local model
             → categorize, extract tags, action items, projects, people
             → update context.json + user.md
```

### Context System (The Memory)
- `user.md` — Auto-learned sections: High Priority, Projects, People, Ongoing, Notes, Patterns
- `context.json` — Structured memory: projects[], people[], priorities[], staleItems[], patterns[]
- Injected into every analysis prompt for smarter, context-aware processing
- **Learns over time** — each note makes the next one smarter

### Todo System
- Todos stored in SQLite with due dates, priorities, completion status
- Automatically created from action_items extracted by AI analysis
- Can be managed with `jot todo` commands

### Agent (Background Daemon)
- Runs every 5 minutes via launchd/cron
- Syncs Gmail/Calendar if enabled
- Analyzes new notes
- Updates learned context
- Checks overdue/due-today todos
- Delivers notifications via configured notifier

### Google Integration
```bash
jot google setup <path-to-oauth-client.json>  Save OAuth client credentials
jot google auth                               Complete browser OAuth flow
jot google gmail --enable                     Enable Gmail
jot google calendar --enable                  Enable Calendar
jot context gmail --days 3                    View recent emails
jot context calendar --week                   View upcoming events
```

### Notifier System
- Discord: Posts to webhook with action items, urgent items, stale notes
- Terminal: Prints notification to console
- Webhook: Generic HTTP POST
- Modes: urgent (action items only), digest (daily), always

## Data Model

### Notes
- id, content, raw, tags, action_items, linked_note_ids
- projects, people (extracted by AI)
- analyzed, archived, is_urgent, created_at, analyzed_at

### Todos
- id, content, due_date, priority (high/medium/low)
- completed, completed_at, note_id (optional link to source note)
- created_at

### Context
- projects: { name, summary, relatedNotes[], lastUpdated }
- people: { name, context, relatedNotes[] }
- priorities, staleItems, patterns

## Testing

Tests are in `tests/` directory using Vitest. Run with `npm test`.

## Setup Wizard

Running `jot init --wizard` or first run triggers an interactive wizard that:
1. Asks for backend preference (LM Studio, Ollama, or Custom URL)
2. Auto-fetches available models from the server
3. Guides user through model selection
4. Configures server URL (supports remote connections)
5. Sets analysis preferences

## Agent Installation

To install the background agent (macOS):
```bash
chmod +x install-agent.sh
./install-agent.sh
```

This creates a launchd plist that runs the agent every 5 minutes.
The installer points the plist at the repository's built `dist/agent.js`, so run `npm run build` before installing or reinstalling the daemon.
