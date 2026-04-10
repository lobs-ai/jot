import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { DB, Note } from '../db.js';
import { getTodos, completeTodo, deleteTodo, insertTodo, Todo } from '../todos.js';

type View = 'notes' | 'todos' | 'search' | 'tags' | 'ai' | 'help';

interface AppProps {
  db: DB;
  exitCallback: () => void;
}

export function App({ db, exitCallback }: AppProps) {
  const [view, setView] = useState<View>('notes');
  const [notes, setNotes] = useState<Note[]>([]);
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [mode, setMode] = useState<'normal' | 'input'>('normal');
  const [inputValue, setInputValue] = useState('');
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [stats, setStats] = useState({ notes: 0, todos: 0, urgent: 0, overdue: 0 });

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string>('');
  const [aiMode, setAiMode] = useState<'ask' | 'insights' | 'summarize' | 'analyze'>('ask');
  const [aiQuestion, setAiQuestion] = useState<string>('');
  const [aiHistory, setAiHistory] = useState<{q: string; a: string; ts: number}[]>([]);

  const refresh = useCallback(() => {
    const allNotes = db.getAllNotes({ includeArchived: showArchived });
    const archived = db.getAllNotes({ includeArchived: true }).filter(n => n.archived);
    const allTodos = getTodos({ includeCompleted: false });
    const overdueTodos = allTodos.filter(t => t.due_date && t.due_date < new Date().toISOString().split('T')[0]);
    setNotes(allNotes.filter(n => !n.archived));
    setArchivedNotes(archived);
    setTodos(allTodos);
    setStats({
      notes: allNotes.filter(n => !n.archived).length,
      todos: allTodos.length,
      urgent: allNotes.filter(n => n.is_urgent && !n.archived).length,
      overdue: overdueTodos.length,
    });
  }, [db, showArchived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if ((view === 'notes' || view === 'search') && currentList[selectedIndex]) {
      setSelectedNote(currentList[selectedIndex] as Note);
    } else if (view !== 'notes' && view !== 'search') {
      setSelectedNote(null);
    }
  }, [selectedIndex, view, notes]);

  const currentNotes = showArchived ? archivedNotes : notes;
  const searchResults = view === 'search' && inputValue.trim()
    ? db.searchNotes(inputValue)
    : [];
  const currentList = view === 'notes' || view === 'search'
    ? (view === 'search' ? searchResults : currentNotes)
    : [];
  const listLength = currentList.length;

  const goUp = () => setSelectedIndex(i => Math.max(0, i - 1));
  const goDown = () => setSelectedIndex(i => Math.min(listLength - 1, i + 1));
  const goTop = () => setSelectedIndex(0);
  const goBottom = () => setSelectedIndex(Math.max(0, listLength - 1));

  const allTags = React.useMemo(() => {
    const tagCounts: Record<string, number> = {};
    notes.forEach(n => n.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1));
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [notes]);

  const runAI = async (question: string) => {
    setAiLoading(true);
    setAiResult('');
    setAiQuestion(question);
    
    try {
      const { callModelWithSession, loadSession, appendToSession, buildSessionContext } = await import('../sessions.js');
      const { getAskSystemPrompt } = await import('../prompting.js');
      const { getContextPrompt } = await import('../context.js');
      
      const session = loadSession('tui');
      const relevantNotes = db.searchNotes(question).slice(0, 5);
      const recentNotes = db.getAllNotes().slice(0, 5);
      const openTodos = getTodos().slice(0, 5);
      const notesToUse = relevantNotes.length > 0 ? relevantNotes : recentNotes;
      
      const noteBlock = notesToUse.map(n => n.content).join('\n');
      const todoBlock = openTodos.length > 0
        ? openTodos.map(t => `- [${t.priority}] ${t.content}${t.due_date ? ` (due ${t.due_date})` : ''}`).join('\n')
        : 'None';
      
      const systemPrompt = getAskSystemPrompt();
      const sessionContext = buildSessionContext(session);
      const userPrompt = `Question: ${question}\n\n${getContextPrompt()}## Open Todos\n${todoBlock}\n\n## Relevant Notes\n${noteBlock || 'None'}${sessionContext}`;
      
      const answer = await callModelWithSession(systemPrompt, userPrompt, session);
      appendToSession(session, 'user', question);
      appendToSession(session, 'assistant', answer);
      
      setAiResult(answer);
      setAiHistory(prev => [{ q: question, a: answer, ts: Date.now() }, ...prev].slice(0, 10));
    } catch (err: any) {
      setAiResult(`Error: ${err.message}`);
    }
    
    setAiLoading(false);
  };

  const runAnalyze = async () => {
    setAiLoading(true);
    setAiResult('Running analysis on notes...\n');
    
    try {
      const { runAnalysisCycle } = await import('../analyzer.js');
      const result = await runAnalysisCycle();
      setAiResult(`Analysis complete!\n\nProcessed: ${result.processed}\nFailed: ${result.failed}`);
    } catch (err: any) {
      setAiResult(`Error: ${err.message}`);
    }
    
    setAiLoading(false);
  };

  const runSummarize = () => {
    const tagCounts: Record<string, number> = {};
    const actionItems: string[] = [];
    let totalActions = 0;
    
    notes.forEach(n => {
      n.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
      totalActions += n.action_items.length;
      actionItems.push(...n.action_items);
    });
    
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const urgentNotes = notes.filter(n => n.is_urgent);
    
    let summary = `# Jot Summary\n\n`;
    summary += `**Total Notes:** ${notes.length}\n`;
    summary += `**Active Todos:** ${todos.length}\n`;
    summary += `**Action Items:** ${totalActions}\n\n`;
    
    if (topTags.length > 0) {
      summary += `## Top Tags\n`;
      topTags.forEach(([tag, count]) => {
        summary += `- #${tag}: ${count}\n`;
      });
      summary += `\n`;
    }
    
    if (urgentNotes.length > 0) {
      summary += `## Urgent\n`;
      urgentNotes.forEach(n => {
        summary += `- ${n.content.slice(0, 60)}...\n`;
      });
      summary += `\n`;
    }
    
    if (actionItems.length > 0) {
      summary += `## Action Items (${actionItems.length})\n`;
      actionItems.slice(0, 10).forEach(item => {
        summary += `- ${item}\n`;
      });
      if (actionItems.length > 10) {
        summary += `- ... and ${actionItems.length - 10} more\n`;
      }
    }
    
    setAiResult(summary);
  };

  const runInsights = async () => {
    setAiLoading(true);
    setAiResult('Generating insights...\n');
    
    try {
      const { generateInsights } = await import('../insights.js');
      const insights = await generateInsights();
      
      let result = `# AI Insights\n\n`;
      result += `**Total Notes:** ${insights.total_notes}\n\n`;
      
      if (insights.tag_summary.length > 0) {
        result += `## Top Tags\n`;
        insights.tag_summary.slice(0, 10).forEach(({ tag, count }) => {
          result += `- #${tag}: ${count} notes\n`;
        });
        result += `\n`;
      }
      
      if (insights.action_items.length > 0) {
        result += `## Action Items Found (${insights.action_items.length})\n`;
        insights.action_items.slice(0, 5).forEach(item => {
          result += `- ${item.text}\n`;
        });
        if (insights.action_items.length > 5) {
          result += `- ... and ${insights.action_items.length - 5} more\n`;
        }
        result += `\n`;
      }
      
      if (insights.suggestions.length > 0) {
        result += `## Suggestions\n`;
        insights.suggestions.forEach(s => {
          result += `- ${s}\n`;
        });
      }
      
      setAiResult(result);
    } catch (err: any) {
      setAiResult(`Error: ${err.message}`);
    }
    
    setAiLoading(false);
  };

  useInput((input, key) => {
    if (!started) return;

    if (key.ctrl === true && input === 'c') {
      exitCallback();
      return;
    }

    if (key.escape) {
      if (mode === 'input') {
        setMode('normal');
        setInputValue('');
      } else if (view !== 'notes') {
        setView('notes');
        setSelectedIndex(0);
      } else {
        setShowArchived(false);
      }
      return;
    }

    if (mode === 'input') {
      if (key.return) {
        if (inputValue.trim()) {
          if (view === 'notes') {
            db.insertNote(inputValue.trim());
            setInputValue('');
            setMode('normal');
            refresh();
          } else if (view === 'todos') {
            insertTodo(inputValue.trim());
            setInputValue('');
            setMode('normal');
            refresh();
          } else if (view === 'ai' && aiMode === 'ask') {
            runAI(inputValue.trim());
            setInputValue('');
          }
        } else {
          setMode('normal');
          setInputValue('');
        }
      } else if (key.backspace) {
        setInputValue(s => s.slice(0, -1));
      } else if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
        setInputValue(s => s + input);
      }
      return;
    }

    if (input === 'q' || input === 'Q') {
      exitCallback();
      return;
    }

    if (input === '?') { setView('help'); return; }

    if (input === '1') { setView('notes'); setSelectedIndex(0); setShowArchived(false); return; }
    if (input === '2') { setView('todos'); setSelectedIndex(0); return; }
    if (input === '3') { setView('search'); setSelectedIndex(0); return; }
    if (input === '4') { setView('tags'); setSelectedIndex(0); return; }
    if (input === '5') { setView('ai'); setSelectedIndex(0); setAiResult(''); return; }

    if (input === 'j' || key.downArrow) { goDown(); return; }
    if (input === 'k' || key.upArrow) { goUp(); return; }
    if (input === 'g') { goTop(); return; }
    if (input === 'G') { goBottom(); return; }

    if (view === 'ai') {
      if (input === 'a' || input === 'A') { setAiMode('ask'); setAiResult(''); setMode('input'); return; }
      if (input === 'i' || input === 'I') { setAiMode('insights'); runInsights(); return; }
      if (input === 's' || input === 'S') { setAiMode('summarize'); runSummarize(); return; }
      if (input === 'n' || input === 'N') { setAiMode('analyze'); runAnalyze(); return; }
      if (input === 'r' || input === 'R') { 
        if (aiMode === 'ask') runAI(inputValue);
        else if (aiMode === 'insights') runInsights();
        else if (aiMode === 'summarize') runSummarize();
        else if (aiMode === 'analyze') runAnalyze();
        return; 
      }
      return;
    }

    if (view === 'notes') {
      if (input === 'n') { setMode('input'); setInputValue(''); return; }
      if (input === 'a' && currentNotes[selectedIndex]) {
        db.archiveNote(currentNotes[selectedIndex].id);
        refresh();
        return;
      }
      if (input === 'd' && currentNotes[selectedIndex]) {
        db.deleteNote(currentNotes[selectedIndex].id);
        setSelectedNote(null);
        refresh();
        return;
      }
      if (input === 'o' && currentNotes[selectedIndex]) {
        setSelectedNote(currentNotes[selectedIndex]);
        return;
      }
      if (input === 'A') {
        setShowArchived(s => !s);
        setSelectedIndex(0);
        return;
      }
      return;
    }

    if (view === 'todos') {
      if (input === 't') { setMode('input'); setInputValue(''); return; }
      if ((input === 'x' || input === ' ' || key.return) && todos[selectedIndex]) {
        completeTodo(todos[selectedIndex].id);
        refresh();
        return;
      }
      if (input === 'd' && todos[selectedIndex]) {
        deleteTodo(todos[selectedIndex].id);
        refresh();
        return;
      }
      return;
    }

    if (view === 'search') {
      if (key.backspace && inputValue.length <= 1) {
        setInputValue('');
        return;
      }
      if ((input === 'o' || input === ' ' || key.return) && searchResults[selectedIndex]) {
        setSelectedNote(searchResults[selectedIndex]);
        setView('notes');
        return;
      }
      return;
    }
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const formatDue = (dateStr: string | null) => {
    if (!dateStr) return null;
    const today = new Date().toISOString().split('T')[0];
    if (dateStr < today) return { text: `overdue (${dateStr})`, color: 'red' as const };
    if (dateStr === today) return { text: 'today', color: 'yellow' as const };
    return { text: dateStr, color: 'gray' as const };
  };

  const formatAIResult = (result: string): string => {
    try {
      const parsed = JSON.parse(result);
      const lines: string[] = [];
      
      if (parsed.summary) {
        lines.push(`📋 ${parsed.summary}`);
      }
      
      if (Array.isArray(parsed.confirmed) && parsed.confirmed.length > 0) {
        lines.push('');
        lines.push('✅ Confirmed:');
        parsed.confirmed.forEach((item: string) => lines.push(`   • ${item}`));
      }
      
      if (Array.isArray(parsed.possible) && parsed.possible.length > 0) {
        lines.push('');
        lines.push('🔍 Possible:');
        parsed.possible.forEach((item: string) => lines.push(`   • ${item}`));
      }
      
      if (Array.isArray(parsed.next_actions) && parsed.next_actions.length > 0) {
        lines.push('');
        lines.push('🎯 Next Actions:');
        parsed.next_actions.forEach((item: string) => lines.push(`   → ${item}`));
      }
      
      if (lines.length === 0) {
        return result;
      }
      
      return lines.join('\n');
    } catch {
      return result;
    }
  };

  return (
    <Box flexDirection="column" width={process.stdout.columns || 140} height={process.stdout.rows ? process.stdout.rows - 1 : 45}>
      <Box borderStyle="bold" borderColor="blue" paddingX={1}>
        <Text bold backgroundColor="blue" color="white"> Jot </Text>
        <Text dimColor> — </Text>
        <Text dimColor>{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
        <Box flexGrow={1} />
        <Text>📝 {stats.notes}</Text>
        <Text dimColor> | </Text>
        <Text>✓ {stats.todos}</Text>
        {stats.urgent > 0 && <><Text dimColor> | </Text><Text color="red">🔥 {stats.urgent}</Text></>}
        {stats.overdue > 0 && <><Text dimColor> | </Text><Text color="red">⚠ {stats.overdue}</Text></>}
      </Box>

      <Box flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" width="55%" flexGrow={1} marginRight={1}>
          <Box borderStyle="round" borderColor="gray" paddingX={1} flexGrow={1} flexDirection="column">
            <Box marginBottom={1} flexDirection="row">
              <Text bold color={view === 'notes' ? 'green' : 'gray'}>[1]Notes</Text>
              <Text dimColor> | </Text>
              <Text bold color={view === 'todos' ? 'green' : 'gray'}>[2]Todos</Text>
              <Text dimColor> | </Text>
              <Text bold color={view === 'search' ? 'green' : 'gray'}>[3]Search</Text>
              <Text dimColor> | </Text>
              <Text bold color={view === 'tags' ? 'green' : 'gray'}>[4]Tags</Text>
              <Text dimColor> | </Text>
              <Text bold color={view === 'ai' ? 'green' : 'gray'}>[5]AI</Text>
              {showArchived && <><Text dimColor> | </Text><Text color="yellow">[A] archived</Text></>}
            </Box>

              {mode === 'input' && (
                <Box borderStyle="bold" borderColor="green" paddingX={1} marginBottom={1}>
                  <Text color="green">{'➔ '}</Text>
                  <Text>{inputValue}</Text>
                  <Text dimColor> █</Text>
                </Box>
              )}

            <Box flexDirection="column" flexGrow={1} overflowY="hidden">
              {view === 'notes' && currentNotes.length === 0 && (
                <Text dimColor>No notes. Press n to add.</Text>
              )}
              
              {view === 'notes' && currentNotes.map((note, i) => {
                const isSelected = i === selectedIndex;
                return (
                  <Box key={note.id} paddingLeft={1} borderStyle={isSelected ? 'bold' : undefined} borderColor={isSelected ? 'green' : undefined}>
                    <Text bold={isSelected} color={isSelected ? 'green' : undefined}>{note.content.slice(0, 65)}</Text>
                    <Box>
                      {note.tags.slice(0, 3).map(t => <Text key={t} dimColor> #{t}</Text>)}
                      {note.action_items.length > 0 && <Text color="yellow"> ✓{note.action_items.length}</Text>}
                      {note.is_urgent && <Text color="red"> 🔥</Text>}
                    </Box>
                    <Text dimColor> {formatDate(note.created_at)}</Text>
                  </Box>
                );
              })}

              {view === 'todos' && todos.length === 0 && (
                <Text dimColor>No todos. Press t to add.</Text>
              )}
              
              {view === 'todos' && todos.map((todo, i) => {
                const isSelected = i === selectedIndex;
                const due = formatDue(todo.due_date);
                const pColor = todo.priority === 'high' ? 'red' : todo.priority === 'medium' ? 'yellow' : 'gray';
                return (
                  <Box key={todo.id} paddingLeft={1} borderStyle={isSelected ? 'bold' : undefined} borderColor={isSelected ? 'green' : undefined}>
                    <Text bold={isSelected} color={isSelected ? 'green' : undefined}>{todo.content.slice(0, 55)}</Text>
                    <Text color={pColor}> [{todo.priority}]</Text>
                    {due && <Text color={due.color}> {due.text}</Text>}
                  </Box>
                );
              })}

              {view === 'search' && (
                <>
                  <Text dimColor>Type to search... </Text>
                  {searchResults.map((note, i) => {
                    const isSelected = i === selectedIndex;
                    return (
                      <Box key={note.id} paddingLeft={1} borderStyle={isSelected ? 'bold' : undefined} borderColor={isSelected ? 'green' : undefined}>
                        <Text bold={isSelected} color={isSelected ? 'green' : undefined}>{note.content.slice(0, 65)}</Text>
                        <Box>{note.tags.slice(0, 3).map(t => <Text key={t} dimColor> #{t}</Text>)}</Box>
                      </Box>
                    );
                  })}
                </>
              )}

              {view === 'tags' && allTags.map(([tag, count], i) => (
                <Box key={tag} paddingLeft={1} borderStyle={i === selectedIndex ? 'bold' : undefined} borderColor={i === selectedIndex ? 'green' : undefined}>
                  <Text bold={i === selectedIndex} color={i === selectedIndex ? 'green' : undefined}>#{tag}</Text>
                  <Text dimColor> ({count})</Text>
                </Box>
              ))}

              {view === 'ai' && (
                <Box flexDirection="column" flexGrow={1}>
                  <Box marginBottom={1}>
                    <Text bold>AI Features:</Text>
                  </Box>
                  <Box marginBottom={1}>
                    <Text dimColor>[A] Ask question - Ask Jot anything about your notes</Text>
                  </Box>
                  <Box marginBottom={1}>
                    <Text dimColor>[I] Insights - Get AI-powered insights from your notes</Text>
                  </Box>
                  <Box marginBottom={1}>
                    <Text dimColor>[S] Summarize - Quick summary of all notes</Text>
                  </Box>
                  <Box marginBottom={1}>
                    <Text dimColor>[N] Analyze - Run analysis on unanalyzed notes</Text>
                  </Box>
                  {aiMode === 'ask' && mode !== 'input' && (
                    <Box marginTop={1}>
                      <Text>Press A to ask a question...</Text>
                    </Box>
                  )}
                  {aiResult && (
                    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" padding={1}>
                      <Text bold color="cyan">Result:</Text>
                      <Box marginTop={1}>
                        <Text>{formatAIResult(aiResult)}</Text>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
              {selectedIndex + 1} / {listLength || (view === 'ai' ? 1 : 0)}
              </Text>
            </Box>
          </Box>
        </Box>

        <Box flexDirection="column" width="45%">
          {view === 'ai' ? (
            <Box borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1} flexDirection="column">
              <Text bold color="cyan">AI Assistant</Text>
              {aiLoading ? (
                <Box flexDirection="column" marginTop={1}>
                  <Text color="yellow">Thinking...</Text>
                  <Text dimColor>Press Escape to cancel</Text>
                </Box>
              ) : aiResult ? (
                <Box flexDirection="column" flexGrow={1} marginTop={1} overflowY="hidden">
                  {aiQuestion && (
                    <Box marginBottom={1}>
                      <Text dimColor>Q: </Text>
                      <Text>{aiQuestion}</Text>
                    </Box>
                  )}
                  <Box flexDirection="column" flexGrow={1}>
                    <Text>{formatAIResult(aiResult)}</Text>
                  </Box>
                  <Box marginTop={1} flexDirection="column">
                    <Text dimColor>History: {aiHistory.length} questions</Text>
                  </Box>
                </Box>
              ) : (
                <Box flexGrow={1}>
                  <Text dimColor>Press A to ask a question</Text>
                  <Text dimColor>Press I for insights</Text>
                  <Text dimColor>Press S for summarize</Text>
                  <Text dimColor>Press N to analyze notes</Text>
                </Box>
              )}
            </Box>
          ) : (
            <Box borderStyle="round" borderColor={selectedNote ? 'cyan' : 'gray'} paddingX={1} flexGrow={1} flexDirection="column">
              <Text bold color="cyan">{selectedNote ? 'Note Detail' : 'Detail Panel'}</Text>
              {selectedNote ? (
                <Box flexDirection="column" flexGrow={1} marginTop={1}>
                  <Text>{selectedNote.content}</Text>
                  {selectedNote.tags.length > 0 && (
                    <Box marginTop={1}>
                      <Text dimColor>Tags: </Text>
                      {selectedNote.tags.map(t => <Text key={t} color="blue">#{t} </Text>)}
                    </Box>
                  )}
                  {selectedNote.action_items.length > 0 && (
                    <Box marginTop={1} flexDirection="column">
                      <Text dimColor>Actions:</Text>
                      {selectedNote.action_items.map((item, i) => (
                        <Text key={i} color="yellow">✓ {item}</Text>
                      ))}
                    </Box>
                  )}
                  <Box marginTop={1}>
                    <Text dimColor>Created: {new Date(selectedNote.created_at).toLocaleString()}</Text>
                  </Box>
                </Box>
              ) : (
                <Box flexGrow={1}>
                  <Text dimColor>Select a note and press o</Text>
                </Box>
              )}
            </Box>
          )}

          <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
            <Text bold>Commands</Text>
            <Box flexDirection="column" marginTop={1}>
              <Text><Text color="green">1-5</Text> Switch views</Text>
              <Text><Text color="green">j/k</Text> Navigate</Text>
              <Text><Text color="green">n/t</Text> New note/todo</Text>
              <Text><Text color="green">x/space</Text> Complete todo</Text>
              <Text><Text color="green">o</Text> Open note</Text>
              <Text><Text color="green">a/d</Text> Archive/Delete</Text>
              <Text><Text color="green">A</Text> Toggle archived</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box borderStyle="single" borderTop paddingX={1}>
        <Text dimColor>
          <Text color="green">1</Text>Notes <Text color="green">2</Text>Todos <Text color="green">3</Text>Search <Text color="green">4</Text>Tags <Text color="green">5</Text>AI | 
          <Text color="green">n/t</Text>New | <Text color="green">o</Text>Open | <Text color="green">q</Text>Quit
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>View: </Text>
        <Text bold color="green">{view}</Text>
        <Text dimColor> | Mode: </Text>
        <Text bold color={mode === 'input' ? 'yellow' : 'gray'}>{mode}</Text>
      </Box>
    </Box>
  );
}