import { openDB, type Note } from './db.js';
import { getActiveBackend } from './config.js';
import { getContextPrompt, updateContextFromNote } from './context.js';
import { getJotPersonaPrompt } from './prompting.js';

export interface UserPatch {
  add_people?: string[];
  add_projects?: string[];
  add_priorities?: string[];
}

export interface AnalyzeResult {
  tags: string[];
  action_items: string[];
  linked_note_ids: string[];
  projects?: string[];
  people?: string[];
  priorities?: string[];
  userPatch?: UserPatch;
}

export async function analyzeNoteWithLocalModel(
  note: Note,
  allNotes: Note[],
): Promise<AnalyzeResult> {
  const { url, model, apiType } = getActiveBackend();
  
  const recentNotes = allNotes
    .filter(n => n.id !== note.id)
    .slice(0, 10)
    .map(n => `- [${n.id.slice(0,8)}] ${n.content.slice(0, 100)}...`)
    .join('\n');

  const contextPrompt = getContextPrompt();

  const systemPrompt = `${getJotPersonaPrompt()} You analyze notes and return structured data. Always respond with ONLY valid JSON, no markdown or explanation.

Example input: "meeting with advisor about project timeline, need to finish literature review by March 15"
Example output: {"tags": ["meeting", "research", "action-item"], "action_items": ["finish literature review by March 15"], "linked_note_ids": [], "projects": ["PAW"], "people": ["Marcus"], "priorities": ["finish literature review"]}

Another example: "looks like the diffusion model approach contradicts my earlier transformer hypothesis"
Example output: {"tags": ["research", "contradiction"], "action_items": [], "linked_note_ids": [], "projects": ["EECS 545 research"], "people": [], "priorities": []}

A third example: "every time I work on PAW auth I end up debugging for hours, this keeps happening"
Example output: {"tags": ["pattern", "observation"], "action_items": [], "linked_note_ids": [], "projects": ["PAW"], "people": [], "priorities": [], "userPatch": {"add_priorities": ["PAW auth flow recurring issue"]}}

Input notes may contain:
- Action items (things to do, deadlines, commitments)
- References to projects
- References to people
- Research topics or questions
- Urgent matters
- Patterns or recurring observations

Return JSON with these fields only:
- tags (array of lowercase strings, max 5)
- action_items (array of strings - actionable items extracted)
- linked_note_ids (array of strings - note IDs from related notes)
- projects (array of strings - project names mentioned)
- people (array of strings - people names mentioned)
- priorities (array of strings - important items to follow up on)
- userPatch (optional object with add_people, add_projects, add_priorities arrays for high-confidence learnings)`;

  const userPrompt = contextPrompt + '\n---\nNote to analyze:\n' + note.content + '\n\n---\nRelated notes:\n' + recentNotes;

  try {
    let response: Response;
    
    if (apiType === 'ollama') {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          think: false,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 500
          }
        }),
        signal: AbortSignal.timeout(60000)
      });
    } else {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 500
        }),
        signal: AbortSignal.timeout(60000)
      });
    }

    if (!response.ok) {
      throw new Error(`Local model API error: ${response.status}`);
    }

    const data = await response.json() as { message?: { content?: string }; choices?: Array<{ message?: { content?: string } }> };
    
    let rawResponse: string;
    if (apiType === 'ollama') {
      rawResponse = data.message?.content?.trim() || '{}';
    } else {
      rawResponse = data.choices?.[0]?.message?.content?.trim() || '{}';
    }
    
    let jsonStr = rawResponse;
    if (rawResponse.includes('```json')) {
      jsonStr = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } else if (rawResponse.startsWith('```')) {
      jsonStr = rawResponse.replace(/```\n?/g, '').trim();
    }
    
    const result = JSON.parse(jsonStr);
    
    if (result.projects?.length > 0 || result.people?.length > 0 || result.priorities?.length > 0) {
      updateContextFromNote(note.id, result.projects || [], result.people || [], result.priorities || []);
    }

    if (result.userPatch) {
      const { applyUserPatch } = await import('./context.js');
      applyUserPatch(result.userPatch, 0.8);
    }
    
    return {
      tags: result.tags || [],
      action_items: result.action_items || [],
      linked_note_ids: result.linked_note_ids || [],
      projects: result.projects || [],
      people: result.people || [],
      priorities: result.priorities || [],
      userPatch: result.userPatch
    };
  } catch (error) {
    console.error('Local model analysis failed:', error);
    return {
      tags: [],
      action_items: [],
      linked_note_ids: []
    };
  }
}

export async function runAnalysisCycle(): Promise<{ processed: number; failed: number }> {
  const db = openDB();
  const unanalyzed = db.getAllNotes().filter(n => !n.analyzed);
  
  let processed = 0;
  let failed = 0;

  for (const note of unanalyzed) {
    const result = await analyzeNoteWithLocalModel(note, db.getAllNotes());
    if (result.tags.length > 0 || result.action_items.length > 0) {
      db.updateNoteAnalysis(note.id, result.tags, result.action_items, result.linked_note_ids);
      processed++;
    } else {
      db.markAnalyzed(note.id);
      failed++;
    }
  }

  return { processed, failed };
}

export async function runProcessCycle(): Promise<{
  processed: number;
  actionItemsFound: string[];
  urgentItems: string[];
  staleNotes: string[];
}> {
  const db = openDB();
  const allNotes = db.getAllNotes();
  
  const unanalyzed = allNotes.filter(n => !n.analyzed);
  let processed = 0;
  const actionItemsFound: string[] = [];
  const urgentItems: string[] = [];
  const staleNotes: string[] = [];

  for (const note of unanalyzed) {
    const result = await analyzeNoteWithLocalModel(note, allNotes);
    if (result.tags.length > 0 || result.action_items.length > 0) {
      db.updateNoteAnalysis(note.id, result.tags, result.action_items, result.linked_note_ids);
      processed++;
      actionItemsFound.push(...result.action_items);
      if (note.is_urgent) {
        urgentItems.push(...result.action_items);
      }
    } else {
      db.markAnalyzed(note.id);
    }
  }

  const staleThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const note of allNotes) {
    const noteDate = new Date(note.created_at).getTime();
    if (noteDate < staleThreshold && note.tags.length === 0) {
      staleNotes.push(note.id);
    }
  }

  return { processed, actionItemsFound, urgentItems, staleNotes };
}
