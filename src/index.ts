import { openDB, Note } from './db.js';
import { runAnalysisCycle } from './analyzer.js';
import { loadConfig, getConfigPath, saveConfig } from './config.js';
import { generateInsights, getStoredInsights, formatInsights } from './insights.js';
import { runSetupWizard } from './wizard.js';
import { readUserFile, readContext, getContextPrompt, migrateUserMd } from './context.js';
import { runAgentCycle, notifyIfNeeded } from './agent.js';
import { setupGoogleCredentials, enableGoogleService, fetchGmailEmails, fetchCalendarEvents, authenticateGoogle, getGoogleStatus, GmailEmail, CalendarEvent } from './google.js';
import { insertTodo, getTodos, updateTodo, completeTodo, uncompleteTodo, deleteTodo, formatTodoList, Todo } from './todos.js';
import { getAskSystemPrompt } from './prompting.js';
import { loadSession, buildSessionContext, appendToSession, callModelWithSession, saveSession, markSurfaced, loadGlobalSurfaced, saveGlobalSurfaced, clearGlobalSurfaced } from './sessions.js';
import * as readline from 'readline';
import * as child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const db = openDB();

function spawnDetachedWorker(scriptName: string): void {
  const scriptPath = fileURLToPath(new URL(`./${scriptName}`, import.meta.url));
  const child = child_process.spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function buildAskFallback(question: string, notes: Note[], todos: Todo[]): string {
  const lines: string[] = [];
  lines.push(`I could not reach the local model quickly, so here is a direct summary for: "${question}"`);

  if (todos.length > 0) {
    lines.push('');
    lines.push('Top open todos:');
    todos.slice(0, 5).forEach((todo, index) => {
      lines.push(`${index + 1}. [${todo.priority}] ${todo.content}${todo.due_date ? ` (due ${todo.due_date})` : ''}`);
    });
  }

  if (notes.length > 0) {
    lines.push('');
    lines.push('Relevant notes:');
    notes.slice(0, 5).forEach((note, index) => {
      lines.push(`${index + 1}. ${note.content}`);
    });
  }

  if (todos.length === 0 && notes.length === 0) {
    lines.push('');
    lines.push('No strong matches found in your notes or todos yet.');
  }

  return lines.join('\n');
}

function extractSurfaceableItems(parsed: { confirmed?: string[]; possible?: string[]; next_actions?: string[] }, openTodos: Todo[]): { overdue_todos: string[]; patterns: string[] } {
  const overdue_todos: string[] = [];
  const patterns: string[] = [];

  const allItems = [
    ...(parsed.confirmed || []),
    ...(parsed.possible || []),
    ...(parsed.next_actions || [])
  ];

  for (const item of allItems) {
    const lower = item.toLowerCase();
    if (lower.includes('overdue') || openTodos.some(t => t.content.toLowerCase().includes(item.toLowerCase().replace(/^you need to\s+/, '').replace(/^you should\s+/, '')))) {
      const matched = openTodos.find(t => {
        const normItem = item.toLowerCase().replace(/^you need to\s+/, '').replace(/^you should\s+/, '');
        return t.content.toLowerCase().includes(normItem.slice(0, 20));
      });
      if (matched && !overdue_todos.some(id => matched.id.startsWith(id))) {
        overdue_todos.push(matched.id);
      }
    }

    const patternKeywords = ['pattern', 'habit', 'recurring', 'always', 'every time', 'noticed you'];
    if (patternKeywords.some(kw => lower.includes(kw))) {
      const normalized = item.replace(/^you (always|notice|have a habit|keep)/i, '').trim();
      if (normalized && !patterns.includes(normalized)) {
        patterns.push(normalized.slice(0, 100));
      }
    }
  }

  return { overdue_todos, patterns };
}

function formatAskAnswer(answer: { summary?: string; confirmed?: string[]; possible?: string[]; next_actions?: string[] }): string {
  const normalizeAskItem = (value: string): string => value
    .toLowerCase()
    .replace(/^you need to\s+/, '')
    .replace(/^you should\s+/, '')
    .replace(/^please\s+/, '')
    .replace(/^reach out to\s+/, 'talk to ')
    .replace(/^follow up with\s+/, 'talk to ')
    .replace(/^review\s+/, 'review ')
    .replace(/^respond to\s+/, 'respond to ')
    .replace(/^reply to\s+/, 'respond to ')
    .replace(/^talk to\s+/, 'talk to ')
    .replace(/^check in with\s+/, 'talk to ')
    .replace(/^prepare for\s+/, 'prepare for ')
    .replace(/your /g, '')
    .replace(/getting /g, '')
    .replace(/email proof/g, 'proof email')
    .replace(/ticket comment/g, 'ticket')
    .replace(/reimbursement request/g, 'reimbursement ticket')
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const dedupeSection = (items: string[], seen: Set<string>): string[] => {
    const result: string[] = [];
    for (const item of items) {
      const normalized = normalizeAskItem(item);
      const overlaps = [...seen].some(existing =>
        normalized === existing ||
        normalized.includes(existing) ||
        existing.includes(normalized)
      );

      if (!normalized || overlaps) {
        continue;
      }
      seen.add(normalized);
      result.push(item);
    }
    return result;
  };

  const seen = new Set<string>();
  const confirmed = dedupeSection(answer.confirmed || [], seen);
  const possible = dedupeSection(answer.possible || [], seen);
  const nextActions = dedupeSection(answer.next_actions || [], seen);

  const lines: string[] = [];

  if (answer.summary) {
    lines.push(answer.summary.trim());
  }

  if (confirmed.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Confirmed:');
    confirmed.forEach(item => lines.push(`- ${item}`));
  }

  if (possible.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Possible / Follow-up:');
    possible.forEach(item => lines.push(`- ${item}`));
  }

  if (nextActions.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Next actions:');
    nextActions.forEach(item => lines.push(`- ${item}`));
  }

  return lines.join('\n');
}

function printNote(note: Note, showRaw = false): void {
  const date = new Date(note.created_at).toLocaleString();
  console.log(`\n[${note.id.slice(0, 8)}] ${date}`);
  if (note.archived) {
    console.log('  [ARCHIVED]');
  }
  if (showRaw || !note.analyzed) {
    console.log(`  RAW: ${note.content}`);
  }
  if (note.tags.length > 0) {
    console.log(`  TAGS: ${note.tags.join(', ')}`);
  }
  if (note.action_items.length > 0) {
    console.log(`  ACTIONS: ${note.action_items.join('; ')}`);
  }
  if (note.linked_note_ids.length > 0) {
    console.log(`  LINKS: ${note.linked_note_ids.join(', ')}`);
  }
  if (!note.analyzed) {
    console.log(`  (pending analysis)`);
  }
}

function askQuestion(prompt: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(prompt, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function stripTodoFlags(args: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--due') {
      i++;
      continue;
    }
    if (arg === '--priority') {
      i++;
      continue;
    }
    if (arg === '--high' || arg === '--medium' || arg === '--low') {
      continue;
    }
    result.push(arg);
  }

  return result;
}

function isPlaceholderText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'test' || normalized === 'test note' || normalized === 'todo test';
}

