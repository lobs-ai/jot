import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from './config.js';

export interface Project {
  name: string;
  summary: string;
  relatedNotes: string[];
  lastUpdated: string;
}

export interface Person {
  name: string;
  context: string;
  relatedNotes: string[];
}

export interface UserContext {
  projects: Project[];
  people: Person[];
  priorities: string[];
  staleItems: string[];
  patterns: string[];
}

function getJotDir(): string {
  return path.join(os.homedir(), '.jot');
}

function getUserFilePath(): string {
  return path.join(getJotDir(), 'user.md');
}

function getContextFilePath(): string {
  return path.join(getJotDir(), 'context.json');
}

export function userFileExists(): boolean {
  return fs.existsSync(getUserFilePath());
}

export function createUserFile(): void {
  const userPath = getUserFilePath();
  if (fs.existsSync(userPath)) return;

  const config = loadConfig();
  const name = config.profile?.name?.trim() || '[Your Name]';
  const bio = config.profile?.bio?.trim();

  const lines: string[] = [
    `# ${name}'s Profile`,
    '',
  ];

  if (bio) {
    lines.push(bio);
    lines.push('');
  }

  lines.push(
    '# Auto-learned (Jot maintains this)',
    '',
    'Last updated: ' + new Date().toISOString().split('T')[0]
  );

  fs.writeFileSync(userPath, lines.join('\n'));
}

export function migrateUserMd(): { migrated: boolean; backedUp: boolean; error?: string } {
  const userPath = getUserFilePath();
  if (!fs.existsSync(userPath)) {
    return { migrated: false, backedUp: false, error: 'No user.md found' };
  }

  const raw = fs.readFileSync(userPath, 'utf-8');

  if (raw.includes("# Auto-learned")) {
    return { migrated: false, backedUp: false, error: 'Already in two-section format' };
  }

  const backupPath = userPath + '.bak';
  fs.writeFileSync(backupPath, raw);

  const config = loadConfig();
  const name = config.profile?.name?.trim() || '[Your Name]';
  const bio = config.profile?.bio?.trim();

  const autoLearnedItems: string[] = [];
  const sectionRegex = /##\s+(High Priority|Projects|People|Ongoing|Notes|Patterns)\s*\n([\s\S]*?)(?=## |Last updated:|$)/g;
  let match;

  while ((match = sectionRegex.exec(raw)) !== null) {
    const [, sectionName, sectionContent] = match;
    const items = sectionContent
      .split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line && line.length > 0 && line !== '-');

    if (items.length === 0) continue;

    if (sectionName === 'People') {
      autoLearnedItems.push('People: ' + items.join(', '));
    } else if (sectionName === 'Projects') {
      autoLearnedItems.push('Projects: ' + items.join(', '));
    } else if (sectionName === 'High Priority') {
      autoLearnedItems.push('Priorities: ' + items.join(', '));
    }
  }

  const lines: string[] = [
    `# ${name}'s Profile`,
    '',
  ];

  if (bio) {
    lines.push(bio);
    lines.push('');
  }

  lines.push('# Auto-learned (Jot maintains this)');
  lines.push('');

  if (autoLearnedItems.length > 0) {
    autoLearnedItems.forEach(item => lines.push(`- ${item}`));
  } else {
    lines.push('(migrated from old format — Jot will update this over time)');
  }

  lines.push('');
  lines.push('Last updated: ' + new Date().toISOString().split('T')[0]);

  fs.writeFileSync(userPath, lines.join('\n'));
  return { migrated: true, backedUp: true };
}

export function readUserFile(): string {
  const userPath = getUserFilePath();
  if (!fs.existsSync(userPath)) return '';
  return fs.readFileSync(userPath, 'utf-8');
}

export function updateUserFileSection(section: string, content: string): void {
  const userPath = getUserFilePath();
  if (!fs.existsSync(userPath)) {
    createUserFile();
  }

  let fileContent = fs.readFileSync(userPath, 'utf-8');
  const sectionHeaders = ['High Priority', 'Projects', 'People', 'Ongoing', 'Notes', 'Patterns'];
  
  for (const header of sectionHeaders) {
    if (fileContent.includes(`## ${header}`)) {
      const regex = new RegExp(`(## ${header}[\\s\\S]*?)(?=## |Last updated:|$)`);
      fileContent = fileContent.replace(regex, `## ${header}\n${content}\n\n`);
      break;
    }
  }

  const today = new Date().toISOString().split('T')[0];
  fileContent = fileContent.replace(/Last updated: .*/, `Last updated: ${today}`);
  
  fs.writeFileSync(userPath, fileContent);
}

export function readContext(): UserContext {
  const contextPath = getContextFilePath();
  if (!fs.existsSync(contextPath)) {
    return {
      projects: [],
      people: [],
      priorities: [],
      staleItems: [],
      patterns: []
    };
  }

  try {
    const raw = fs.readFileSync(contextPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      projects: [],
      people: [],
      priorities: [],
      staleItems: [],
      patterns: []
    };
  }
}

export function saveContext(context: UserContext): void {
  const contextPath = getContextFilePath();
  const jotDir = getJotDir();
  
  if (!fs.existsSync(jotDir)) {
    fs.mkdirSync(jotDir, { recursive: true });
  }
  
  fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));
}

export function updateContextFromNote(
  noteId: string,
  extractedProjects: string[],
  extractedPeople: string[],
  extractedPriorities: string[]
): void {
  const context = readContext();

  for (const projectName of extractedProjects) {
    const existing = context.projects.find(p => p.name === projectName);
    if (existing) {
      if (!existing.relatedNotes.includes(noteId)) {
        existing.relatedNotes.push(noteId);
      }
      existing.lastUpdated = new Date().toISOString();
    } else {
      context.projects.push({
        name: projectName,
        summary: '',
        relatedNotes: [noteId],
        lastUpdated: new Date().toISOString()
      });
    }
  }

  for (const personName of extractedPeople) {
    const existing = context.people.find(p => p.name === personName);
    if (existing) {
      if (!existing.relatedNotes.includes(noteId)) {
        existing.relatedNotes.push(noteId);
      }
    } else {
      context.people.push({
        name: personName,
        context: '',
        relatedNotes: [noteId]
      });
    }
  }

  for (const priority of extractedPriorities) {
    if (!context.priorities.includes(priority)) {
      context.priorities.push(priority);
    }
  }

  saveContext(context);
}

export function getContextPrompt(): string {
  const userFile = readUserFile();
  const context = readContext();
  
  let prompt = '';
  
  if (userFile) {
    prompt += `## User Context (from user.md)\n${userFile}\n\n`;
  }
  
  if (context.projects.length > 0) {
    prompt += `## Active Projects\n`;
    for (const project of context.projects.slice(0, 5)) {
      prompt += `- ${project.name}: ${project.summary || 'No description yet'}\n`;
    }
    prompt += '\n';
  }
  
  if (context.people.length > 0) {
    prompt += `## Key People\n`;
    for (const person of context.people.slice(0, 5)) {
      prompt += `- ${person.name}: ${person.context || 'No context yet'}\n`;
    }
    prompt += '\n';
  }
  
  if (context.priorities.length > 0) {
    prompt += `## Current Priorities\n`;
    for (const priority of context.priorities.slice(0, 5)) {
      prompt += `- ${priority}\n`;
    }
    prompt += '\n';
  }
  
  return prompt;
}
