'use client';

import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { useForm } from 'react-hook-form';
import { TextFieldElement, SwitchElement } from 'react-hook-form-mui';
import {
  Box,
  Paper,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Skeleton,
  Alert,
  Stack,
  Tabs,
  Tab,
  Chip,
  CircularProgress,
  TextField,
} from '@mui/material';
import { useConfirm } from 'material-ui-confirm';
import { useMuiToast } from '@/hooks/use-mui-toast';

// Types
interface UserPreferences {
  name?: string;
  nicknames?: string;
  signatureBlock?: string;
  folderPreferences?: {
    rootFolder?: string;
    noActionFolder?: string;
    spamFolder?: string;
    todoFolder?: string;
  };
  actionPreferences?: {
    spamDetection?: boolean;
    silentActions?: {
      'silent-fyi-only'?: boolean;
      'silent-large-list'?: boolean;
      'silent-unsubscribe'?: boolean;
      'silent-todo'?: boolean;
    };
    draftGeneration?: boolean;
  };
  workDomainsCSV?: string;
  familyEmailsCSV?: string;
  spouseEmailsCSV?: string;
}

interface ProfileFormData {
  name: string;
  nicknames: string;
  signatureBlock: string;
}

interface RelationshipsFormData {
  spouseEmailsCSV: string;
  familyEmailsCSV: string;
  workDomainsCSV: string;
}

interface ActionPreferencesFormData {
  spamDetection: boolean;
  silentFyiOnly: boolean;
  silentLargeList: boolean;
  silentUnsubscribe: boolean;
  silentTodo: boolean;
  draftGeneration: boolean;
}

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface TypedNameFormData {
  removalRegex: string;
  appendString: string;
}

interface ActionRule {
  id: string;
  userId: string;
  conditionType: 'relationship' | 'sender';
  conditionValue: string;
  targetAction: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Colors for relationship badges
const RELATIONSHIP_COLORS: Record<string, string> = {
  spouse: '#ec4899',    // pink-500
  family: '#a855f7',    // purple-500
  colleague: '#3b82f6', // blue-500
  friends: '#22c55e',   // green-500
  external: '#6b7280',  // gray-500
  spam: '#ef4444',      // red-500
  unknown: '#71717a',   // zinc-500
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  spouse: 'Spouse',
  family: 'Family',
  colleague: 'Colleague',
  friends: 'Friends',
  external: 'External',
  spam: 'Spam',
  unknown: 'Unknown',
};

// Colors for action badges
const ACTION_COLORS: Record<string, string> = {
  pending: '#a1a1aa',
  reply: '#3b82f6',
  'reply-all': '#6366f1',
  forward: '#8b5cf6',
  'forward-with-comment': '#a855f7',
  'silent-fyi-only': '#71717a',
  'silent-spam': '#ef4444',
  'silent-large-list': '#78716c',
  'silent-unsubscribe': '#737373',
  'silent-todo': '#f59e0b',
  'keep-in-inbox': '#eab308',
  training: '#06b6d4',
  'manually-handled': '#22c55e',
};

const ACTION_LABELS: Record<string, string> = {
  pending: 'Pending',
  reply: 'Reply',
  'reply-all': 'Reply All',
  forward: 'Forward',
  'forward-with-comment': 'Forward with Comment',
  'silent-fyi-only': 'FYI Only',
  'silent-spam': 'Spam',
  'silent-large-list': 'Large List',
  'silent-unsubscribe': 'Unsubscribe',
  'silent-todo': 'Todo',
  'keep-in-inbox': 'Keep in Inbox',
  training: 'Training',
  'manually-handled': 'Manually Handled',
};

interface FolderTestResult {
  requiredFolders?: string[];
  existing?: string[];
  missing?: string[];
  accounts?: Array<{
    accountId: string;
    email: string;
    success: boolean;
    existing?: string[];
    missing?: string[];
    error?: string;
  }>;
}

// Typed Name Settings Panel Component
function TypedNameSettingsPanel() {
  const { success, error: showError } = useMuiToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [regexDialogOpen, setRegexDialogOpen] = useState(false);

  const { control, handleSubmit, reset, watch, setValue } = useForm<TypedNameFormData>({
    defaultValues: {
      removalRegex: '',
      appendString: '',
    },
  });

  const currentRegex = watch('removalRegex');

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('/api/settings/typed-name', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          reset({
            removalRegex: data.preferences?.removalRegex || '',
            appendString: data.preferences?.appendString || '',
          });
        }
      } catch {
        // No preferences set yet, that's ok
      } finally {
        setIsLoading(false);
      }
    };
    fetchPreferences();
  }, [reset]);

  const onSubmit = async (formData: TypedNameFormData) => {
    // Validate regex if provided
    if (formData.removalRegex) {
      try {
        new RegExp(formData.removalRegex);
      } catch {
        showError('Invalid regular expression');
        return;
      }
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/settings/typed-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ preferences: formData }),
      });
      if (response.ok) {
        success('Typed name preferences saved');
      } else {
        showError('Failed to save preferences');
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetPattern = (pattern: string) => {
    setValue('removalRegex', pattern);
  };

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
      </Stack>
    );
  }

  return (
    <>
      <Stack spacing={3}>
        <Box>
          <Typography variant="body2" fontWeight="medium" gutterBottom>
            Name Removal Pattern (Regex)
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextFieldElement
              name="removalRegex"
              control={control}
              placeholder="e.g., ^[-\s]*(?:John|J)\s*$"
              fullWidth
              size="small"
              slotProps={{
                input: { style: { fontFamily: 'monospace', fontSize: '0.875rem' } },
              }}
            />
            <Button variant="outlined" onClick={() => setRegexDialogOpen(true)} size="small">
              Test
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Regular expression to match and remove your typed name from emails during training.
            Searches from bottom to top and removes only the first match found.
          </Typography>
        </Box>
        <Box>
          <Typography variant="body2" fontWeight="medium" gutterBottom>
            Name to Append
          </Typography>
          <TextFieldElement
            name="appendString"
            control={control}
            placeholder="e.g., -John"
            fullWidth
            size="small"
          />
          <Typography variant="caption" color="text.secondary">
            Text to append at the end of generated email responses. Leave empty to not append any name.
          </Typography>
        </Box>
        <Box>
          <Button variant="contained" onClick={handleSubmit(onSubmit)} disabled={isSaving}>
            {isSaving ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            Save Typed Name Settings
          </Button>
        </Box>
      </Stack>

      <RegexTesterDialog
        open={regexDialogOpen}
        onClose={() => setRegexDialogOpen(false)}
        onAddPattern={handleSetPattern}
        title="Test Name Removal Pattern"
        description="Test your regex pattern against sample text. The pattern will be set as your Name Removal Pattern."
        initialPattern={currentRegex}
      />
    </>
  );
}