function getRelativeDayLabel(dateValue: string): 'today' | 'tomorrow' | null {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) {
    return 'today';
  }

  if (diffDays === 1) {
    return 'tomorrow';
  }

  return null;
}

function formatCalendarMoment(dateValue: string): string {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  const relative = getRelativeDayLabel(dateValue);
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });

  if (relative) {
    return `${relative} at ${time}`;
  }

  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
  return `${day} at ${time}`;
}

function formatCalendarRange(event: CalendarEvent): string {
  const start = formatCalendarMoment(event.start);
  if (!event.end) {
    return start;
  }

  const end = new Date(event.end);
  if (Number.isNaN(end.getTime())) {
    return `${start} to ${event.end}`;
  }

  const sameDay = getRelativeDayLabel(event.start) === getRelativeDayLabel(event.end)
    || new Date(event.start).toDateString() === end.toDateString();

  if (sameDay) {
    const endTime = end.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
    return `${start} to ${endTime}`;
  }

  return `${start} to ${formatCalendarMoment(event.end)}`;
}

async function cmdTodo(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === 'list') {
    const filters = {
      includeCompleted: args.includes('--all'),
      overdue: args.includes('--overdue'),
      dueToday: args.includes('--today'),
      priority: (args.includes('--high') ? 'high' : args.includes('--low') ? 'low' : undefined) as 'high' | 'medium' | 'low' | undefined
    };
    const todos = getTodos(filters);
    console.log(formatTodoList(todos));
    return;
  }

  const subcmd = args[0];

  if (subcmd === 'add') {
    const content = stripTodoFlags(args.slice(1)).join(' ');
    if (!content) {
      console.error('Usage: jot todo add "task" [--due YYYY-MM-DD] [--priority high|medium|low]');
      process.exit(1);
    }
    const dueDate = extractFlag(args, '--due');
    const priority = (extractFlag(args, '--priority') || (args.includes('--high') ? 'high' : args.includes('--low') ? 'low' : args.includes('--medium') ? 'medium' : 'medium')) as 'high' | 'medium' | 'low';
    const todo = insertTodo(content, dueDate, priority);
    console.log(`Todo added: ${todo.id.slice(0, 8)}`);
    return;
  }

  if (subcmd === 'done') {
    const id = args[1];
    if (!id) {
      console.error('Usage: jot todo done <id>');
      process.exit(1);
    }
    completeTodo(id);
    const tracker = loadGlobalSurfaced();
    clearGlobalSurfaced(tracker, 'overdue_todos', id);
    saveGlobalSurfaced(tracker);
    console.log(`Completed: ${id.slice(0, 8)}`);
    return;
  }

  if (subcmd === 'delete') {
    const id = args[1];
    if (!id) {
      console.error('Usage: jot todo delete <id>');
      process.exit(1);
    }
    deleteTodo(id);
    const tracker = loadGlobalSurfaced();
    clearGlobalSurfaced(tracker, 'overdue_todos', id);
    saveGlobalSurfaced(tracker);
    console.log(`Deleted: ${id.slice(0, 8)}`);
    return;
  }

  if (subcmd === 'edit') {
    const id = args[1];
    if (!id) {
      console.error('Usage: jot todo edit <id> "content" [--due YYYY-MM-DD] [--priority high|medium|low]');
      process.exit(1);
    }
    const content = stripTodoFlags(args.slice(2)).join(' ').replace(/^"(.+)"$/, '$1');
    const dueDate = extractFlag(args, '--due');
    const priority = (extractFlag(args, '--priority') || (args.includes('--high') ? 'high' : args.includes('--low') ? 'low' : args.includes('--medium') ? 'medium' : undefined)) as 'high' | 'medium' | 'low' | undefined;
    updateTodo(id, {
      content: content || undefined,
      due_date: dueDate,
      priority
    });
    console.log(`Updated: ${id.slice(0, 8)}`);
    return;
  }

  if (subcmd === 'undo') {
    const id = args[1];
    if (!id) {
      console.error('Usage: jot todo undo <id>');
      process.exit(1);
    }
    uncompleteTodo(id);
    console.log(`Restored: ${id.slice(0, 8)}`);
    return;
  }

  console.error(`Unknown todo subcommand: ${subcmd}`);
  console.error('Usage: jot todo [add|list|done|delete|edit|undo]');
  process.exit(1);
}

