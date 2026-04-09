#!/usr/bin/env node
import { openDB, Note } from './db.js';
import { runAnalysisCycle } from './analyzer.js';
import { loadConfig, getConfigPath, saveConfig } from './config.js';
import { generateInsights, generateDeepInsights, getStoredInsights, saveInsights, formatInsights } from './insights.js';
import { runSetupWizard } from './wizard.js';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';

const db = openDB();

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
    runAnalysisCycle().then(({ processed }) => {
      if (processed > 0) {
        console.log(`Analysis complete: ${processed} notes categorized`);
      }
    }).catch(() => {});
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
    
    generateDeepInsights().then(deep => {
      const baseInsights = generateInsights();
      baseInsights.then(bi => {
        bi.research_threads = deep.research_threads;
        bi.suggestions = deep.suggestions;
        saveInsights(bi);
        if (stored) {
          process.stdout.write('\n' + formatInsights(bi).replace('=== Jot Insights ===', '=== Jot Insights (updated) ==='));
        }
      });
    }).catch(() => {});
  } catch (error) {
    console.error('Insights generation failed:', error);
    process.exit(1);
  }
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
      if (note.tags.length > 0) console.log(`\nTags: ${note.tags.map(t => '#' + t).join(' ')}`);
      if (note.action_items.length > 0) console.log(`\nAction items:\n${note.action_items.map(a => '- [ ] ' + a).join('\n')}`);
      console.log('\n---\n');
    });
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  console.log(`Jot - local AI note-taking CLI

Usage: jot <command> [options]

Commands:
  jot note "content"           Add a new note
  jot edit <id> "content"      Edit a note
  jot delete <id> [--force]    Delete a note
  jot archive <id> [--unarchive]  Archive or restore a note
  jot link <id1> <id2>         Link two notes
  jot search "query"          Search notes
  jot list                     List all notes
  jot tags [tag]               List tags or filter by tag
  jot summarize                Quick summary
  jot analyze                 Run analysis on unanalyzed notes
  jot insights                 Deep corpus analysis (AI-powered)
  jot export [--json|--markdown]  Export notes
  jot config [subcommand]      View or update config
  jot init [--wizard]         Initialize or reconfigure

Search/List filters:
  --tag/-t <tag>               Filter by tag
  --from <YYYY-MM-DD>          Notes after date
  --to <YYYY-MM-DD>            Notes before date
  --archived                    Include archived notes

Examples:
  jot note "meeting with advisor about project timeline"
  jot edit a1b2c3d4 "updated content here"
  jot search "meeting" --tag research
  jot list --from 2024-01-01 --to 2024-12-31
  jot link a1b2c3d4 e5f6g7h8
  jot export --markdown --tag work

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
  case 'init':
    cmdInit(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error('Run jot with no arguments for help.');
    process.exit(1);
}
