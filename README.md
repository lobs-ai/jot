# Jot

**Local AI note-taking CLI.** Capture notes in plain English, analyze and categorize them with a local AI model (LM Studio or Ollama), search and summarize your knowledge base. All offline, all private.

## What it does

```
$ jot add "discussed switching from transformers to diffusion models with my advisor"
Jotted: a1b2c3d4

$ jot summarize

=== Jot Summary ===
Total: 1 notes
Today: 1 | This week: 1

Top tags:
  #research: 1
  #advisor: 1

1 action item(s) found:
  1. Finish literature review by March 15
```

## Architecture

```
jot add "text"  →  SQLite (instant)
               →  background worker → local model (LM Studio or Ollama)
               →  categorize, extract tags, link to related notes

jot search "X"  →  SQLite full-text search
jot tags #Y     →  filtered by tag
jot summarize   →  aggregate stats, action items, tag cloud
```

**Storage:** SQLite at `~/.jot/notes.db`  
**Config:** `~/.jot/config.json`  
**No API keys. No accounts. No cloud.**

## Backends

Jot supports both LM Studio and Ollama. Configure in `~/.jot/config.json`:

```json
{
  "defaultBackend": "lmstudio",
  "backends": {
    "lmstudio": {
      "url": "http://localhost:1234/v1/chat/completions",
      "model": "qwen3.5-9b",
      "enabled": true
    },
    "ollama": {
      "url": "http://localhost:11434/v1/chat/completions",
      "model": "llama3",
      "enabled": false
    }
  },
  "remote": {
    "enabled": false,
    "url": ""
  }
}
```

**Remote support:** Set `remote.url` to use a model running on a different machine.

## Commands

| Command | Description |
|---------|-------------|
| `jot add "text"` | Capture a note (instant save, async analysis) |
| `jot search "query"` | Search notes by content |
| `jot tags [#tag]` | List notes by tag, or show all tags |
| `jot list [--raw]` | List all notes |
| `jot summarize` | Summary: counts, top tags, action items |
| `jot analyze` | Run analysis on unanalyzed notes |
| `jot config` | Show current configuration |
| `jot help` | Show help |

## Setup

```bash
# Clone
git clone https://github.com/lobs-ai/jot.git
cd jot

# Install dependencies
npm install

# Build
npm run build

# Optional: link globally
npm link

# Start taking notes
jot add "my first note"
```

### Google setup

If you want Gmail and Google Calendar integration, create a Google OAuth client JSON first:

1. Go to `https://console.cloud.google.com/`
2. Create or select a project
3. Enable `Gmail API` and `Google Calendar API`
4. Open `APIs & Services` -> `OAuth consent screen`
5. Configure the consent screen
6. Add yourself as a test user if the app is still in testing
7. Open `APIs & Services` -> `Credentials`
8. Click `Create Credentials` -> `OAuth client ID`
9. Choose `Desktop app`
10. Download the client JSON file

Then connect Jot:

```bash
jot google login /path/to/oauth-client.json
jot google gmail --enable
jot google calendar --enable
```

Notes:
- Use an OAuth client JSON, not a service account key
- `Desktop app` is the correct client type for the CLI
- If the consent screen is in testing, only listed test users can sign in

**Requires:** Node.js 18+  
**Backends:** [LM Studio](https://lmstudio.ai/) or [Ollama](https://ollama.ai/) running locally

## Why local models?

Local models are ideal for classification, tagging, and extraction tasks:
- Zero per-query cost
- Private (data never leaves your machine)
- Fast enough for background processing
- Async architecture: note saves instantly, analysis happens after

## Stack

- **Runtime:** Node.js + TypeScript
- **Storage:** SQLite (better-sqlite3)
- **Backends:** LM Studio / Ollama (OpenAI-compatible API)
- **Architecture:** async agent processing, same pattern as lobs-core

## Related

[lobs-core](https://github.com/lobs-ai/lobs-core) — Multi-agent orchestration system  
[lobs-memory](https://github.com/lobs-ai/lobs-memory) — Semantic memory server for AI agents