async function cmdAdd(args: string[]): Promise<void> {
  const content = args.join(' ');
  if (!content.trim()) {
    console.error('Usage: jot note "your note here"');
    process.exit(1);
  }

  const note = db.insertNote(content);
  console.log(`Jotted: ${note.id.slice(0, 8)}`);
  
  const config = loadConfig();
  if (config.analysis?.autoAnalyze) {
    spawnDetachedWorker('analysis-worker.js');
  }
}

async function cmdEdit(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: jot edit <note-id> "new content"');
    process.exit(1);
  }
  
  const noteId = args[0];
  const newContent = args.slice(1).join(' ');
  
  const note = db.getNote(noteId);
  if (!note) {
    console.error(`Note not found: ${noteId}`);
    process.exit(1);
  }
  
  db.updateNoteContent(noteId, newContent);
  console.log(`Updated: ${noteId.slice(0, 8)}`);
}

async function cmdDelete(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error('Usage: jot delete <note-id> [--force]');
    process.exit(1);
  }
  
  const noteId = args[0];
  const note = db.getNote(noteId);
  if (!note) {
    console.error(`Note not found: ${noteId}`);
    process.exit(1);
  }
  
  if (args.includes('--force')) {
    db.deleteNote(noteId);
    console.log(`Deleted: ${noteId.slice(0, 8)}`);
  } else {
    const answer = await askQuestion(`Delete note "${note.content.slice(0, 50)}..."? [y/N]: `);
    if (answer.toLowerCase() === 'y') {
      db.deleteNote(noteId);
      console.log(`Deleted: ${noteId.slice(0, 8)}`);
    } else {
      console.log('Cancelled.');
    }
  }
}

async function cmdArchive(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error('Usage: jot archive <note-id> [--unarchive]');
    process.exit(1);
  }
  
  const noteId = args[0];
  const unarchive = args.includes('--unarchive');
  
  const note = db.getNote(noteId);
  if (!note) {
    console.error(`Note not found: ${noteId}`);
    process.exit(1);
  }
  
  if (unarchive) {
    db.unarchiveNote(noteId);
    console.log(`Restored: ${noteId.slice(0, 8)}`);
  } else {
    db.archiveNote(noteId);
    console.log(`Archived: ${noteId.slice(0, 8)}`);
  }
}

async function cmdLink(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: jot link <note-id> <other-note-id>');
    console.error('       jot link <note-id> --remove <other-note-id>');
    process.exit(1);
  }
  
  const noteId = args[0];
  const remove = args.includes('--remove');
  
  if (remove) {
    const otherId = args[args.length - 1];
    db.unlinkNotes(noteId, otherId);
    console.log(`Unlinked: ${noteId.slice(0, 8)} <-> ${otherId.slice(0, 8)}`);
  } else {
    const otherId = args[1];
    db.linkNotes(noteId, otherId);
    console.log(`Linked: ${noteId.slice(0, 8)} <-> ${otherId.slice(0, 8)}`);
  }
}

function extractFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx < args.length - 1) {
    const val = args[idx + 1];
    if (!val.startsWith('--')) {
      return val;
    }
  }
  return null;
}

