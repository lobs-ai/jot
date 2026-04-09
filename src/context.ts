import fs from 'fs';
import path from 'path';
import os from 'os';

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

  const content = `# User Context

## High Priority
- 

## Projects
- 

## People
- 

## Ongoing
- 

## Notes
- 

## Patterns
- 

Last updated: ${new Date().toISOString().split('T')[0]}
`;
  fs.writeFileSync(userPath, content);
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
