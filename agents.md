# Jot Development Guide

## Project Overview

**Jot** is a local AI note-taking CLI that captures notes in plain English, analyzes them with a local AI model (LM Studio or Ollama), and provides search/summarize capabilities. All data stays offline and private.

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
| `jot add "text"` | Capture a note (instant save, async analysis) |
| `jot edit <id> "content"` | Edit an existing note |
| `jot delete <id> [--force]` | Delete a note (prompts for confirmation) |
| `jot archive <id> [--unarchive]` | Archive or restore a note |
| `jot link <id1> <id2>` | Link two related notes |
| `jot search "query"` | Search notes by content |
| `jot tags [#tag]` | List notes by tag, or show all tags |
| `jot list [--raw] [--archived] [--tag #tag] [--from YYYY-MM-DD] [--to YYYY-MM-DD]` | List all notes with filters |
| `jot summarize` | Summary: counts, top tags, action items |
| `jot analyze` | Run analysis on unanalyzed notes |
| `jot insights` | Deep corpus analysis (AI-powered) |
| `jot export [--json|--markdown]` | Export notes |
| `jot config [subcommand]` | View or update configuration |
| `jot init [--wizard]` | Initialize jot directory (runs setup wizard on first run) |

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

## Configuration

Config stored at `~/.jot/config.json`:
```json
{
  "defaultBackend": "lmstudio",
  "backends": {
    "lmstudio": { "url": "http://localhost:1234/v1/chat/completions", "model": "qwen2.5-7b-instruct", "enabled": true, "apiType": "openai" },
    "ollama": { "url": "http://localhost:11434/v1/chat/completions", "model": "llama3.2", "enabled": false, "apiType": "ollama" }
  },
  "remote": { "enabled": false, "url": "" },
  "analysis": {
    "extractActionItems": true,
    "linkRelatedNotes": true,
    "autoAnalyze": true
  }
}
```

## Architecture

### Async Processing
- Notes are saved instantly to SQLite
- AI analysis runs asynchronously in the background
- `analysis.autoAnalyze` controls whether analysis happens automatically after adding notes

### Note Lifecycle
```
jot add "note" → SQLite (instant)
             → background worker → local model
             → categorize, extract tags, action items, link related notes
```

### Data Model
- Notes have: id, content, raw, tags, action_items, linked_note_ids, analyzed, archived, created_at, analyzed_at
- Insights are computed and stored periodically

## Testing

Tests are in `tests/` directory using Vitest. Run with `npm test`.

## Setup Wizard

First run of `jot init` or running `jot init --wizard` triggers an interactive wizard that:
1. Asks for backend preference (LM Studio or Ollama)
2. Guides user through model setup
3. Configures server URL
4. Sets analysis preferences (action items, linking, auto-analyze)