async function cmdSearch(args: string[]): Promise<void> {
  const query = args.join(' ');
  if (!query.trim()) {
    console.error('Usage: jot search "query" [--tag #tag] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--archived]');
    process.exit(1);
  }
  
  const filters = {
    tag: extractFlag(args, '--tag') || extractFlag(args, '-t'),
    from: extractFlag(args, '--from'),
    to: extractFlag(args, '--to'),
    includeArchived: args.includes('--archived')
  };
  
  const notes = db.searchNotes(query, filters);
  
  if (notes.length === 0) {
    console.log('No notes found matching that query.');
    return;
  }

  console.log(`Found ${notes.length} note(s):`);
  notes.forEach(note => printNote(note));
}

async function cmdTags(args: string[]): Promise<void> {
  const tag = args.join(' ').replace(/^#/, '');
  if (!tag.trim()) {
    const allNotes = db.getAllNotes();
    const tagMap = new Map<string, Note[]>();
    
    allNotes.forEach(note => {
      note.tags.forEach(t => {
        if (!tagMap.has(t)) tagMap.set(t, []);
        tagMap.get(t)!.push(note);
      });
    });
    
    const sorted = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`\n=== ${allNotes.length} notes across ${tagMap.size} tags ===`);
    sorted.forEach(([tag, notes]) => {
      console.log(`  #${tag}: ${notes.length} note(s)`);
    });
  } else {
    const notes = db.getNotesByTag(tag);
    if (notes.length === 0) {
      console.log(`No notes found with tag #${tag}`);
      return;
    }
    console.log(`Found ${notes.length} note(s) with #${tag}:`);
    notes.forEach(note => printNote(note));
  }
}

async function cmdList(args: string[]): Promise<void> {
  const filters = {
    tag: extractFlag(args, '--tag') || extractFlag(args, '-t'),
    from: extractFlag(args, '--from'),
    to: extractFlag(args, '--to'),
    includeArchived: args.includes('--archived')
  };
  
  const showRaw = args.includes('--raw');
  const allNotes = db.getAllNotes(filters);
  
  if (allNotes.length === 0) {
    console.log('No notes yet. Add your first note with jot note "your thought"');
    return;
  }

  console.log(`\n=== ${allNotes.length} note(s) ===`);
  allNotes.forEach(note => printNote(note, showRaw));
}

async function cmdSummarize(): Promise<void> {
  const allNotes = db.getAllNotes();
  
  if (allNotes.length === 0) {
    console.log('No notes to summarize.');
    return;
  }

  const now = new Date();
  const today = allNotes.filter(n => {
    const d = new Date(n.created_at);
    return d.toDateString() === now.toDateString();
  });

  const thisWeek = allNotes.filter(n => {
    const d = new Date(n.created_at);
    return d > new Date(now.getTime() - 7 * 86400000) && d <= new Date(now.getTime() - 86400000);
  });

  console.log(`\n=== Jot Summary ===`);
  console.log(`Total: ${allNotes.length} notes`);
  console.log(`Today: ${today.length} | This week: ${thisWeek.length}`);

  const tagCounts = new Map<string, number>();
  allNotes.forEach(n => n.tags.forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  
  if (tagCounts.size > 0) {
    console.log('\nTop tags:');
    const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    sorted.forEach(([tag, count]) => console.log(`  #${tag}: ${count}`));
  }

  const actionItems = allNotes.flatMap(n => n.action_items).filter(Boolean);
  if (actionItems.length > 0) {
    console.log(`\n${actionItems.length} action item(s):`);
    actionItems.slice(0, 5).forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  }

  console.log(`\nSee 'jot insights' for deep analysis.`);
}

async function cmdAnalyze(): Promise<void> {
  const { processed, failed } = await runAnalysisCycle();
  console.log(`Analysis complete: ${processed} processed, ${failed} skipped`);
}

async function cmdInsights(): Promise<void> {
  try {
    const stored = getStoredInsights();
    if (stored) {
      console.log(formatInsights(stored));
    } else {
      const insights = await generateInsights();
      console.log(formatInsights(insights));
    }

    spawnDetachedWorker('insights-worker.js');
    console.log('\nRefreshing deeper insights in the background...');
  } catch (error) {
    console.error('Insights generation failed:', error);
    process.exit(1);
  }
}

async function cmdAsk(args: string[]): Promise<void> {
  const sessionFlagIdx = args.indexOf('--session');
  const sessionName = sessionFlagIdx !== -1 && args[sessionFlagIdx + 1]
    ? args[sessionFlagIdx + 1]
    : 'default';

  const cleanArgs = args.filter((arg, i) =>
    !(arg === '--session' && i < args.length - 1)
  );
  const question = cleanArgs.join(' ').trim() || await askQuestion('Ask Jot: ');
  if (!question) {
    console.error('Usage: jot ask "question" [--session name]');
    process.exit(1);
  }

  const session = loadSession(sessionName);

  const relevantNotes = db.searchNotes(question).filter(note => !isPlaceholderText(note.content)).slice(0, 8);
  const recentNotes = db.getAllNotes().filter(note => !isPlaceholderText(note.content)).slice(0, 8);
  const openTodos = getTodos().slice(0, 8);

  let gmailContext = '';
  let calendarContext = '';
  try {
    const emails = await fetchGmailEmails(3);
    if (emails.length > 0) {
      gmailContext = emails
        .slice(0, 3)
        .map((email: GmailEmail) => `- ${email.subject} | ${email.from} | ${email.snippet}`)
        .join('\n');
    }
  } catch {
    // Ignore live Gmail failures during ask.
  }

  try {
    const events = await fetchCalendarEvents(1);
    if (events.length > 0) {
      calendarContext = events
        .slice(0, 4)
        .map((event: CalendarEvent) => `- ${event.summary} | ${formatCalendarRange(event)}`)
        .join('\n');
    }
  } catch {
    // Ignore live calendar failures during ask.
  }

  const noteBlock = (relevantNotes.length > 0 ? relevantNotes : recentNotes)
    .map(note => note.content)
    .join('\n');

  const notesForAnswer = relevantNotes.length > 0 ? relevantNotes : recentNotes;

  const todoBlock = openTodos.length > 0
    ? openTodos.map(todo => `- [${todo.priority}] ${todo.content}${todo.due_date ? ` (due ${todo.due_date})` : ''}`).join('\n')
    : 'None';

  const systemPrompt = getAskSystemPrompt();
  const sessionContext = buildSessionContext(session);

  const userPrompt = `Question:\n${question}\n\n${getContextPrompt()}## Open Todos\n${todoBlock}\n\n## Relevant Notes\n${noteBlock || 'None'}\n\n## Gmail\n${gmailContext || 'None'}\n\n## Calendar\n${calendarContext || 'None'}${sessionContext}`;

  try {
    const answer = await callModelWithSession(systemPrompt, userPrompt, session);

    // Parse JSON before writing to session — don't persist malformed output
    const jsonStr = answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let parsed: { summary?: string; confirmed?: string[]; possible?: string[]; next_actions?: string[] };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.log('⚠ Could not parse model response as JSON. Saving to session anyway.');
      parsed = {};
    }

    // Only persist to session if parse succeeded
    appendToSession(session, 'user', question);
    appendToSession(session, 'assistant', answer);

    const { overdue_todos, patterns } = extractSurfaceableItems(parsed, openTodos);
    for (const id of overdue_todos) {
      markSurfaced(session, 'overdue_todos', id);
    }
    for (const pattern of patterns) {
      markSurfaced(session, 'patterns', pattern);
    }

    console.log(formatAskAnswer(parsed) || buildAskFallback(question, notesForAnswer, openTodos));
  } catch (err) {
    console.log(buildAskFallback(question, notesForAnswer, openTodos));
  }
}

