'use client';

import { useState, MouseEvent } from 'react';
import {
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { EmailActionType } from '../../../../../server/src/types/email-action-tracking';
import {
  ActionRuleConditionType,
  USER_ACTION_VALUES,
  UserActionType,
} from '../../../../../server/src/types/action-rules';
import { RelationshipType } from '../../../../../server/src/lib/relationships/types';
import { useMuiToast } from '@/hooks/use-mui-toast';

interface ActionSelectorProps {
  emailAddress: string;
  currentAction: string;
  relationshipType?: string | null;
  onActionRuleCreated?: () => void;
}

// MUI-friendly hex colors for relationship chips in dialog
const RELATIONSHIP_COLORS: Record<string, string> = {
  [RelationshipType.SPOUSE]: '#ec407a',
  [RelationshipType.FAMILY]: '#ab47bc',
  [RelationshipType.COLLEAGUE]: '#42a5f5',
  [RelationshipType.FRIENDS]: '#66bb6a',
  [RelationshipType.EXTERNAL]: '#9e9e9e',
  [RelationshipType.SPAM]: '#ef5350',
  unknown: '#78909c',
};

// Build options from USER_ACTION_VALUES
const ACTION_OPTIONS = USER_ACTION_VALUES.map((value) => ({
  value,
  label: EmailActionType.LABELS[value],
  color: EmailActionType.COLORS[value],
}));

export function ActionSelector({
  emailAddress,
  currentAction,
  relationshipType,
  onActionRuleCreated,
}: ActionSelectorProps) {
  const { success, error } = useMuiToast();
  const [isLoading, setIsLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<UserActionType | null>(null);
  const [ruleType, setRuleType] = useState<ActionRuleConditionType>(
    relationshipType ? ActionRuleConditionType.RELATIONSHIP : ActionRuleConditionType.SENDER
  );
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const menuOpen = Boolean(anchorEl);

  const handleChipClick = (event: MouseEvent<HTMLElement>) => {
    if (!isLoading) {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleActionSelect = (newValue: string) => {
    handleMenuClose();
    if (newValue === currentAction) return;
    setSelectedAction(newValue as UserActionType);
    setRuleType(relationshipType ? ActionRuleConditionType.RELATIONSHIP : ActionRuleConditionType.SENDER);
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!selectedAction) return;

    const conditionValue = ruleType === ActionRuleConditionType.SENDER
      ? emailAddress
      : relationshipType;

    if (!conditionValue) {
      error('Cannot create relationship rule: no relationship type set');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/action-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          conditionType: ruleType,
          conditionValue,
          targetAction: selectedAction,
        }),
      });

      if (response.status === 409) {
        const data = await response.json();
        error(data.error);
        setDialogOpen(false);
        setSelectedAction(null);
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create action rule');
      }

      const ruleTypeLabel = ruleType === ActionRuleConditionType.SENDER
        ? emailAddress
        : RelationshipType.LABELS[conditionValue];

      success(`Action rule created: ${ruleTypeLabel} -> ${EmailActionType.LABELS[selectedAction]}`);
      onActionRuleCreated?.();
      setDialogOpen(false);
      setSelectedAction(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create action rule';
      error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const actionColor = EmailActionType.COLORS[currentAction] || '#71717a';
  const actionLabel = EmailActionType.LABELS[currentAction] || currentAction;
  const relationshipColor = relationshipType ? RELATIONSHIP_COLORS[relationshipType] : null;
  const relationshipLabel = relationshipType ? RelationshipType.LABELS[relationshipType] : null;

  return (
    <>
      <Chip
        label={actionLabel}
        size="small"
        onClick={handleChipClick}
        sx={{
          backgroundColor: actionColor,
          color: 'white',
          cursor: 'pointer',
          '&:hover': { opacity: 0.9 },
        }}
      />
      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {ACTION_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            onClick={() => handleActionSelect(option.value)}
            selected={option.value === currentAction}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {option.value === currentAction ? (
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>Create Action Rule</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Choose how to apply the action:{' '}
            {selectedAction && (
              <Chip
                label={EmailActionType.LABELS[selectedAction]}
                size="small"
                sx={{
                  ml: 1,
                  backgroundColor: EmailActionType.COLORS[selectedAction],
                  color: 'white',
                }}
              />
            )}
          </DialogContentText>

          <FormControl component="fieldset">
            <RadioGroup
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as ActionRuleConditionType)}
            >
              {relationshipLabel && (
                <FormControlLabel
                  value={ActionRuleConditionType.RELATIONSHIP}
                  control={<Radio />}
                  label={
                    <>
                      Apply to all{' '}
                      <Chip
                        label={relationshipLabel}
                        size="small"
                        sx={{
                          mx: 0.5,
                          backgroundColor: relationshipColor,
                          color: 'white',
                        }}
                      />{' '}
                      contacts
                    </>
                  }
                />
              )}
              <FormControlLabel
                value={ActionRuleConditionType.SENDER}
                control={<Radio />}
                label={
                  <>
                    Apply only to <strong>{emailAddress}</strong>
                  </>
                }
              />
            </RadioGroup>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreate} loading={isLoading}>
            Create Rule
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
