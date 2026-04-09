import { openDB, Note } from './db';
import { getActiveBackend } from './config';

export interface AnalyzeResult {
  tags: string[];
  action_items: string[];
  linked_note_ids: string[];
}

export async function analyzeNoteWithLocalModel(
  note: Note,
  allNotes: Note[],
): Promise<AnalyzeResult> {
  const { url, model } = getActiveBackend();
  
  const recentNotes = allNotes
    .filter(n => n.id !== note.id)
    .slice(0, 10)
    .map(n => `- [${n.id.slice(0,8)}] ${n.content.slice(0, 100)}...`)
    .join('\n');

  const systemPrompt = `You analyze notes and return structured data. Always respond with ONLY valid JSON, no markdown or explanation.

Example input: "meeting with advisor about project timeline, need to finish literature review by March 15"
Example output: {"tags": ["meeting", "research", "action-item"], "action_items": ["finish literature review by March 15"], "linked_note_ids": []}

Another example: "looks like the diffusion model approach contradicts my earlier transformer hypothesis"
Example output: {"tags": ["research", "contradiction"], "action_items": [], "linked_note_ids": []}

Input notes may contain action items, references to previous notes, or research topics.

Return JSON with these fields only: tags (array of lowercase strings, max 5), action_items (array of strings), linked_note_ids (array of strings - note IDs from the related notes provided)`;

  const userPrompt = note.content + '\n\n---\nRelated notes:\n' + recentNotes;

  try {
    const response = await fetch(url, {
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
      })
    });

    if (!response.ok) {
      throw new Error(`Local model API error: ${response.status}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const rawResponse = data.choices?.[0]?.message?.content?.trim() || '{}';
    
    let jsonStr = rawResponse;
    if (rawResponse.includes('```json')) {
      jsonStr = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } else if (rawResponse.startsWith('```')) {
      jsonStr = rawResponse.replace(/```\n?/g, '').trim();
    }
    
    const result = JSON.parse(jsonStr);
    return {
      tags: result.tags || [],
      action_items: result.action_items || [],
      linked_note_ids: result.linked_note_ids || []
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