async function cmdChat(args: string[]): Promise<void> {
  const sessionFlagIdx = args.indexOf('--session');
  const sessionName = sessionFlagIdx !== -1 && args[sessionFlagIdx + 1]
    ? args[sessionFlagIdx + 1]
    : 'default';

  const session = loadSession(sessionName);
  const systemPrompt = getAskSystemPrompt();

  console.log(`Jot chat — session: ${sessionName}`);
  console.log('(Ctrl+C or type "exit" to end)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = (): void => {
    rl.question('You: ', async (input: string) => {
      const text = input.trim();
      if (!text || text.toLowerCase() === 'exit' || text.toLowerCase() === 'quit') {
        rl.close();
        saveSession(session);
        console.log('\nSession saved. Goodbye!');
        return;
      }

      const relevantNotes = db.searchNotes(text).filter(note => !isPlaceholderText(note.content)).slice(0, 5);
      const recentNotes = db.getAllNotes().filter(note => !isPlaceholderText(note.content)).slice(0, 5);
      const openTodos = getTodos().slice(0, 5);
      const notes = relevantNotes.length > 0 ? relevantNotes : recentNotes;

      const noteBlock = notes.map(note => note.content).join('\n');
      const todoBlock = openTodos.length > 0
        ? openTodos.map(todo => `- [${todo.priority}] ${todo.content}${todo.due_date ? ` (due ${todo.due_date})` : ''}`).join('\n')
        : 'None';

      const sessionContext = buildSessionContext(session);
      const userPrompt = `Question:\n${text}\n\n${getContextPrompt()}## Open Todos\n${todoBlock}\n\n## Relevant Notes\n${noteBlock || 'None'}\n\n## Gmail\nNone\n\n## Calendar\nNone\n${sessionContext}`;

      try {
        const answer = await callModelWithSession(systemPrompt, userPrompt, session);

        // Parse JSON before writing to session — don't persist malformed output
        const jsonStr = answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        let parsed: { summary?: string; confirmed?: string[]; possible?: string[]; next_actions?: string[] };
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          parsed = {};
        }

        // Only persist to session if parse succeeded
        appendToSession(session, 'user', text);
        appendToSession(session, 'assistant', answer);

        const { overdue_todos, patterns } = extractSurfaceableItems(parsed, openTodos);
        for (const id of overdue_todos) {
          markSurfaced(session, 'overdue_todos', id);
        }
        for (const pattern of patterns) {
          markSurfaced(session, 'patterns', pattern);
        }

        console.log('\nJot: ' + (formatAskAnswer(parsed) || buildAskFallback(text, notes, openTodos)).replace(/\n/g, '\nJot: '));
      } catch {
        console.log('\nJot: Sorry, I had trouble answering that.');
      }

      console.log('');
      prompt();
    });
  };

  prompt();
}

