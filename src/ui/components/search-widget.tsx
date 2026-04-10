import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { DB, Note } from '../../db.js';

interface SearchWidgetProps {
  db: DB;
  refreshKey: number;
  onSelectNote: (note: Note) => void;
  isActive: boolean;
  onActivate: () => void;
  selectedIndex: number;
  onSelectIndexChange: (index: number) => void;
}

export function SearchWidget({
  db,
  onSelectNote: _onSelectNote,
  isActive: _isActive,
  selectedIndex,
  onSelectIndexChange: _onSelectIndexChange,
}: SearchWidgetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Note[]>([]);

  useEffect(() => {
    if (query.trim()) {
      const searchResults = db.searchNotes(query);
      setResults(searchResults);
    } else {
      setResults([]);
    }
  }, [query, db]);

  const handleSearch = (value: string) => {
    setQuery(value);
  };

  const visibleCount = 15;
  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), Math.max(0, results.length - visibleCount)));
  const visibleResults = results.slice(startIndex, startIndex + visibleCount);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" alignItems="center">
        <TextInput
          value={query}
          onChange={handleSearch}
          placeholder="Search notes..."
        />
        {query && (
          <Box marginLeft={1}>
            <Text dimColor>[Esc to clear]</Text>
          </Box>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" marginTop={1}>
        {query && results.length === 0 && (
          <Text dimColor>No results found.</Text>
        )}
        {!query && (
          <Text dimColor>Type to search...</Text>
        )}
        {visibleResults.map((note, i) => {
          const globalIndex = startIndex + i;
          const isSelected = globalIndex === selectedIndex;

          return (
            <Box
              key={note.id}
              flexDirection="column"
              paddingLeft={1}
              borderStyle={isSelected ? 'bold' : undefined}
              borderColor={isSelected ? 'green' : undefined}
            >
              <Text bold={isSelected} color={isSelected ? 'green' : undefined}>
                {note.content.slice(0, 80)}
                {note.content.length > 80 ? '...' : ''}
              </Text>
              <Box>
                {note.tags.slice(0, 5).map(tag => (
                  <Text key={tag} dimColor>
                    #{tag}{' '}
                  </Text>
                ))}
                {note.action_items.length > 0 && (
                  <Text color="yellow"> ✓{note.action_items.length}</Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
      {results.length > 0 && (
        <Text dimColor>{results.length} result(s) | ↑↓ navigate</Text>
      )}
    </Box>
  );
}