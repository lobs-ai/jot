import { openDB, Note } from './db';
import { getActiveBackend } from './config';

export interface Insights {
  total_notes: number;
  tag_summary: { tag: string; count: number }[];
  action_items: { text: string; note_id: string; created_at: string }[];
  orphan_notes: { id: string; content: string; created_at: string }[];
  research_threads: string[];
  suggestions: string[];
}

export async function generateInsights(): Promise<Insights> {
  const db = openDB();
  const allNotes = db.getAllNotes();
  
  if (allNotes.length === 0) {
    return {
      total_notes: 0,
      tag_summary: [],
      action_items: [],
      orphan_notes: [],
      research_threads: [],
      suggestions: ['Add your first note with jot-note add "your thought"']
    };
  }

  // Build tag summary
  const tagCounts = new Map<string, number>();
  const actionItems: { text: string; note_id: string; created_at: string }[] = [];
  const orphanNotes: { id: string; content: string; created_at: string }[] = [];

  for (const note of allNotes) {
    if (note.tags.length === 0) {
      orphanNotes.push({ id: note.id, content: note.content, created_at: note.created_at });
    }
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    for (const action of note.action_items) {
      actionItems.push({ text: action, note_id: note.id, created_at: note.created_at });
    }
  }

  const tagSummary = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  // Deep analysis via local model
  const { url, model } = getActiveBackend();
  
  const allContent = allNotes
    .map(n => `[${n.id.slice(0,8)}] ${n.content}`)
    .join('\n---\n');

  const systemPrompt = `You are a research and productivity insights analyst. Analyze a user's note corpus and provide actionable insights.

Always respond with ONLY valid JSON, no markdown. Return an object with these fields:
- research_threads: array of research themes/topics detected from the notes (strings)
- suggestions: array of actionable suggestions for the user (strings)

Keep each array to 5 items max. Be concise and specific.`;

  const userPrompt = `Analyze these notes and identify patterns, research threads, and suggestions:

${allContent}

Respond with JSON: {"research_threads": [...], "suggestions": [...]}`;

  let researchThreads: string[] = [];
  let suggestions: string[] = [];

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
        temperature: 0.4,
        max_tokens: 800
      })
    });

    if (response.ok) {
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const rawResponse = data.choices?.[0]?.message?.content?.trim() || '{}';
      
      let jsonStr = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '').trim();
      }
      
      const parsed = JSON.parse(jsonStr);
      researchThreads = parsed.research_threads || [];
      suggestions = parsed.suggestions || [];
    }
  } catch (error) {
    console.error('Insights analysis failed:', error);
  }

  return {
    total_notes: allNotes.length,
    tag_summary: tagSummary,
    action_items: actionItems,
    orphan_notes: orphanNotes.slice(0, 20), // cap at 20
    research_threads: researchThreads,
    suggestions: suggestions
  };
}

export function formatInsights(insights: Insights): string {
  let output = '\n=== Jot Insights ===\n';
  output += `Total notes: ${insights.total_notes}\n`;

  if (insights.tag_summary.length > 0) {
    output += '\nTop Tags:\n';
    insights.tag_summary.slice(0, 10).forEach(({ tag, count }) => {
      output += `  #${tag}: ${count}\n`;
    });
  }

  if (insights.action_items.length > 0) {
    output += `\n${insights.action_items.length} action item(s):\n`;
    insights.action_items.forEach((item, i) => {
      output += `  ${i + 1}. ${item.text}\n`;
    });
  }

  if (insights.orphan_notes.length > 0) {
    output += `\n${insights.orphan_notes.length} untagged note(s):\n`;
    insights.orphan_notes.slice(0, 5).forEach(n => {
      const preview = n.content.length > 60 ? n.content.slice(0, 60) + '...' : n.content;
      output += `  - ${preview}\n`;
    });
    if (insights.orphan_notes.length > 5) {
      output += `  ... and ${insights.orphan_notes.length - 5} more\n`;
    }
  }

  if (insights.research_threads.length > 0) {
    output += '\nResearch threads:\n';
    insights.research_threads.forEach(thread => {
      output += `  → ${thread}\n`;
    });
  }

  if (insights.suggestions.length > 0) {
    output += '\nSuggestions:\n';
    insights.suggestions.forEach(s => {
      output += `  • ${s}\n`;
    });
  }

  return output;
}