'use client';

import { useState, MouseEvent, useMemo } from 'react';
import {
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  CircularProgress,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import { RelationshipType } from '../../../../../server/src/lib/relationships/types';
import { useMuiToast } from '@/hooks/use-mui-toast';
import { relationshipColors } from '@/lib/theme';

interface RelationshipSelectorProps {
  emailAddress: string;
  currentRelationship: string;
  onRelationshipChange?: (newRelationship: string) => void;
}

const RELATIONSHIP_OPTIONS = [
  { value: RelationshipType.SPOUSE, label: 'Spouse' },
  { value: RelationshipType.FAMILY, label: 'Family' },
  { value: RelationshipType.COLLEAGUE, label: 'Colleague' },
  { value: RelationshipType.FRIENDS, label: 'Friends' },
  { value: RelationshipType.EXTERNAL, label: 'External' },
  { value: RelationshipType.SPAM, label: 'Spam' },
];

export function RelationshipSelector({
  emailAddress,
  currentRelationship,
  onRelationshipChange,
}: RelationshipSelectorProps) {
  const theme = useTheme();
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const relColors = relationshipColors[mode];
  const { success, error } = useMuiToast();
  const [isLoading, setIsLoading] = useState(false);
  const [relationship, setRelationship] = useState(currentRelationship);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  // Build options with theme-aware colors
  const optionsWithColors = useMemo(
    () =>
      RELATIONSHIP_OPTIONS.map((opt) => ({
        ...opt,
        color: relColors[opt.value as keyof typeof relColors] ?? relColors.unknown,
      })),
    [relColors]
  );

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (!isLoading) {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleRelationshipChange = async (newValue: string) => {
    handleClose();
    if (newValue === relationship) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/relationships/by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailAddress,
          relationshipType: newValue,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update relationship');
      }

      setRelationship(newValue);
      onRelationshipChange?.(newValue);
      success(`Relationship updated to ${RelationshipType.LABELS[newValue]}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update relationship';
      error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const relationshipColor = relColors[relationship as keyof typeof relColors] ?? relColors.unknown;
  const relationshipLabel = RelationshipType.LABELS[relationship] || RelationshipType.LABELS.unknown;

  return (
    <>
      <Chip
        label={isLoading ? <CircularProgress size={12} color="inherit" /> : relationshipLabel}
        size="small"
        onClick={handleClick}
        sx={{
          backgroundColor: relationshipColor,
          color: 'white',
          cursor: 'pointer',
          '&:hover': { opacity: 0.9 },
        }}
      />
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {optionsWithColors.map((option) => (
          <MenuItem
            key={option.value}
            onClick={() => handleRelationshipChange(option.value)}
            selected={option.value === relationship}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {option.value === relationship ? (
                <CheckIcon fontSize="small" />
              ) : (
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: option.color,
                  }}
                />
              )}
            </ListItemIcon>
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
