#!/usr/bin/env node
import { openDB, Note } from './db';
import { runAnalysisCycle } from './analyzer';
import { loadConfig, getConfigPath } from './config';

const db = openDB();

function printNote(note: Note, showRaw = false): void {
  const date = new Date(note.created_at).toLocaleString();
  console.log(`\n[${note.id.slice(0, 8)}] ${date}`);
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

async function cmdAdd(args: string[]): Promise<void> {
  const content = args.join(' ');
  if (!content.trim()) {
    console.error('Usage: jot-note add "your note here"');
    process.exit(1);
  }

  const note = db.insertNote(content);
  console.log(`Jotted: ${note.id.slice(0, 8)}`);
  
  runAnalysisCycle().then(({ processed }) => {
    if (processed > 0) {
      console.log(`Analysis complete: ${processed} notes categorized`);
    }
  }).catch(() => {});
}

async function cmdSearch(args: string[]): Promise<void> {
  const query = args.join(' ');
  if (!query.trim()) {
    console.error('Usage: jot-note search "query"');
    process.exit(1);
  }

  const notes = db.searchNotes(query);
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

    console.log('Notes by tag:');
    tagMap.forEach((notes, t) => {
      console.log(`\n#${t} (${notes.length}):`);
      notes.forEach(n => console.log(`  - ${n.content.slice(0, 60)}${n.content.length > 60 ? '...' : ''}`));
    });
    return;
  }

  const notes = db.getNotesByTag(tag);
  if (notes.length === 0) {
    console.log(`No notes tagged with #${tag}`);
    return;
  }

  console.log(`Notes tagged #${tag}:`);
  notes.forEach(note => printNote(note));
}

async function cmdList(args: string[]): Promise<void> {
  const allNotes = db.getAllNotes();
  if (allNotes.length === 0) {
    console.log('No notes yet. Try: jot-note add "your first note"');
    return;
  }

  console.log(`${allNotes.length} note(s):`);
  const showRaw = args.includes('--raw');
  allNotes.forEach(note => printNote(note, showRaw));
}

async function cmdSummarize(args: string[]): Promise<void> {
  const allNotes = db.getAllNotes();
  if (allNotes.length === 0) {
    console.log('No notes to summarize.');
    return;
  }

  const now = new Date();
  const today = allNotes.filter(n => new Date(n.created_at) > new Date(now.getTime() - 86400000));
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
    console.log(`\n${actionItems.length} action item(s) found:`);
    actionItems.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  }
}

async function cmdAnalyze(): Promise<void> {
  console.log('Running analysis on unanalyzed notes...');
  const { processed, failed } = await runAnalysisCycle();
  console.log(`Analysis complete: ${processed} processed, ${failed} skipped`);
}

async function cmdConfig(args: string[]): Promise<void> {
  const configPath = getConfigPath();
  
  if (args.length === 0) {
    const config = loadConfig();
    console.log(`\n=== Jot Config ===`);
    console.log(`Config file: ${configPath}`);
    console.log(`Default backend: ${config.defaultBackend}`);
    console.log(`\nBackends:`);
    Object.entries(config.backends).forEach(([name, backend]) => {
      console.log(`  ${name}: ${backend.enabled ? 'enabled' : 'disabled'} at ${backend.url} (model: ${backend.model})`);
    });
    console.log(`\nRemote: ${config.remote.enabled ? 'enabled at ' + config.remote.url : 'disabled'}`);
    return;
  }

  console.log('To edit config, open:', configPath);
}

async function main(): Promise<void> {
  const [,, command, ...args] = process.argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(`
jot-note — Local AI Note-Taking CLI

Usage:
  jot-note add "your note here"     Capture a new note (instant save, async analysis)
  jot-note search "query"            Search notes by content
  jot-note tags [#tag]              List notes by tag, or show all tags
  jot-note list [--raw]             List all notes
  jot-note summarize                Summary of all notes (counts, tags, actions)
  jot-note analyze                  Run analysis on unanalyzed notes
  jot-note config                   Show current configuration
  jot-note help                     Show this help

Configuration:
  Config file: ~/.jot/config.json
  Supports LM Studio and Ollama backends
  Set remote.url to use a different machine's model API

Examples:
  jot-note add "discussed project timeline with advisor — need to finish literature review by March 15"
  jot-note search "diffusion models"
  jot-note tags #research
  jot-note summarize

Note: Analysis runs automatically when notes are added. Configure your backend in ~/.jot/config.json
    `);
    return;
  }

  switch (command) {
    case 'add':
      await cmdAdd(args);
      break;
    case 'search':
      await cmdSearch(args);
      break;
    case 'tags':
      await cmdTags(args);
      break;
    case 'list':
      await cmdList(args);
      break;
    case 'summarize':
      await cmdSummarize(args);
      break;
    case 'analyze':
      await cmdAnalyze();
      break;
    case 'config':
      await cmdConfig(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "jot-note help" for usage information.');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});