async function cmdMigrate(args: string[]): Promise<void> {
  const subcmd = args[0];

  if (subcmd === 'user-md') {
    const result = migrateUserMd();
    if (result.migrated) {
      console.log('user.md migrated to two-section format.');
      console.log('Original backed up to: ~/.jot/user.md.bak');
    } else if (result.error) {
      if (result.error === 'Already in two-section format') {
        console.log('user.md is already in two-section format. No migration needed.');
      } else {
        console.error('Migration failed:', result.error);
        process.exit(1);
      }
    }
    return;
  }

  console.error('Usage: jot migrate user-md');
  process.exit(1);
}

async function cmdConfig(args: string[]): Promise<void> {
  const configPath = getConfigPath();
  
  if (args.length === 0) {
    const config = loadConfig();

    console.log(`\n=== Jot Config ===`);
    console.log(`Config file: ${configPath}`);
    console.log(`Default backend: ${config.defaultBackend}`);
    console.log(`\nBackends:`);

    for (const [name, backend] of Object.entries(config.backends)) {
      if (backend) {
        console.log(`  ${name}:`);
        console.log(`    URL: ${backend.url}`);
        console.log(`    Model: ${backend.model}`);
        console.log(`    Enabled: ${backend.enabled}`);
        if (backend.apiType) {
          console.log(`    API: ${backend.apiType}`);
        }
      }
    }

    if (config.remote.enabled) {
      console.log(`\nRemote: ${config.remote.url}`);
    } else {
      console.log(`\nRemote: disabled`);
    }
    
    console.log(`\nAnalysis:`);
    console.log(`  Auto-analyze: ${config.analysis?.autoAnalyze ?? true}`);
    console.log(`  Extract action items: ${config.analysis?.extractActionItems ?? true}`);
    console.log(`  Link related notes: ${config.analysis?.linkRelatedNotes ?? true}`);

    console.log(`\nNote: Run "jot init --wizard" to reconfigure.`);
    return;
  }

  const subcmd = args[0];
  
  if (subcmd === 'url' && args.length >= 2) {
    const url = args.slice(1).join(' ');
    const config = loadConfig();
    const backend = config.backends[config.defaultBackend];
    if (backend) {
      backend.url = url;
      saveConfig(config);
      console.log(`Set ${config.defaultBackend} URL to: ${url}`);
    }
    return;
  }
  
  if (subcmd === 'model' && args.length >= 2) {
    const model = args.slice(1).join(' ');
    const config = loadConfig();
    const backend = config.backends[config.defaultBackend];
    if (backend) {
      backend.model = model;
      saveConfig(config);
      console.log(`Set ${config.defaultBackend} model to: ${model}`);
    }
    return;
  }
  
  if (subcmd === 'backend' && args.length >= 2) {
    const backendName = args[1] as 'lmstudio' | 'ollama';
    if (backendName !== 'lmstudio' && backendName !== 'ollama') {
      console.error('Invalid backend. Use "lmstudio" or "ollama".');
      process.exit(1);
    }
    const config = loadConfig();
    const backend = config.backends[backendName];
    if (!backend) {
      console.error(`Backend ${backendName} not found in config.`);
      process.exit(1);
    }
    backend.enabled = true;
    config.defaultBackend = backendName;
    saveConfig(config);
    console.log(`Switched to ${backendName}. URL: ${backend.url} | Model: ${backend.model}`);
    return;
  }

  if (subcmd === 'enable' && args.length >= 2) {
    const backendName = args[1] as 'lmstudio' | 'ollama';
    if (backendName !== 'lmstudio' && backendName !== 'ollama') {
      console.error('Invalid backend. Use "lmstudio" or "ollama".');
      process.exit(1);
    }
    const config = loadConfig();
    if (config.backends[backendName]) {
      config.backends[backendName]!.enabled = true;
      saveConfig(config);
      console.log(`Enabled ${backendName}`);
    }
    return;
  }

  console.error(`Unknown config subcommand: ${subcmd}`);
  console.error('Usage: jot config [url|model|backend|enable] [args]');
  console.error('       jot init --wizard     Re-run setup wizard');
  process.exit(1);
}

async function cmdInit(args: string[]): Promise<void> {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  if (args.includes('--wizard')) {
    await runSetupWizard();
    return;
  }
  
  const config = loadConfig();
  console.log(`Jot initialized at ${configPath}`);
  console.log(`Default backend: ${config.defaultBackend}`);
  console.log(`\nRun "jot init --wizard" to reconfigure.`);
}

