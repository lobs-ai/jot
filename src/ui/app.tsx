import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { NotesWidget } from './components/notes-widget.js';
import { TodosWidget } from './components/todos-widget.js';
import { QuickActions } from './components/quick-actions.js';
import { DB, Note } from '../db.js';
import { getTodos, Todo } from '../todos.js';

type FocusPanel = 'notes' | 'todos' | 'search' | 'actions';

interface AppProps {
  db: DB;
  exitCallback: () => void;
}

const panels: FocusPanel[] = ['notes', 'todos', 'search', 'actions'];

export function App({ db, exitCallback }: AppProps) {
  const [focusedPanel, setFocusedPanel] = useState<FocusPanel>('notes');
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState({ notes: 0, todos: 0, urgent: 0 });

  const [notesIndex, setNotesIndex] = useState(0);
  const [todosIndex, setTodosIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [started, setStarted] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);

  const refresh = () => {
    setRefreshKey(k => k + 1);
    const allNotes = db.getAllNotes();
    const allTodos = getTodos();
    setNotes(allNotes);
    setTodos(allTodos);
    setStats({
      notes: allNotes.length,
      todos: allTodos.filter(t => !t.completed).length,
      urgent: allNotes.filter(n => n.is_urgent).length,
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useInput((input, key) => {
    if (!started) return;

    if (key.ctrl === true) {
      exitCallback();
      return;
    }

    if (key.escape) {
      if (focusedPanel === 'search') {
        setSearchQuery('');
        setFocusedPanel('notes');
      } else if (focusedPanel !== 'notes') {
        setFocusedPanel('notes');
      }
      return;
    }

    if (key.tab) {
      const currentIndex = panels.indexOf(focusedPanel);
      const nextIndex = (currentIndex + 1) % panels.length;
      setFocusedPanel(panels[nextIndex]);
      return;
    }

    if (input === 'q') {
      exitCallback();
      return;
    }
  });

  const isFocused = (panel: FocusPanel) => focusedPanel === panel;
  const focusColor = (panel: FocusPanel) => isFocused(panel) ? 'green' : 'gray';

  const searchResults = searchQuery.trim() ? db.searchNotes(searchQuery) : [];

  return (
    <Box flexDirection="column" width={process.stdout.columns || 120} height={process.stdout.rows ? process.stdout.rows - 1 : 40}>
      <Box borderStyle="bold" borderColor="blue" paddingX={1} paddingY={0}>
        <Text bold backgroundColor="blue" color="white"> Jot </Text>
        <Text dimColor> — Local AI Note-Taking </Text>
        <Box flexGrow={1} />
        <Text>📝 {stats.notes}</Text>
        <Text>  ✓ {stats.todos}</Text>
        {stats.urgent > 0 && <Text color="red">  🔥 {stats.urgent}</Text>}
      </Box>

      <Box flexDirection="row" flexGrow={1}>
        <Box
          width="50%"
          borderStyle={isFocused('notes') ? 'bold' : 'round'}
          borderColor={focusColor('notes')}
          paddingX={1}
          flexGrow={1}
        >
          <Text bold color={focusColor('notes')}> Notes </Text>
          <NotesWidget
            db={db}
            refreshKey={refreshKey}
            onSelectNote={setSelectedNote}
            isActive={isFocused('notes')}
            selectedNoteId={selectedNote?.id}
            selectedIndex={notesIndex}
            onSelectIndexChange={setNotesIndex}
          />
        </Box>

        <Box
          width="50%"
          borderStyle={isFocused('todos') ? 'bold' : 'round'}
          borderColor={focusColor('todos')}
          paddingX={1}
          flexGrow={1}
        >
          <Text bold color={focusColor('todos')}> Todos </Text>
          <TodosWidget
            refreshKey={refreshKey}
            isActive={isFocused('todos')}
            selectedIndex={todosIndex}
            onSelectIndexChange={setTodosIndex}
          />
        </Box>
      </Box>

      <Box flexDirection="row" flexGrow={1}>
        <Box
          width="65%"
          borderStyle={isFocused('search') ? 'bold' : 'round'}
          borderColor={focusColor('search')}
          paddingX={1}
          flexGrow={1}
        >
          <Text bold color={focusColor('search')}> Search </Text>
          {isFocused('search') ? (
            <Box flexDirection="column" flexGrow={1}>
              <Text dimColor>Type to search...</Text>
            </Box>
          ) : (
            <Box flexDirection="column" flexGrow={1}>
              <Text dimColor>Press Tab to focus search</Text>
            </Box>
          )}
        </Box>

        <Box
          width="35%"
          borderStyle={isFocused('actions') ? 'bold' : 'round'}
          borderColor={focusColor('actions')}
          paddingX={1}
          flexGrow={1}
        >
          <Text bold color={focusColor('actions')}> Quick Actions </Text>
          <QuickActions isActive={isFocused('actions')} exit={exitCallback} />
        </Box>
      </Box>

      <Box borderStyle="single" borderTop paddingX={1}>
        <Text dimColor>
          [<Text color="green">Tab</Text>] Panels | [<Text color="green">q</Text>] Quit
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>Panel: </Text>
        <Text bold color="green">{focusedPanel}</Text>
      </Box>
    </Box>
  );
}