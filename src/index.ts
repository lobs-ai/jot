#!/usr/bin/env node
import { openDB, Note } from './db';
import { runAnalysisCycle } from './analyzer';
import { loadConfig, getConfigPath } from './config';
import { generateInsights, generateDeepInsights, formatInsights } from './insights';

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
    console.error('Usage: jot add "your note here"');
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
    console.error('Usage: jot search "query"');
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
  const allNotes = db.getAllNotes();
  if (allNotes.length === 0) {
    console.log('No notes yet. Add your first note with jot add "your thought"');
    return;
  }

  const showRaw = args.includes('--raw');
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
    const insights = await generateInsights();
    
    // Fire off deep analysis in background, don't wait
    generateDeepInsights().then(deep => {
      insights.research_threads = deep.research_threads;
      insights.suggestions = deep.suggestions;
      process.stdout.write('\n' + formatInsights(insights).replace('=== Jot Insights ===', '=== Jot Insights (updated) ==='));
    }).catch(() => {});
    
    // Show instant local insights immediately
    console.log(formatInsights(insights));
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

    console.log(`\nNote: Edit ${configPath} directly to change advanced settings.`);
    return;
  }

  const subcmd = args[0];
  
  if (subcmd === 'url' && args.length >= 2) {
    const url = args.slice(1).join(' ');
    const config = loadConfig();
    const backend = config.backends[config.defaultBackend];
    if (backend) {
      backend.url = url;
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
      console.log(`Enabled ${backendName}`);
    }
    return;
  }

  console.error(`Unknown config subcommand: ${subcmd}`);
  console.error('Usage: jot config [url <url>|model <name>|backend <lmstudio|ollama>|enable <lmstudio|ollama>]');
  process.exit(1);
}

async function cmdInit(): Promise<void> {
  const fs = require('fs');
  const configPath = getConfigPath();
  const configDir = require('path').dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  const config = loadConfig();
  console.log(`Jot initialized at ${configPath}`);
  console.log(`Default backend: ${config.defaultBackend}`);
  console.log(`\nEdit the config file to change settings.`);
}

// CLI routing
const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  console.log(`Jot - local AI note-taking CLI

Usage: jot <command> [options]

Commands:
  jot add "note content"       Add a new note
  jot search "query"          Search notes
  jot list                     List all notes
  jot tags [tag]               List tags or filter by tag
  jot summarize                Quick summary
  jot analyze                 Run analysis on unanalyzed notes
  jot insights                 Deep corpus analysis (AI-powered)
  jot config [url|model|backend|enable] [args]  View or update config
  jot init                     Initialize jot directory

Examples:
  jot add "meeting with advisor about project timeline"
  jot search "meeting"
  jot tags
  jot insights

Config location: ~/.jot/config.json
Data location: ~/.jot/notes.db`);
  process.exit(0);
}

switch (cmd) {
  case 'add':
    cmdAdd(args).catch(err => {
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
  case 'config':
    cmdConfig(args).catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'init':
    cmdInit().catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error('Run jot with no arguments for help.');
    process.exit(1);
}