// Regex Tester Dialog Component
interface RegexTesterDialogProps {
  open: boolean;
  onClose: () => void;
  onAddPattern: (pattern: string) => void;
  title?: string;
  description?: string;
  initialPattern?: string;
  userName?: string;
}

function generateTestEmail(userName: string): string {
  const nameParts = userName.split(' ');
  const firstName = nameParts[0]!;
  return `Hi there,

Thanks for your email. I wanted to follow up on our conversation.

Let me know if you have any questions.

-${firstName}

---
${userName}
CEO
Company Inc.
${firstName.toLowerCase()}@company.com`;
}

function RegexTesterDialog({
  open,
  onClose,
  onAddPattern,
  title = 'Test Regex Pattern',
  description = 'Test your regex pattern against sample text before adding it.',
  initialPattern = '',
  userName = 'John',
}: RegexTesterDialogProps) {
  const [pattern, setPattern] = useState(initialPattern);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    matched: boolean;
    matchedText?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setPattern(initialPattern);
      setTestText(generateTestEmail(userName));
      setTestResult(null);
    }
  }, [open, initialPattern, userName]);

  const handleTest = () => {
    if (!pattern.trim()) {
      setTestResult({ valid: false, matched: false, error: 'Please enter a regex pattern' });
      return;
    }

    try {
      const regex = new RegExp(pattern, 'm');
      const match = testText.match(regex);

      if (match) {
        setTestResult({
          valid: true,
          matched: true,
          matchedText: match[0],
        });
      } else {
        setTestResult({
          valid: true,
          matched: false,
        });
      }
    } catch (err) {
      setTestResult({
        valid: false,
        matched: false,
        error: err instanceof Error ? err.message : 'Invalid regex pattern',
      });
    }
  };

  const handleAddPattern = () => {
    if (!pattern.trim()) return;

    try {
      new RegExp(pattern);
      onAddPattern(pattern.trim());
      onClose();
    } catch {
      setTestResult({
        valid: false,
        matched: false,
        error: 'Cannot add invalid regex pattern',
      });
    }
  };

  const commonPatterns = [
    { pattern: '^-+\\s*$', desc: 'Line of dashes' },
    { pattern: '^--\\s*$', desc: 'Standard signature delimiter' },
    { pattern: `^[-\\s]*${userName.split(' ')[0]}\\s*$`, desc: 'Name with optional dash/spaces' },
    { pattern: '---[\\s\\S]*?@company\\.com', desc: 'Multi-line signature block' },
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{description}</DialogContentText>
        <Stack spacing={3}>
          <Box>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              Regex Pattern
            </Typography>
            <TextField
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g., ^-+\s*$"
              fullWidth
              size="small"
              slotProps={{
                input: { style: { fontFamily: 'monospace', fontSize: '0.875rem' } },
              }}
            />
          </Box>
          <Box>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              Test Email
            </Typography>
            <TextField
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              multiline
              rows={8}
              fullWidth
              size="small"
              slotProps={{
                input: { style: { fontFamily: 'monospace', fontSize: '0.875rem' } },
              }}
            />
          </Box>
          <Button variant="outlined" onClick={handleTest} fullWidth>
            Test Pattern
          </Button>
          {testResult && (
            <Alert
              severity={testResult.error ? 'error' : testResult.matched ? 'success' : 'warning'}
            >
              {testResult.error ? (
                testResult.error
              ) : testResult.matched ? (
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    Pattern matched!
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      mt: 1,
                      p: 1,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      overflow: 'auto',
                    }}
                  >
                    {testResult.matchedText}
                  </Box>
                </Box>
              ) : (
                'No match found in test text'
              )}
            </Alert>
          )}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              Common Patterns:
            </Typography>
            <Stack spacing={0.5}>
              {commonPatterns.map((cp, idx) => (
                <Typography key={idx} variant="caption" color="text.secondary">
                  <Box
                    component="code"
                    sx={{ bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, cursor: 'pointer' }}
                    onClick={() => setPattern(cp.pattern)}
                  >
                    {cp.pattern}
                  </Box>{' '}
                  - {cp.desc}
                </Typography>
              ))}
            </Stack>
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleAddPattern} disabled={!pattern.trim()}>
          Add Pattern
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Signature Patterns Panel Component
function SignaturePatternsPanel() {
  const { success, error: showError } = useMuiToast();
  const confirm = useConfirm();
  const [patterns, setPatterns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [regexDialogOpen, setRegexDialogOpen] = useState(false);

  useEffect(() => {
    const loadPatterns = async () => {
      try {
        const response = await fetch('/api/signature-patterns', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setPatterns(data.patterns || []);
        }
      } catch {
        // Error handled silently on initial load
      } finally {
        setIsLoading(false);
      }
    };
    loadPatterns();
  }, []);

  const savePatterns = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/signature-patterns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patterns }),
      });

      if (response.ok) {
        success('Signature patterns saved successfully');
      } else {
        const data = await response.json();
        if (data.details) {
          showError(`Invalid patterns: ${data.details.map((d: { pattern: string }) => d.pattern).join(', ')}`);
        } else {
          showError(data.error || 'Failed to save patterns');
        }
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddPattern = (pattern: string) => {
    setPatterns([...patterns, pattern]);
  };

  const handleRemovePattern = async (index: number) => {
    try {
      await confirm({
        title: 'Delete Signature Pattern',
        description: 'Are you sure you want to delete this pattern? This action cannot be undone.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      });
    } catch {
      return;
    }
    setPatterns(patterns.filter((_, i) => i !== index));
  };

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" height={40} />
        <Skeleton variant="rectangular" height={40} />
      </Stack>
    );
  }

  return (
    <>
      <Stack spacing={3}>
        <Box>
          <Typography variant="body2" fontWeight="medium" gutterBottom>
            Signature Detection Patterns
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Regular expressions to match and remove email signatures. Patterns are tested from the bottom of emails
            upward.
          </Typography>
        </Box>

        {patterns.length === 0 ? (
          <Alert severity="info">No patterns configured. Add patterns to detect and remove your email signature.</Alert>
        ) : (
          <Stack spacing={1}>
            {patterns.map((pattern, index) => (
              <Stack
                key={index}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ py: 1, px: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}
              >
                <Box
                  component="code"
                  sx={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {pattern}
                </Box>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  onClick={() => handleRemovePattern(index)}
                >
                  Delete
                </Button>
              </Stack>
            ))}
          </Stack>
        )}

        <Stack direction="row" spacing={2}>
          <Button variant="outlined" onClick={() => setRegexDialogOpen(true)}>
            Add Pattern
          </Button>
          <Button variant="contained" onClick={savePatterns} disabled={isSaving}>
            {isSaving ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            Save Patterns
          </Button>
        </Stack>
      </Stack>

      <RegexTesterDialog
        open={regexDialogOpen}
        onClose={() => setRegexDialogOpen(false)}
        onAddPattern={handleAddPattern}
        title="Add Signature Pattern"
        description="Test your regex pattern against sample text before adding it to your signature detection patterns."
      />
    </>
  );
}

// Action Rules Panel Component
function ActionRulesPanel() {
  const { success, error: showError } = useMuiToast();
  const confirm = useConfirm();
  const [rules, setRules] = useState<ActionRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const loadRules = async () => {
      try {
        const response = await fetch('/api/action-rules', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setRules(data.rules);
        }
      } catch {
        // Error handled silently on initial load
      } finally {
        setIsLoading(false);
      }
    };
    loadRules();
  }, []);

  const handleDeleteClick = async (rule: ActionRule) => {
    let confirmed = false;
    try {
      await confirm({
        title: 'Delete Action Rule',
        description: 'Are you sure you want to delete this rule? This action cannot be undone.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      });
      confirmed = true;
    } catch {
      // User cancelled
      return;
    }

    if (!confirmed) return;

    setDeletingId(rule.id);
    try {
      const response = await fetch(`/api/action-rules/${rule.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        setRules(rules.filter((r) => r.id !== rule.id));
        success('Action rule deleted');
      } else {
        const data = await response.json();
        showError(data.error || 'Failed to delete rule');
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const senderRules = rules.filter((r) => r.conditionType === 'sender');
  const relationshipRules = rules.filter((r) => r.conditionType === 'relationship');

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" height={40} />
        <Skeleton variant="rectangular" height={40} />
      </Stack>
    );
  }

  if (rules.length === 0) {
    return (
      <Alert severity="info">
        No action rules configured. Create rules by clicking on an action in the Dashboard&apos;s recent actions table.
      </Alert>
    );
  }

  const RuleRow = ({ rule }: { rule: ActionRule }) => {
    const isRelationship = rule.conditionType === 'relationship';
    const conditionColor = isRelationship
      ? RELATIONSHIP_COLORS[rule.conditionValue] || RELATIONSHIP_COLORS.unknown
      : undefined;
    const conditionLabel = isRelationship
      ? RELATIONSHIP_LABELS[rule.conditionValue] || rule.conditionValue
      : rule.conditionValue;
    const actionColor = ACTION_COLORS[rule.targetAction] || ACTION_COLORS.pending;
    const actionLabel = ACTION_LABELS[rule.targetAction] || rule.targetAction;

    return (
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ py: 1, px: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Chip
            label={conditionLabel}
            size="small"
            sx={
              isRelationship
                ? { bgcolor: conditionColor, color: 'white', fontWeight: 500 }
                : { fontWeight: 400 }
            }
          />
          <Typography color="text.secondary">→</Typography>
          <Chip
            label={actionLabel}
            size="small"
            sx={{ bgcolor: actionColor, color: 'white', fontWeight: 500 }}
          />
        </Stack>
        <Button
          variant="outlined"
          color="error"
          size="small"
          onClick={() => handleDeleteClick(rule)}
          disabled={deletingId === rule.id}
        >
          {deletingId === rule.id ? <CircularProgress size={16} /> : 'Delete'}
        </Button>
      </Stack>
    );
  };

  return (
    <Stack spacing={3}>
      {senderRules.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            Sender rules (applied to specific email addresses, processed first):
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {senderRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </Stack>
        </Box>
      )}
      {relationshipRules.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            Relationship rules (applied to all contacts of a type, processed after sender rules):
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {relationshipRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

// Profile Tab Component
function ProfileTab() {
  const { success, error: showError } = useMuiToast();
  const { data, isLoading } = useSWR<{ preferences: UserPreferences }>('/api/settings/profile');
  const [isSaving, setIsSaving] = useState(false);

  const { control, handleSubmit, reset } = useForm<ProfileFormData>({
    defaultValues: {
      name: '',
      nicknames: '',
      signatureBlock: '',
    },
  });

  useEffect(() => {
    if (data?.preferences) {
      reset({
        name: data.preferences.name || '',
        nicknames: data.preferences.nicknames || '',
        signatureBlock: data.preferences.signatureBlock || '',
      });
    }
  }, [data, reset]);

  const onSubmit = async (formData: ProfileFormData) => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        success('Profile updated successfully');
        mutate('/api/settings/profile');
      } else {
        const errorData = await response.json();
        showError(errorData.message || 'Failed to update profile');
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={120} />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Profile Information
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Update your personal information
        </Typography>
        <Stack spacing={3}>
          <TextFieldElement name="name" control={control} label="Name" placeholder="Your full name" fullWidth />
          <TextFieldElement
            name="nicknames"
            control={control}
            label="Nicknames"
            placeholder="e.g. Jessica, Jess, JW"
            helperText="Enter common nicknames or variations of your name, separated by commas"
            fullWidth
          />
          <TextFieldElement
            name="signatureBlock"
            control={control}
            label="Email Signature Block"
            placeholder="---\nCell: 212-555-1212"
            helperText="This signature will be added to your email replies"
            multiline
            rows={4}
            fullWidth
          />
          <Box>
            <Button variant="contained" onClick={handleSubmit(onSubmit)} loading={isSaving}>
              Save Profile
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Typed Name Settings
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Configure how your name appears in generated email responses
        </Typography>
        <TypedNameSettingsPanel />
      </Paper>
    </Stack>
  );
}

// Relationships Tab Component
function RelationshipsTab() {
  const { success, error: showError } = useMuiToast();
  const { data, isLoading } = useSWR<{ preferences: UserPreferences }>('/api/settings/profile');
  const [isSaving, setIsSaving] = useState(false);
  const [originalValues, setOriginalValues] = useState<RelationshipsFormData>({
    spouseEmailsCSV: '',
    familyEmailsCSV: '',
    workDomainsCSV: '',
  });

  const { control, handleSubmit, reset } = useForm<RelationshipsFormData>({
    defaultValues: originalValues,
  });

  useEffect(() => {
    if (data?.preferences) {
      const values = {
        spouseEmailsCSV: data.preferences.spouseEmailsCSV || '',
        familyEmailsCSV: data.preferences.familyEmailsCSV || '',
        workDomainsCSV: data.preferences.workDomainsCSV || '',
      };
      setOriginalValues(values);
      reset(values);
    }
  }, [data, reset]);

  const onSubmit = async (formData: RelationshipsFormData) => {
    setIsSaving(true);
    const spouseChanged = formData.spouseEmailsCSV !== originalValues.spouseEmailsCSV;
    const familyChanged = formData.familyEmailsCSV !== originalValues.familyEmailsCSV;
    const workChanged = formData.workDomainsCSV !== originalValues.workDomainsCSV;

    try {
      const response = await fetch('/api/settings/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        const result = await response.json();
        setOriginalValues(formData);

        if (result.recategorization && (spouseChanged || familyChanged || workChanged)) {
          const { updated } = result.recategorization;
          success(`Relationships updated! Re-categorized ${updated} contacts.`);
        } else {
          success('Relationships updated successfully');
        }
        mutate('/api/settings/profile');
      } else {
        const errorData = await response.json();
        showError(errorData.message || 'Failed to update relationships');
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Relationship Categorization
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Configure domains and emails to automatically categorize contacts for more precise tone when drafting emails
        </Typography>
        <Stack spacing={3}>
          <TextFieldElement
            name="spouseEmailsCSV"
            control={control}
            label="Spouse/Partner Email Addresses (CSV)"
            placeholder="partner@example.com"
            helperText="Enter spouse/partner email addresses separated by commas. This person is treated as a special case."
            fullWidth
          />
          <TextFieldElement
            name="familyEmailsCSV"
            control={control}
            label="Family Email Addresses (CSV)"
            placeholder="dad@example.com, mom@gmail.com"
            helperText="Enter family email addresses separated by commas. These contacts will be categorized as 'family'."
            fullWidth
          />
          <TextFieldElement
            name="workDomainsCSV"
            control={control}
            label="Work Domains (CSV)"
            placeholder="company.com, subsidiary.co.uk"
            helperText="Enter work domains separated by commas. Anyone from these domains will be categorized as 'colleague'."
            fullWidth
          />
          <Box>
            <Button variant="contained" onClick={handleSubmit(onSubmit)} loading={isSaving}>
              Save Relationships
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Action Override Rules
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Rules that override AI action decisions for specific relationships or senders
        </Typography>
        <ActionRulesPanel />
      </Paper>
    </Stack>
  );
}

// Services Tab Component
function ServicesTab() {
  const { success, error: showError } = useMuiToast();
  const { data, isLoading } = useSWR<{ preferences: UserPreferences }>('/api/settings/profile');
  const { data: accountsData } = useSWR<{ accounts: Array<{ id: string }> }>('/api/email-accounts');
  const hasEmailAccounts = (accountsData?.accounts?.length ?? 0) > 0;
  const [isSavingActions, setIsSavingActions] = useState(false);
  const [isTestingFolders, setIsTestingFolders] = useState(false);
  const [isCreatingFolders, setIsCreatingFolders] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderTestResult, setFolderTestResult] = useState<FolderTestResult | null>(null);

  // Use useState for folder preferences (matches original settings page pattern)
  const [folderPreferences, setFolderPreferences] = useState({
    rootFolder: '',
    noActionFolder: '',
    spamFolder: '',
    todoFolder: '',
  });

  const { control: actionControl, handleSubmit: handleActionSubmit, reset: resetActions } = useForm<ActionPreferencesFormData>({
    defaultValues: {
      spamDetection: true,
      silentFyiOnly: true,
      silentLargeList: true,
      silentUnsubscribe: true,
      silentTodo: true,
      draftGeneration: true,
    },
  });

  // Load preferences when data changes
  useEffect(() => {
    if (data?.preferences) {
      const actionPrefs = data.preferences.actionPreferences;
      if (actionPrefs) {
        resetActions({
          spamDetection: actionPrefs.spamDetection ?? true,
          silentFyiOnly: actionPrefs.silentActions?.['silent-fyi-only'] ?? true,
          silentLargeList: actionPrefs.silentActions?.['silent-large-list'] ?? true,
          silentUnsubscribe: actionPrefs.silentActions?.['silent-unsubscribe'] ?? true,
          silentTodo: actionPrefs.silentActions?.['silent-todo'] ?? true,
          draftGeneration: actionPrefs.draftGeneration ?? true,
        });
      }

      const folderPrefs = data.preferences.folderPreferences;
      if (folderPrefs) {
        setFolderPreferences({
          rootFolder: folderPrefs.rootFolder || '',
          noActionFolder: folderPrefs.noActionFolder || '',
          spamFolder: folderPrefs.spamFolder || '',
          todoFolder: folderPrefs.todoFolder || '',
        });
      }
    }
  }, [data, resetActions]);

  const onActionSubmit = async (formData: ActionPreferencesFormData) => {
    setIsSavingActions(true);
    try {
      const actionPreferences = {
        spamDetection: formData.spamDetection,
        silentActions: {
          'silent-fyi-only': formData.silentFyiOnly,
          'silent-large-list': formData.silentLargeList,
          'silent-unsubscribe': formData.silentUnsubscribe,
          'silent-todo': formData.silentTodo,
        },
        draftGeneration: formData.draftGeneration,
      };

      const response = await fetch('/api/settings/action-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ actionPreferences }),
      });
      if (response.ok) {
        success('Action preferences saved');
        mutate('/api/settings/profile');
      } else {
        showError('Failed to save action preferences');
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setIsSavingActions(false);
    }
  };

  const handleSaveFolderSettings = async () => {
    setIsTestingFolders(true);
    setFolderTestResult(null);

    try {
      // First save the preferences so test-folders can use them (matches original impl)
      const saveResponse = await fetch('/api/settings/folder-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(folderPreferences),
      });

      if (!saveResponse.ok) {
        showError('Failed to save folder preferences');
        return;
      }

      // Then test folders (API reads saved preferences from DB)
      const testResponse = await fetch('/api/settings/test-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      const result = await testResponse.json();

      // Combine results from all accounts
      const allExisting = new Set<string>();
      const allMissing = new Set<string>();
      let hasConnectionErrors = false;

      result.accounts?.forEach((account: { success: boolean; existing?: string[]; missing?: string[] }) => {
        if (account.success) {
          account.existing?.forEach((f: string) => allExisting.add(f));
          account.missing?.forEach((f: string) => allMissing.add(f));
        } else {
          hasConnectionErrors = true;
        }
      });

      const testResult = {
        ...result,
        existing: Array.from(allExisting),
        missing: Array.from(allMissing),
      };

      setFolderTestResult(testResult);

      // If all folders exist and no connection errors, we're done
      if (allMissing.size === 0 && !hasConnectionErrors) {
        success('Folder settings saved! All folders verified.');
        mutate('/api/settings/profile');
      } else {
        // Show modal for user to create missing folders or acknowledge errors
        setFolderDialogOpen(true);
      }
    } catch {
      showError('Failed to test folders');
    } finally {
      setIsTestingFolders(false);
    }
  };

  const handleCreateFolders = async () => {
    setIsCreatingFolders(true);
    try {
      const response = await fetch('/api/settings/create-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const result = await response.json();

      let totalCreated = 0;
      let totalFailed = 0;

      result.accounts?.forEach((account: { success: boolean; created?: string[]; failed?: unknown[] }) => {
        if (account.success) {
          totalCreated += account.created?.length || 0;
          totalFailed += account.failed?.length || 0;
        }
      });

      if (totalFailed > 0) {
        showError('Failed to create some folders. Please check your email account connections.');
      } else {
        success(`Created ${totalCreated} folders. Settings saved!`);
        mutate('/api/settings/profile');
        setFolderDialogOpen(false);
        setFolderTestResult(null);
      }
    } catch {
      showError('Failed to create folders');
    } finally {
      setIsCreatingFolders(false);
    }
  };

  const handleFolderDialogCancel = () => {
    setFolderDialogOpen(false);
    setFolderTestResult(null);
  };

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" height={200} />
        <Skeleton variant="rectangular" height={200} />
      </Stack>
    );
  }

  return (
    <>
      <Stack spacing={3}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Email Processing
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Configure which processing stages are enabled. Unprocessed emails will remain in your inbox.
          </Typography>
          <Stack spacing={3}>
            <SwitchElement
              name="spamDetection"
              control={actionControl}
              label={
                <Box>
                  <Typography variant="body1">Spam Detection</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Detect and move spam emails to spam folder
                  </Typography>
                </Box>
              }
            />
            <Box>
              <Typography variant="body1" gutterBottom>
                Organize Your Email
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Automatically move emails that do not require a response to a specific folder
              </Typography>
              <Stack spacing={2} sx={{ pl: 3 }}>
                <SwitchElement
                  name="silentFyiOnly"
                  control={actionControl}
                  label={
                    <Typography variant="body2">
                      FYI Only. <Typography component="span" variant="body2" color="text.secondary">Emails that do not require a response</Typography>
                    </Typography>
                  }
                />
                <SwitchElement
                  name="silentLargeList"
                  control={actionControl}
                  label={
                    <Typography variant="body2">
                      Large Distribution Lists. <Typography component="span" variant="body2" color="text.secondary">Emails sent to many people</Typography>
                    </Typography>
                  }
                />
                <SwitchElement
                  name="silentUnsubscribe"
                  control={actionControl}
                  label={
                    <Typography variant="body2">
                      Unsubscribe Candidates. <Typography component="span" variant="body2" color="text.secondary">Mailing list emails</Typography>
                    </Typography>
                  }
                />
                <SwitchElement
                  name="silentTodo"
                  control={actionControl}
                  label={
                    <Typography variant="body2">
                      Todo Items. <Typography component="span" variant="body2" color="text.secondary">Tasks to complete</Typography>
                    </Typography>
                  }
                />
              </Stack>
            </Box>
            <SwitchElement
              name="draftGeneration"
              control={actionControl}
              label={
                <Box>
                  <Typography variant="body1">Draft Generation</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Upload AI-generated reply drafts to your Drafts folder
                  </Typography>
                </Box>
              }
            />
            <Box>
              <Button variant="contained" onClick={handleActionSubmit(onActionSubmit)} loading={isSavingActions}>
                Save Action Preferences
              </Button>
            </Box>
          </Stack>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Email Folder Preferences
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Configure folders for organizing emails based on AI recommendations
          </Typography>
          {hasEmailAccounts ? (
            <Stack spacing={3}>
              <TextField
                label="Root Folder"
                value={folderPreferences.rootFolder}
                onChange={(e) => setFolderPreferences((prev) => ({ ...prev, rootFolder: e.target.value }))}
                placeholder="Leave empty for root level"
                helperText="Leave empty to create folders at the root level"
                fullWidth
                disabled={isLoading}
              />
              <TextField
                label="No Action Folder"
                value={folderPreferences.noActionFolder}
                onChange={(e) => setFolderPreferences((prev) => ({ ...prev, noActionFolder: e.target.value }))}
                placeholder="e.g., *No Action"
                helperText="FYI only, large lists, unsubscribe candidates"
                fullWidth
                disabled={isLoading}
              />
              <TextField
                label="Spam Folder"
                value={folderPreferences.spamFolder}
                onChange={(e) => setFolderPreferences((prev) => ({ ...prev, spamFolder: e.target.value }))}
                placeholder="e.g., *Spam"
                helperText="Emails identified as spam"
                fullWidth
                disabled={isLoading}
              />
              <TextField
                label="Todo Folder"
                value={folderPreferences.todoFolder}
                onChange={(e) => setFolderPreferences((prev) => ({ ...prev, todoFolder: e.target.value }))}
                placeholder="e.g., *Todo"
                helperText="Action items requiring you to do something outside of email"
                fullWidth
                disabled={isLoading}
              />
              <Box>
                <Button variant="contained" onClick={handleSaveFolderSettings} disabled={isTestingFolders}>
                  {isTestingFolders ? 'Verifying...' : 'Save Folder Settings'}
                </Button>
              </Box>
            </Stack>
          ) : (
            <Alert severity="info" sx={{ mt: 2 }}>
              You need to add an email account before configuring folder preferences.
              <Button
                href="/poc/mui-email-accounts"
                variant="text"
                size="small"
                sx={{ ml: 1 }}
              >
                Add email account
              </Button>
            </Alert>
          )}
        </Paper>
      </Stack>

      {/* Folder Verification Dialog */}
      <Dialog open={folderDialogOpen} onClose={handleFolderDialogCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Folder Verification</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {folderTestResult?.missing && folderTestResult.missing.length > 0
              ? 'Some folders need to be created on your email accounts.'
              : 'There were issues connecting to some accounts.'}
          </DialogContentText>
          {folderTestResult && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="body2" fontWeight="medium">
                  Required Folders:
                </Typography>
                <Box component="ul" sx={{ pl: 3, mt: 1 }}>
                  {folderTestResult.requiredFolders?.map((folder) => (
                    <Typography key={folder} component="li" variant="body2" color="text.secondary">
                      {folder || 'Root Level'}
                    </Typography>
                  ))}
                </Box>
              </Box>
              <Box>
                <Typography variant="body2" fontWeight="medium">
                  Account Status:
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  {folderTestResult.accounts?.map((account) => (
                    <Box key={account.accountId} sx={{ pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                      <Typography variant="body2" fontWeight="medium">
                        {account.email}
                      </Typography>
                      {account.success ? (
                        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                          {account.existing && account.existing.length > 0 && (
                            <Typography variant="caption" color="success.main">
                              ✓ Existing: {account.existing.join(', ')}
                            </Typography>
                          )}
                          {account.missing && account.missing.length > 0 && (
                            <Typography variant="caption" color="warning.main">
                              ⚠ Missing: {account.missing.join(', ')}
                            </Typography>
                          )}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="error.main">
                          ✗ Error: {account.error || 'Connection failed'}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleFolderDialogCancel}>Cancel</Button>
          {folderTestResult?.missing && folderTestResult.missing.length > 0 && (
            <Button onClick={handleCreateFolders} loading={isCreatingFolders} variant="contained">
              Create Missing Folders
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}

// Signatures Tab Component
function SignaturesTab() {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Email Signature Detection
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Configure patterns to automatically detect and remove your email signature when analyzing your writing style
      </Typography>
      <SignaturePatternsPanel />
    </Paper>
  );
}

// Security Tab Component
function SecurityTab() {
  const { success, error: showError } = useMuiToast();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const { control, handleSubmit, reset } = useForm<PasswordFormData>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (formData: PasswordFormData) => {
    if (formData.newPassword !== formData.confirmPassword) {
      showError('New passwords do not match');
      return;
    }

    if (formData.newPassword.length < 8) {
      showError('Password must be at least 8 characters');
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      });

      if (response.ok) {
        success('Password changed successfully. Please sign in again.');
        setPasswordDialogOpen(false);
        reset();
        // Optionally redirect to sign-in
      } else {
        const errorData = await response.json();
        showError(errorData.message || 'Failed to change password');
      }
    } catch {
      showError('Network error. Please try again.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <>
      <Stack spacing={3}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Security
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Manage your password and security settings
          </Typography>
          <Button variant="outlined" onClick={() => setPasswordDialogOpen(true)}>
            Change Password
          </Button>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Danger Zone
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Irreversible actions
          </Typography>
          <Button variant="contained" color="error">
            Delete Account
          </Button>
        </Paper>
      </Stack>

      {/* Change Password Dialog */}
      <Dialog
        open={passwordDialogOpen}
        onClose={() => setPasswordDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>Enter your current password and choose a new one.</DialogContentText>
          <Stack spacing={3}>
            <TextFieldElement
              name="currentPassword"
              control={control}
              label="Current Password"
              type="password"
              placeholder="Enter current password"
              fullWidth
            />
            <TextFieldElement
              name="newPassword"
              control={control}
              label="New Password"
              type="password"
              placeholder="Enter new password"
              fullWidth
            />
            <TextFieldElement
              name="confirmPassword"
              control={control}
              label="Confirm New Password"
              type="password"
              placeholder="Confirm new password"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPasswordDialogOpen(false);
              reset();
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSubmit(onSubmit)} loading={isChangingPassword}>
            Change Password
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// Main Component
export default function MuiSettingsPage() {
  const [tabValue, setTabValue] = useState(0);

  return (
    <>
      {/* Page Header */}
      <Box mb={3}>
        <Typography variant="h4">Settings</Typography>
        <Typography variant="body2" color="text.secondary">
          Manage your profile, relationships, and preferences
        </Typography>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Profile" />
          <Tab label="Relationships" />
          <Tab label="Services" />
          <Tab label="Signatures" />
          <Tab label="Security" />
        </Tabs>
      </Box>

      {/* Tab Panels */}
      {tabValue === 0 && <ProfileTab />}
      {tabValue === 1 && <RelationshipsTab />}
      {tabValue === 2 && <ServicesTab />}
      {tabValue === 3 && <SignaturesTab />}
      {tabValue === 4 && <SecurityTab />}
    </>
  );
}