async function cmdExport(args: string[]): Promise<void> {
  const format = args.includes('--json') ? 'json' : 'markdown';
  const filters = {
    tag: extractFlag(args, '--tag') || extractFlag(args, '-t'),
    from: extractFlag(args, '--from'),
    to: extractFlag(args, '--to'),
    includeArchived: args.includes('--archived')
  };
  
  const notes = db.getAllNotes(filters);
  
  if (format === 'json') {
    console.log(JSON.stringify(notes, null, 2));
  } else {
    console.log('# Jot Notes Export\n');
    notes.forEach(note => {
      console.log(`## [${note.id.slice(0, 8)}] ${new Date(note.created_at).toLocaleString()}`);
      if (note.archived) console.log('*Archived*');
      console.log(note.content);
      if (note.tags.length > 0) console.log(`\nTags: ${note.tags.map((t: string) => '#' + t).join(' ')}`);
      if (note.action_items.length > 0) console.log(`\nAction items:\n${note.action_items.map((a: string) => '- [ ] ' + a).join('\n')}`);
      console.log('\n---\n');
    });
  }
}

async function cmdProcess(args: string[]): Promise<void> {
  const result = await runAgentCycle();
  console.log(result.summary);

  if (args.includes('--notify')) {
    await notifyIfNeeded(result);
    console.log('Notifications processed.');
  }
}

async function cmdGoogle(args: string[]): Promise<void> {
  const subcmd = args[0] || 'status';

  if (subcmd === 'setup') {
    const credentialsPath = args[1];
    if (!credentialsPath) {
      console.error('Usage: jot google setup <path-to-oauth-client.json>');
      process.exit(1);
    }
    setupGoogleCredentials(credentialsPath);
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const answer = await askQuestion('Open browser and sign in to Google now? [Y/n]: ');
      if (!answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        await authenticateGoogle();
      }
    }
    return;
  }

  if (subcmd === 'auth' || subcmd === 'signin' || subcmd === 'login') {
    const credentialsPath = args[1];
    if (credentialsPath) {
      setupGoogleCredentials(credentialsPath);
    }

    const status = getGoogleStatus();
    if (!status.hasCredentials) {
      console.error('Google OAuth client credentials are required before sign-in.');
      console.error('Run: jot google login <path-to-oauth-client.json>');
      console.error('Or:  jot google setup <path-to-oauth-client.json>');
      process.exit(1);
    }

    await authenticateGoogle();
    return;
  }

  if (subcmd === 'gmail' || subcmd === 'calendar') {
    if (args.includes('--enable')) {
      enableGoogleService(subcmd, true);
      return;
    }
    if (args.includes('--disable')) {
      enableGoogleService(subcmd, false);
      return;
    }

    const status = getGoogleStatus();
    const enabled = subcmd === 'gmail' ? status.config.gmail_enabled : status.config.calendar_enabled;
    console.log(`${subcmd}: ${enabled ? 'enabled' : 'disabled'}`);
    return;
  }

  if (subcmd === 'status') {
    const status = getGoogleStatus();
    console.log('\n=== Google Integration ===');
    console.log(`Credentials: ${status.hasCredentials ? 'configured' : 'missing'}`);
    console.log(`Tokens: ${status.hasTokens ? 'configured' : 'missing'}`);
    console.log(`Gmail: ${status.config.gmail_enabled ? 'enabled' : 'disabled'}`);
    console.log(`Calendar: ${status.config.calendar_enabled ? 'enabled' : 'disabled'}`);
    console.log(`Client file: ${status.config.credentials_path}`);
    console.log(`Token file: ${status.config.tokens_path}`);
    if (!status.hasCredentials) {
      console.log('\nNext step: jot google setup <path-to-oauth-client.json>');
    } else if (!status.hasTokens) {
      console.log('\nNext step: jot google signin');
    } else if (!status.config.gmail_enabled || !status.config.calendar_enabled) {
      console.log('\nNext step: enable services with `jot google gmail --enable` and/or `jot google calendar --enable`.');
    }
    return;
  }

  console.error('Usage: jot google [setup|auth|signin|login|status|gmail|calendar]');
  console.error('       jot google setup <path-to-oauth-client.json>');
  console.error('       jot google signin');
  console.error('       jot google login <path-to-oauth-client.json>');
  console.error('       jot google gmail --enable|--disable');
  console.error('       jot google calendar --enable|--disable');
  process.exit(1);
}

