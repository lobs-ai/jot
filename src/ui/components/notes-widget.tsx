import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { DB, Note } from '../../db.js';

interface NotesWidgetProps {
  db: DB;
  refreshKey: number;
  onSelectNote: (note: Note) => void;
  isActive: boolean;
  selectedNoteId?: string;
  selectedIndex: number;
  onSelectIndexChange: (index: number) => void;
}

export function NotesWidget({
  db,
  refreshKey,
  onSelectNote: _onSelectNote,
  isActive,
  selectedNoteId,
  selectedIndex,
  onSelectIndexChange: _onSelectIndexChange,
}: NotesWidgetProps) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    const allNotes = db.getAllNotes({ includeArchived: false });
    const sorted = allNotes.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setNotes(sorted);
  }, [db, refreshKey]);

  const visibleCount = 12;
  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), Math.max(0, notes.length - visibleCount)));
  const visibleNotes = notes.slice(startIndex, startIndex + visibleCount);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {isActive && <Text dimColor>↑↓ navigate</Text>}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {notes.length === 0 ? (
          <Text dimColor>No notes yet.</Text>
        ) : (
          visibleNotes.map((note, i) => {
            const globalIndex = startIndex + i;
            const isSelected = globalIndex === selectedIndex;
            const isCurrentNote = note.id === selectedNoteId;

            return (
              <Box
                key={note.id}
                flexDirection="column"
                paddingLeft={1}
                borderStyle={isSelected ? 'bold' : undefined}
                borderColor={isSelected ? 'green' : undefined}
              >
                <Text bold={isSelected} color={isSelected ? 'green' : undefined}>
                  {note.content.slice(0, 60)}
                  {note.content.length > 60 ? '...' : ''}
                </Text>
                <Box>
                  {note.tags.slice(0, 4).map(tag => (
                    <Text key={tag} dimColor>
                      #{tag}{' '}
                    </Text>
                  ))}
                  {note.action_items.length > 0 && (
                    <Text color="yellow"> ✓{note.action_items.length}</Text>
                  )}
                  {note.is_urgent && (
                    <Text color="red"> 🔥</Text>
                  )}
                  {isCurrentNote && (
                    <Text dimColor> ←</Text>
                  )}
                </Box>
              </Box>
            );
          })
        )}
      </Box>
      <Text dimColor>
        {notes.length > 0 && `${selectedIndex + 1}/${notes.length}`}
      </Text>
    </Box>
  );
}