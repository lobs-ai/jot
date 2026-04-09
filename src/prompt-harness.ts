import { openDB } from './db.js';
import { getTodos } from './todos.js';
import { getContextPrompt } from './context.js';
import { getActiveBackend } from './config.js';
import { fetchCalendarEvents, fetchGmailEmails, CalendarEvent, GmailEmail } from './google.js';
import { getAskSystemPrompt } from './prompting.js';

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

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return null;
}

function formatCalendarMoment(dateValue: string): string {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  const relative = getRelativeDayLabel(dateValue);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (relative) {
    return `${relative} at ${time}`;
  }

  return `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

function formatCalendarRange(event: CalendarEvent): string {
  const start = formatCalendarMoment(event.start);
  if (!event.end) return start;

  const end = new Date(event.end);
  if (Number.isNaN(end.getTime())) {
    return `${start} to ${event.end}`;
  }

  if (new Date(event.start).toDateString() === end.toDateString()) {
    return `${start} to ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }

  return `${start} to ${formatCalendarMoment(event.end)}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runModel = args.includes('--run');
  const question = args.filter(arg => arg !== '--run').join(' ').trim() || 'what do i have coming up?';

  const db = openDB();
  const relevantNotes = db.searchNotes(question).filter(note => !isPlaceholderText(note.content)).slice(0, 8);
  const recentNotes = db.getAllNotes().filter(note => !isPlaceholderText(note.content)).slice(0, 8);
  const notes = (relevantNotes.length > 0 ? relevantNotes : recentNotes)
    .map(note => note.content)
    .join('\n');
  const todos = getTodos().slice(0, 8)
    .map(todo => `- [${todo.priority}] ${todo.content}${todo.due_date ? ` (due ${todo.due_date})` : ''}`)
    .join('\n') || 'None';

  let gmail = 'None';
  let calendar = 'None';

  try {
    const emails = await fetchGmailEmails(3);
    if (emails.length > 0) {
      gmail = emails.slice(0, 3).map((email: GmailEmail) => `- ${email.subject} | ${email.from} | ${email.snippet}`).join('\n');
    }
  } catch {
    // Ignore live integration failures in prompt harness.
  }

  try {
    const events = await fetchCalendarEvents(1);
    if (events.length > 0) {
      calendar = events.slice(0, 4).map((event: CalendarEvent) => `- ${event.summary} | ${formatCalendarRange(event)}`).join('\n');
    }
  } catch {
    // Ignore live integration failures in prompt harness.
  }

  const systemPrompt = getAskSystemPrompt();

  const userPrompt = `Question:\n${question}\n\n${getContextPrompt()}## Open Todos\n${todos}\n\n## Relevant Notes\n${notes || 'None'}\n\n## Gmail\n${gmail}\n\n## Calendar\n${calendar}`;

  console.log('=== System Prompt ===\n');
  console.log(systemPrompt);
  console.log('\n=== User Prompt ===\n');
  console.log(userPrompt);

  if (!runModel) {
    return;
  }

  const { url, model, apiType } = getActiveBackend();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apiType === 'ollama'
      ? {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          think: false,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 420
          }
        }
      : {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 420
        }),
    signal: AbortSignal.timeout(90000)
  });

  console.log('\n=== Raw Response ===\n');
  console.log(await response.text());
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
