import { openDB, InsightsRecord } from './db';
import { getActiveBackend } from './config';

export interface Insights {
  total_notes: number;
  tag_summary: { tag: string; count: number }[];
  action_items: { text: string; note_id: string; created_at: string }[];
  orphan_notes: { id: string; content: string; created_at: string }[];
  research_threads: string[];
  suggestions: string[];
  generated_at?: string;
}

function computeBasicInsights(): {
  total_notes: number;
  tag_summary: { tag: string; count: number }[];
  orphan_notes: { id: string; content: string; created_at: string }[];
} {
  const db = openDB();
  const allNotes = db.getAllNotes();

  const tagCounts = new Map<string, number>();
  const orphanNotes: { id: string; content: string; created_at: string }[] = [];

  for (const note of allNotes) {
    if (note.tags.length === 0) {
      orphanNotes.push({ id: note.id, content: note.content, created_at: note.created_at });
    }
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const tagSummary = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  return {
    total_notes: allNotes.length,
    tag_summary: tagSummary,
    orphan_notes: orphanNotes
  };
}

export async function generateInsights(): Promise<Insights> {
  const basic = computeBasicInsights();
  const db = openDB();
  const allNotes = db.getAllNotes();

  // Action items
  const actionItems: { text: string; note_id: string; created_at: string }[] = [];
  for (const note of allNotes) {
    for (const action of note.action_items) {
      actionItems.push({ text: action, note_id: note.id, created_at: note.created_at });
    }
  }

  return {
    total_notes: basic.total_notes,
    tag_summary: basic.tag_summary,
    action_items: actionItems,
    orphan_notes: basic.orphan_notes.slice(0, 20),
    research_threads: [],
    suggestions: []
  };
}

export async function generateDeepInsights(): Promise<{ research_threads: string[]; suggestions: string[] }> {
  const db = openDB();
  const allNotes = db.getAllNotes();
  
  if (allNotes.length === 0) {
    return { research_threads: [], suggestions: [] };
  }

  const { url, model, apiType } = getActiveBackend();
  
  const allContent = allNotes
    .map(n => `[${n.id.slice(0,8)}] ${n.content}`)
    .join('\n---\n');

  const systemPrompt = `You are a sharp, concise productivity analyst. Analyze notes and identify:

1. research_threads: real themes/topics (1-3 words each, max 5)
2. suggestions: specific, actionable things the user should actually do (max 5)

Be concrete. If notes are trivial/empty, say so. No generic advice.`;

  const userPrompt = `Notes:\n${allContent}\n\nRespond with JSON: {"research_threads": [...], "suggestions": [...]}`;

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
          stream: false,
          options: {
            temperature: 0.4,
            num_predict: 500
          }
        })
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
          temperature: 0.4,
          max_tokens: 500
        })
      });
    }

    if (response.ok) {
      const data = await response.json() as { message?: { content?: string }; choices?: Array<{ message?: { content?: string } }> };
      
      let rawResponse: string;
      if (apiType === 'ollama') {
        rawResponse = data.message?.content?.trim() || '{}';
      } else {
        rawResponse = data.choices?.[0]?.message?.content?.trim() || '{}';
      }
      
      let jsonStr = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '').trim();
      }
      
      const parsed = JSON.parse(jsonStr);
      return {
        research_threads: parsed.research_threads || [],
        suggestions: parsed.suggestions || []
      };
    }
  } catch (error) {
    console.error('Deep insights analysis failed:', error);
  }

  return { research_threads: [], suggestions: [] };
}

export function getStoredInsights(): Insights | null {
  try {
    const db = openDB();
    const record = db.getLatestInsights();
    if (record) {
      const parsed = JSON.parse(record.insights_json);
      return {
        ...parsed,
        generated_at: record.computed_at
      };
    }
  } catch (e) {
    // no stored insights
  }
  return null;
}

export function saveInsights(insights: Insights): void {
  try {
    const db = openDB();
    db.saveInsights(JSON.stringify(insights));
  } catch (e) {
    // ignore
  }
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