async function cmdContext(args: string[]): Promise<void> {
  const subcmd = args[0] || 'summary';

  if (subcmd === 'user') {
    const userContext = readUserFile();
    if (!userContext.trim()) {
      console.log('No user context file yet. Run `jot init --wizard` or add notes first.');
      return;
    }
    console.log(userContext);
    return;
  }

  if (subcmd === 'gmail') {
    const daysValue = extractFlag(args, '--days');
    const days = daysValue ? Number(daysValue) : 3;
    const emails = await fetchGmailEmails(Number.isFinite(days) ? days : 3);

    if (emails.length === 0) {
      console.log('No Gmail messages found.');
      return;
    }

    console.log(`\n=== Gmail (${emails.length}) ===`);
    emails.forEach((email: GmailEmail, index: number) => {
      console.log(`\n${index + 1}. ${email.subject}`);
      console.log(`From: ${email.from}`);
      if (email.date) {
        console.log(`Date: ${email.date}`);
      }
      if (email.snippet) {
        console.log(email.snippet);
      }
    });
    return;
  }

  if (subcmd === 'calendar') {
    const weeksValue = extractFlag(args, '--weeks');
    const weeks = args.includes('--week') ? 1 : weeksValue ? Number(weeksValue) : 1;
    const events = await fetchCalendarEvents(Number.isFinite(weeks) ? weeks : 1);

    if (events.length === 0) {
      console.log('No calendar events found.');
      return;
    }

    console.log(`\n=== Calendar (${events.length}) ===`);
    events.forEach((event: CalendarEvent, index: number) => {
      console.log(`\n${index + 1}. ${event.summary}`);
      console.log(`When: ${formatCalendarRange(event)}`);
      if (event.location) {
        console.log(`Location: ${event.location}`);
      }
      if (event.attendees && event.attendees.length > 0) {
        console.log(`Attendees: ${event.attendees.join(', ')}`);
      }
    });
    return;
  }

  if (subcmd === 'summary') {
    console.log(JSON.stringify(readContext(), null, 2));
    return;
  }

  console.error('Usage: jot context [user|gmail|calendar]');
  console.error('       jot context gmail --days 3');
  console.error('       jot context calendar --week');
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  console.log(`Jot - local AI note-taking CLI and mini-agent

Usage: jot <command> [options]

Commands:
  jot note "content"           Add a new note
  jot ask "question"           Ask Jot using notes and context
  jot chat                      Interactive chat REPL
  jot edit <id> "content"      Edit a note
  jot delete <id> [--force]    Delete a note
  jot archive <id> [--unarchive]  Archive or restore a note
  jot link <id1> <id2>         Link two notes
  jot search "query"          Search notes
  jot list                     List all notes
  jot tags [tag]               List tags or filter by tag
  jot summarize                Quick summary
  jot analyze                 Run analysis on unanalyzed notes
  jot process [--notify]       Background processing with notifications
  jot insights                 Deep corpus analysis (AI-powered)
  jot context [user|gmail|calendar]  View/inject context
  jot google [setup|signin|status|gmail|calendar]  Google integration settings
  jot todo [add|list|done|delete|edit]  Manage todos
  jot export [--json|--markdown]  Export notes
  jot config [subcommand]      View or update config
  jot migrate user-md          Migrate user.md to two-section format
  jot init [--wizard]         Initialize or reconfigure

Todo filters:
  jot todo list [--all] [--overdue] [--today] [--high] [--low]
  jot todo add "task" [--due YYYY-MM-DD] [--priority high|medium|low]
  jot todo done <id>           Mark todo complete
  jot todo delete <id>          Delete todo
  jot todo edit <id> "content" [--due YYYY-MM-DD] [--priority high|medium|low]

Search/List filters:
  --tag/-t <tag>               Filter by tag
  --from <YYYY-MM-DD>          Notes after date
  --to <YYYY-MM-DD>            Notes before date
  --archived                    Include archived notes

Examples:
  jot note "meeting with advisor about project timeline"
  jot ask "What should I focus on today?"
  jot chat --session work       Interactive chat REPL (named session)
  jot edit a1b2c3d4 "updated content here"
  jot search "meeting" --tag research
  jot list --from 2024-01-01 --to 2024-12-31
  jot todo add "finish literature review" --due 2024-03-15 --priority high
  jot todo list --overdue
  jot context                   View learned context
  jot migrate user-md           Migrate to two-section user.md format
  jot google signin           Open browser Google sign-in
  jot google gmail --enable    Enable Gmail integration
  jot process --notify          Run with notifications

Config location: ~/.jot/config.json
Data location: ~/.jot/notes.db`);
  process.exit(0);
}

switch (cmd) {
  case 'note':
    cmdAdd(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'ask':
    cmdAsk(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'chat':
    cmdChat(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'edit':
    cmdEdit(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'delete':
    cmdDelete(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'archive':
    cmdArchive(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'link':
    cmdLink(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'search':
    cmdSearch(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'list':
    cmdList(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'tags':
    cmdTags(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'summarize':
    cmdSummarize().catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'analyze':
    cmdAnalyze().catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'todo':
    cmdTodo(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'process':
    cmdProcess(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'insights':
    cmdInsights().catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'export':
    cmdExport(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'config':
    cmdConfig(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'migrate':
    cmdMigrate(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'init':
    cmdInit(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'google':
    cmdGoogle(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'context':
    cmdContext(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error('Run jot with no arguments for help.');
    process.exit(1);
}
