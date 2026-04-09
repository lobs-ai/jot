# Jot — Design Spec

**Vision:** A personal AI learning companion that runs entirely on local models. You add notes, it processes in background, learns your context over time, and surfaces what's relevant before you ask. No cloud, no waiting, no account.

## Permission Model (Hard Constraints)

- **Read Gmail** — YES
- **Read Calendar** — YES
- **Create calendar events** — YES (with confirmation prompt)
- **Send email** — HARD NO, never

---

## Architecture Layers

```
Layer 1 — Core CLI
  jot add / search / list / tags / summarize / insights
  + instant return, async analysis

Layer 2 — External Context
  jot context gmail --days N
  jot context calendar --week
  → Injects email/calendar data into analysis prompts

Layer 3 — Background Processing
  jot process (cron/launchd every 5min)
  + pluggable notifier interface
  → delivers action items, digests

Layer 4 — Learned Memory
  jot context store (projects, people, patterns)
  → Every note makes the next one smarter

Layer 5 — Calendar Write
  jot schedule "event" --when --duration
  → Creates calendar events, asks first
```

---

## Data Storage

```
~/.jot/
  notes.db           SQLite — notes, tags, action items
  context.json       Learned memory (projects, people, patterns)
  user.md            Identity file (frozen top + auto-learned bottom)
  config.json        Backends, URLs, notifier config
  insights.db        Stored insights for instant display
```

---

## User.md Format

```markdown
# Frozen section — never auto-edited
Name: Rafe
Role: UMich CSE MS student, GSI for EECS 281/291
Goals: PhD trajectory, make money, build best agentic system
Commitments: Mon/Wed EECS 545, 491, CSE 590; Tue/Thu office hours + 281 lecture; Fri staff meeting
Current projects: PAW (with Marcus), researchOS
Key people: Marcus (PAW co-owner), advisors

# Auto-learned section — Jot writes new discoveries here
People:
Projects:
Priorities:
Patterns:
Last updated: YYYY-MM-DD
```

---

## SQLite Schema

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT,              -- JSON: string[]
  action_items TEXT,      -- JSON: { text, due?, priority }[]
  projects TEXT,          -- JSON: string[]
  people TEXT,            -- JSON: string[]
  analyzed INTEGER DEFAULT 0,
  is_urgent INTEGER DEFAULT 0,
  created_at TEXT,
  analyzed_at TEXT
);

CREATE TABLE insights (
  id TEXT PRIMARY KEY,
  type TEXT,              -- 'pattern' | 'connection' | 'reminder'
  content TEXT,
  source_note_ids TEXT,  -- JSON: string[]
  dismissed INTEGER DEFAULT 0,
  created_at TEXT
);
```

---

## Context.json Schema (Layer 4)

```typescript
interface UserContext {
  projects: {
    name: string;           // "PAW", "EECS 545 research"
    summary: string;        // auto-generated description
    relatedNotes: string[];// note IDs
    lastUpdated: string;   // ISO date
  }[];
  people: {
    name: string;          // "Marcus", "advisor"
    context: string;        // "PAW co-owner, UMich CSE"
    relatedNotes: string[];
  }[];
  priorities: string[];    // "finish literature review"
  staleItems: string[];    // note IDs flagged as stale/unresolved
  patterns: string[];      // recurring topics across notes
}
```

---

## Config.json

```json
{
  "backend": "lmstudio",
  "backendUrl": "http://localhost:1234",
  "model": "qwen3.5-9b",
  "userFile": "~/.jot/user.md",
  "dbPath": "~/.jot/notes.db",
  "notifier": "discord",
  "discordWebhook": "",
  "deliveryMode": "urgent",
  "digestTime": "08:00",
  "processInterval": 300
}
```

---

## Prompt Architecture

Every jot command injects:
1. **`user.md`** (frozen + auto-learned) — "you are Rafe, MS student at UMich..."
2. **`context.json`** — "you have 2 active projects, last note about PAW..."
3. **Relevant notes** — notes related to the current query

This gets richer over time without code changes.

---

## Notifier Interface

```typescript
interface Notifier {
  deliver(result: ProcessResult): void;
}

class DiscordNotifier implements Notifier { /* POST to webhook */ }
class TerminalNotifier implements Notifier { /* osascript notification */ }
class WebhookNotifier implements Notifier { /* HTTP POST */ }
```

**Delivery modes:**
- **Urgent only** — fire when action items found or stale threshold breached
- **Daily digest** — accumulate, deliver once a day at set time
- **Always** — fire every process cycle if there's output

---

## jot process (cron daemon)

```
Every 5 minutes (launchd/cron):
1. SELECT notes WHERE analyzed = false
2. For each note:
   a. Read user.md + context.json into prompt
   b. Run analysis (local model)
   c. UPDATE note with tags/actions
   d. UPDATE context.json (new projects, people, patterns)
3. Check thresholds (urgent items, stale notes)
4. If threshold breached OR digest time:
   a. Load notifier from config
   b. notifier.deliver(results)
5. Mark last-processed timestamp
```

Idempotent — re-running no-ops for already-processed notes.

---

## Phase 1 Scope (ship first)

- [x] jot add / search / list / tags (CLI stable)
- [x] LM Studio / Ollama integration
- [ ] `user.md` created on setup, injected into every prompt
- [ ] Auto-learned section updated by analyzer
- [ ] Gmail context read (`jot context gmail --days 3`)
- [ ] Calendar context read (`jot context calendar --week`)
- [ ] Action items delivered to Discord when found
- [ ] Async: instant return, background analysis, notification on completion

**Not in Phase 1:** context.json store (Phase 4), calendar write (Phase 5), background daemon scheduling.

---

## Open Questions (resolved)

| Question | Answer |
|----------|--------|
| user.md updates | Jot auto-updates auto-learned section only; frozen section is hands-off |
| Context store updates | Auto-update from notes as they're analyzed |
| Delivery trigger | Config option — urgent-only default |
| Gmail auth | Existing Google OAuth tokens in `~/.lobs/credentials/` |
| Context storage | SQLite + JSON file (context.json for quick reads) |
