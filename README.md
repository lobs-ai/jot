# Jot

**Local AI note-taking CLI.** Capture notes in plain English, analyze and categorize them with a local AI model (LM Studio or Ollama), search and summarize your knowledge base. All offline, all private.

## What it does

```
$ jot-note add "discussed switching from transformers to diffusion models with my advisor"
Jotted: a1b2c3d4

$ jot-note summarize

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
jot-note add "text"  →  SQLite (instant)
               →  background worker → local model (LM Studio or Ollama)
               →  categorize, extract tags, link to related notes

jot-note search "X"  →  SQLite full-text search
jot-note tags #Y     →  filtered by tag
jot-note summarize   →  aggregate stats, action items, tag cloud
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
| `jot-note add "text"` | Capture a note (instant save, async analysis) |
| `jot-note search "query"` | Search notes by content |
| `jot-note tags [#tag]` | List notes by tag, or show all tags |
| `jot-note list [--raw]` | List all notes |
| `jot-note summarize` | Summary: counts, top tags, action items |
| `jot-note analyze` | Run analysis on unanalyzed notes |
| `jot-note config` | Show current configuration |
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
jot-note add "my first note"
```

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