'use client';

import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import {
  Box,
  Paper,
  Typography,
  Button,
  Skeleton,
  Alert,
  Stack,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Tabs,
  Tab,
  Chip,
  LinearProgress,
  Divider,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import BarChartIcon from '@mui/icons-material/BarChart';
import { useConfirm } from 'material-ui-confirm';
import { useMuiToast } from '@/hooks/use-mui-toast';

// Types
interface WritingPatterns {
  sentencePatterns: {
    avgLength: number;
    medianLength: number;
    trimmedMean: number;
    minLength: number;
    maxLength: number;
    stdDeviation: number;
    percentile25: number;
    percentile75: number;
    distribution?: {
      short: number;
      medium: number;
      long: number;
    };
  };
  paragraphPatterns: Array<{
    type?: string;
    structure?: string;
    percentage: number;
    description?: string;
  }>;
  openingPatterns: Array<{
    pattern?: string;
    text?: string;
    percentage: number;
    frequency?: number;
  }>;
  valediction: Array<{
    phrase: string;
    percentage: number;
  }>;
  negativePatterns: Array<{
    expression?: string;
    description?: string;
    alternatives?: string[];
    confidence?: number;
    context?: string;
  }>;
  responsePatterns?: {
    immediate: number;
    contemplative: number;
    questionHandling: string;
  };
  uniqueExpressions: Array<{
    phrase: string;
    context: string;
    frequency?: number;
    occurrenceRate?: number;
  }>;
}

interface ToneProfile extends Partial<WritingPatterns> {
  meta?: {
    modelUsed?: string;
    corpusSize?: number;
    sentenceStats?: {
      lastCalculated: string;
      totalSentences: number;
      calculationMethod: string;
    };
    [key: string]: unknown;
  };
  emails_analyzed: number;
  updated_at: string;
  preference_type: string;
}

interface ToneData {
  profiles: Record<string, ToneProfile>;
  totalEmailsAnalyzed: number;
  totalEmailsLoaded: number;
  lastUpdated: string | null;
}

interface EmailAccount {
  id: string;
  email_address: string;
}

interface UserPreferences {
  name: string;
  nicknames: string;
  signatureBlock: string;
}

// Helper functions
const formatNumber = (value: number | null | undefined, decimals: number = 1): string => {
  if (value === null || value === undefined) return '0';
  return value.toFixed(decimals);
};

// Stat component - matches original styling
interface StatProps {
  label: string;
  value: string | number;
  description?: string;
  highlighted?: boolean;
}

function Stat({ label, value, description, highlighted }: StatProps) {
  return (
    <Box sx={highlighted ? { borderLeft: 4, borderColor: 'primary.main', pl: 2 } : undefined}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" component="p">
        {value}
      </Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
    </Box>
  );
}

// PatternRow component - full width with progress bar
interface PatternRowProps {
  label: string;
  value: number;
  showProgress?: boolean;
}

function PatternRow({ label, value, showProgress = true }: PatternRowProps) {
  const percentage = value * 100;
  const displayValue = percentage > 0 && percentage < 1 ? '< 1%' : `${Math.round(percentage)}%`;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Typography variant="body2" sx={{ flex: 1 }}>
        {label}
      </Typography>
      {showProgress && (
        <LinearProgress
          variant="determinate"
          value={percentage}
          sx={{ width: 100, height: 8, borderRadius: 1 }}
        />
      )}
      <Typography variant="body2" color="text.secondary" sx={{ width: 48, textAlign: 'right' }}>
        {displayValue}
      </Typography>
    </Box>
  );
}

export default function MuiTonePage() {
  // Tab state
  const [tabValue, setTabValue] = useState(0);

  // Data fetching
  const { data: toneData, error: toneError, isLoading: toneLoading } = useSWR<ToneData>('/api/tone-profile');
  const { data: emailAccounts, error: accountsError, isLoading: accountsLoading } = useSWR<EmailAccount[]>('/api/email-accounts');
  const { data: userPreferencesData } = useSWR<{ preferences: UserPreferences }>('/api/settings/profile');

  // Training state
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [emailCount, setEmailCount] = useState('100');
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Results state
  const [selectedRelationship, setSelectedRelationship] = useState(0);

  // Toast and confirm
  const { success, error: showError } = useMuiToast();
  const confirm = useConfirm();

  // Initialize selected account
  useEffect(() => {
    if (emailAccounts && emailAccounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(emailAccounts[0].id);
    }
  }, [emailAccounts, selectedAccountId]);

  // Load emails handler
  const handleLoadEmails = async () => {
    if (!selectedAccountId) {
      showError('Please select an email account');
      return;
    }

    setIsLoadingEmails(true);
    success(`Loading ${emailCount} emails...`);
    try {
      const response = await fetch('/api/training/load-sent-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailAccountId: selectedAccountId,
          limit: parseInt(emailCount),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        success(`Loaded ${data.count || emailCount} emails successfully`);
        setTimeout(() => mutate('/api/tone-profile'), 2000);
      } else {
        const data = await response.json();
        showError(data.error || 'Failed to load emails');
      }
    } catch {
      showError('Failed to load emails');
    } finally {
      setIsLoadingEmails(false);
    }
  };

  // Analyze patterns handler
  const handleAnalyzePatterns = async () => {
    setIsAnalyzing(true);
    success('Analyzing email patterns...');
    try {
      const response = await fetch('/api/training/analyze-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (response.ok) {
        success('Pattern analysis completed successfully');
        setTimeout(() => mutate('/api/tone-profile'), 2000);
      } else {
        const data = await response.json();
        showError(data.error || 'Failed to analyze patterns');
      }
    } catch {
      showError('Failed to analyze patterns');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Wipe data handler
  const handleWipeData = async () => {
    try {
      await confirm({
        title: 'Wipe All Training Data',
        description: 'This will permanently delete all stored email data from the database. This cannot be undone.',
        confirmationText: 'Wipe Data',
        confirmationButtonProps: { color: 'error' },
      });

      const response = await fetch('/api/training/wipe', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        success('Emails wiped successfully');
        mutate('/api/tone-profile');
      } else {
        showError('Failed to wipe data');
      }
    } catch {
      // User cancelled
    }
  };

  // Error state
  if (toneError || accountsError) {
    return <Alert severity="error">Failed to load tone analysis data. Please try again later.</Alert>;
  }

  // Loading state
  if (toneLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" height={52} />
        <Skeleton variant="rectangular" height={200} />
        <Skeleton variant="rectangular" height={200} />
      </Stack>
    );
  }

  const hasProfiles = toneData && Object.keys(toneData.profiles).length > 0;

  // Sort profiles with 'aggregate' (Overall) first
  const sortedProfiles = hasProfiles
    ? Object.entries(toneData.profiles).sort(([keyA], [keyB]) => {
        if (keyA === 'aggregate') return -1;
        if (keyB === 'aggregate') return 1;
        return keyA.localeCompare(keyB);
      })
    : [];

  const selectedProfileKey = sortedProfiles[selectedRelationship]?.[0] || 'aggregate';
  const currentProfile = hasProfiles ? toneData.profiles[selectedProfileKey] : null;
  const patterns = currentProfile as WritingPatterns | null;
  const userPreferences = userPreferencesData?.preferences;

  return (
    <>
      {/* Page Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Tone Analysis</Typography>
        <Typography variant="body2" color="text.secondary">
          {toneData && toneData.totalEmailsLoaded > 0
            ? `Analyze your writing style from ${toneData.totalEmailsLoaded} emails`
            : 'Build your tone profile by loading and analyzing emails'}
        </Typography>
      </Box>

      {/* Main Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Training" />
          <Tab label="Tuning" />
          <Tab label="Results" />
        </Tabs>
      </Box>

      {/* Training Tab */}
      {tabValue === 0 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={3}>
            {/* Training Toolbar */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
              }}
            >
              <FormControl size="small" sx={{ width: 280 }}>
                <InputLabel id="email-account-label">Email Account</InputLabel>
                <Select
                  labelId="email-account-label"
                  id="email-account-select"
                  value={emailAccounts?.length ? selectedAccountId : ''}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  label="Email Account"
                  disabled={accountsLoading || !emailAccounts?.length}
                >
                  {accountsLoading && (
                    <MenuItem value="" disabled>
                      Loading...
                    </MenuItem>
                  )}
                  {!accountsLoading && emailAccounts?.length === 0 && (
                    <MenuItem value="" disabled>
                      No accounts configured
                    </MenuItem>
                  )}
                  {emailAccounts?.map((account) => (
                    <MenuItem key={account.id} value={account.id}>
                      {account.email_address}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Count"
                type="number"
                value={emailCount}
                onChange={(e) => setEmailCount(e.target.value)}
                size="small"
                sx={{ width: 100 }}
              />

              <Box sx={{ flex: 1 }} />

              <Button
                variant="contained"
                startIcon={<DownloadIcon />}
                onClick={handleLoadEmails}
                disabled={isLoadingEmails || !selectedAccountId}
              >
                {isLoadingEmails ? 'Loading...' : 'Load Emails'}
              </Button>

              <Button
                variant="contained"
                color="success"
                startIcon={<BarChartIcon />}
                onClick={handleAnalyzePatterns}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? 'Analyzing...' : 'Analyze Patterns'}
              </Button>

              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleWipeData}
              >
                Wipe Data
              </Button>
            </Box>

            {/* Placeholder for logs */}
            <Box sx={{ p: 4, bgcolor: 'action.hover', borderRadius: 1, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Training logs will appear here
              </Typography>
            </Box>
          </Stack>
        </Paper>
      )}

      {/* Tuning Tab */}
      {tabValue === 1 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Tuning
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Fine-tune your tone analysis settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            TBD
          </Typography>
        </Paper>
      )}

      {/* Results Tab */}
      {tabValue === 2 && (
        <>
          {!hasProfiles ? (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="h6" gutterBottom>
                No Results Yet
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Load and analyze emails from the Training tab to see your tone profile
              </Typography>
              {emailAccounts?.length === 0 ? (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    You need to add an email account first.
                  </Typography>
                  <Button variant="contained" href="/settings/email-accounts">
                    Add Email Account
                  </Button>
                </Box>
              ) : (
                <Button variant="contained" onClick={() => setTabValue(0)} sx={{ mt: 2 }}>
                  Go to Training
                </Button>
              )}
            </Paper>
          ) : (
            <>
              {/* Relationship Selector - Full width tab bar */}
              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs
                  value={selectedRelationship}
                  onChange={(_, newValue) => setSelectedRelationship(newValue)}
                  variant="scrollable"
                  scrollButtons="auto"
                >
                  {sortedProfiles.map(([key, profile], index) => (
                    <Tab
                      key={key}
                      value={index}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <span style={{ textTransform: 'capitalize' }}>
                            {key === 'aggregate' ? 'Overall' : key}
                          </span>
                          <Chip label={profile.emails_analyzed} size="small" />
                        </Box>
                      }
                    />
                  ))}
                </Tabs>
              </Box>

              <Stack spacing={3}>
                {/* Sentence Patterns */}
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Sentence Patterns
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Your typical sentence structure
                  </Typography>

                  {/* Primary stats row */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 3,
                      mt: 2,
                    }}
                  >
                    <Stat
                      label="Median Length"
                      value={`${formatNumber(patterns?.sentencePatterns?.medianLength || patterns?.sentencePatterns?.avgLength)} words`}
                      description="Most representative"
                      highlighted
                    />
                    <Stat
                      label="Trimmed Mean"
                      value={`${formatNumber(patterns?.sentencePatterns?.trimmedMean || patterns?.sentencePatterns?.avgLength)} words`}
                      description="Excludes outliers"
                    />
                    <Stat
                      label="Average"
                      value={`${formatNumber(patterns?.sentencePatterns?.avgLength)} words`}
                      description="All sentences"
                    />
                  </Box>

                  <Divider sx={{ my: 3 }} />

                  {/* Secondary stats row */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 3,
                    }}
                  >
                    <Stat
                      label="Range"
                      value={`${patterns?.sentencePatterns?.minLength || 0} - ${patterns?.sentencePatterns?.maxLength || 0}`}
                    />
                    <Stat
                      label="Middle 50%"
                      value={`${formatNumber(patterns?.sentencePatterns?.percentile25, 0)} - ${formatNumber(patterns?.sentencePatterns?.percentile75, 0)}`}
                    />
                    <Stat
                      label="Std Dev"
                      value={formatNumber(patterns?.sentencePatterns?.stdDeviation)}
                    />
                    <Stat
                      label="Variability"
                      value={`${patterns?.sentencePatterns?.stdDeviation && patterns?.sentencePatterns?.avgLength ? formatNumber((patterns.sentencePatterns.stdDeviation / patterns.sentencePatterns.avgLength) * 100, 0) : '0'}%`}
                    />
                  </Box>

                  {patterns?.sentencePatterns?.distribution && (
                    <>
                      <Divider sx={{ my: 3 }} />
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Length Distribution
                      </Typography>
                      <Stack spacing={1}>
                        <PatternRow label="Short sentences" value={patterns.sentencePatterns.distribution.short} />
                        <PatternRow label="Medium sentences" value={patterns.sentencePatterns.distribution.medium} />
                        <PatternRow label="Long sentences" value={patterns.sentencePatterns.distribution.long} />
                      </Stack>
                    </>
                  )}
                </Paper>

                {/* Opening Patterns */}
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Email Openings
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    How you start your emails
                  </Typography>
                  <Stack spacing={1}>
                    {patterns?.openingPatterns && patterns.openingPatterns.length > 0 ? (
                      patterns.openingPatterns.map((pattern, idx) => (
                        <PatternRow
                          key={idx}
                          label={pattern.text || pattern.pattern || 'Unknown'}
                          value={pattern.percentage || pattern.frequency || 0}
                        />
                      ))
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No opening patterns found
                      </Typography>
                    )}
                  </Stack>
                </Paper>

                {/* Paragraph Patterns */}
                {patterns?.paragraphPatterns && patterns.paragraphPatterns.length > 0 && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Paragraph Structure
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      How you organize your content
                    </Typography>
                    <Stack spacing={1}>
                      {patterns.paragraphPatterns.map((pattern, idx) => (
                        <PatternRow
                          key={idx}
                          label={pattern.type || pattern.structure || 'Unknown'}
                          value={pattern.percentage / 100}
                        />
                      ))}
                    </Stack>
                  </Paper>
                )}

                {/* Response Patterns */}
                {patterns?.responsePatterns && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Response Style
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      How you typically respond
                    </Typography>
                    {selectedProfileKey === 'aggregate' &&
                    patterns.responsePatterns.immediate === 0 &&
                    patterns.responsePatterns.contemplative === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        Response style analysis is available in specific relationship tabs.
                      </Typography>
                    ) : (
                      <Stack spacing={3}>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 3,
                          }}
                        >
                          <Box>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Immediate responses
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <LinearProgress
                                variant="determinate"
                                value={(patterns.responsePatterns.immediate || 0) * 100}
                                sx={{ flex: 1, height: 8, borderRadius: 1 }}
                              />
                              <Typography variant="body2">
                                {Math.round((patterns.responsePatterns.immediate || 0) * 100)}%
                              </Typography>
                            </Box>
                          </Box>
                          <Box>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                              Contemplative responses
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <LinearProgress
                                variant="determinate"
                                value={(patterns.responsePatterns.contemplative || 0) * 100}
                                sx={{ flex: 1, height: 8, borderRadius: 1 }}
                              />
                              <Typography variant="body2">
                                {Math.round((patterns.responsePatterns.contemplative || 0) * 100)}%
                              </Typography>
                            </Box>
                          </Box>
                        </Box>
                        {patterns.responsePatterns.questionHandling &&
                          patterns.responsePatterns.questionHandling !== 'varies' && (
                            <>
                              <Divider />
                              <Box>
                                <Typography variant="body2" color="text.secondary" gutterBottom>
                                  Question handling style
                                </Typography>
                                <Typography variant="body2">
                                  {patterns.responsePatterns.questionHandling}
                                </Typography>
                              </Box>
                            </>
                          )}
                      </Stack>
                    )}
                  </Paper>
                )}

                {/* Valedictions and Name Signature - Side by side */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 3,
                  }}
                >
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Valedictions
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      How you sign off
                    </Typography>
                    <Stack spacing={1}>
                      {patterns?.valediction && patterns.valediction.length > 0 ? (
                        patterns.valediction.map((pattern, idx) => (
                          <PatternRow key={idx} label={pattern.phrase} value={pattern.percentage / 100} />
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No valediction patterns found
                        </Typography>
                      )}
                    </Stack>
                  </Paper>

                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Name Signature
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      How you sign your emails
                    </Typography>
                    {userPreferences &&
                    (userPreferences.name || userPreferences.nicknames || userPreferences.signatureBlock) ? (
                      <Stack spacing={2}>
                        {userPreferences.name && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              Name
                            </Typography>
                            <Typography variant="body2">{userPreferences.name}</Typography>
                          </Box>
                        )}
                        {userPreferences.nicknames && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              Nicknames
                            </Typography>
                            <Typography variant="body2">{userPreferences.nicknames}</Typography>
                          </Box>
                        )}
                        {userPreferences.signatureBlock && (
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              Signature Block
                            </Typography>
                            <Box
                              component="pre"
                              sx={{
                                mt: 1,
                                p: 1.5,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                fontSize: '0.75rem',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {userPreferences.signatureBlock}
                            </Box>
                          </Box>
                        )}
                        <Button variant="outlined" size="small" href="/settings">
                          Edit Settings
                        </Button>
                      </Stack>
                    ) : (
                      <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">
                          No signature configured
                        </Typography>
                        <Button variant="outlined" size="small" href="/settings">
                          Configure Settings
                        </Button>
                      </Stack>
                    )}
                  </Paper>
                </Box>

                {/* Unique Expressions */}
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Unique Expressions
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Phrases that are distinctively yours
                  </Typography>
                  <Stack spacing={2} divider={<Divider />}>
                    {patterns?.uniqueExpressions && patterns.uniqueExpressions.length > 0 ? (
                      patterns.uniqueExpressions.slice(0, 10).map((expr, idx) => (
                        <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {expr.phrase}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {expr.context}
                            </Typography>
                          </Box>
                          <Chip label={`${Math.round((expr.occurrenceRate || expr.frequency || 0) * 100)}%`} size="small" />
                        </Box>
                      ))
                    ) : selectedProfileKey === 'aggregate' ? (
                      <Typography variant="body2" color="text.secondary">
                        Unique expressions are available in specific relationship tabs.
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No unique expressions found
                      </Typography>
                    )}
                  </Stack>
                </Paper>

                {/* Expressions to Avoid */}
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Expressions to Avoid
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Phrases you typically don&apos;t use
                  </Typography>
                  <Stack spacing={2} divider={<Divider />}>
                    {patterns?.negativePatterns && patterns.negativePatterns.length > 0 ? (
                      patterns.negativePatterns.map((pattern, idx) => (
                        <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" color="error">
                              Avoid: &quot;{pattern.expression || pattern.description || 'Unknown'}&quot;
                            </Typography>
                            {pattern.alternatives && pattern.alternatives.length > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                Try instead: {pattern.alternatives.join(', ')}
                              </Typography>
                            )}
                            {pattern.context && (
                              <Typography variant="caption" color="text.secondary" display="block">
                                Context: {pattern.context}
                              </Typography>
                            )}
                          </Box>
                          {pattern.confidence && (
                            <Chip label={`${Math.round(pattern.confidence * 100)}%`} size="small" />
                          )}
                        </Box>
                      ))
                    ) : selectedProfileKey === 'aggregate' ? (
                      <Typography variant="body2" color="text.secondary">
                        Expression avoidance patterns are available in specific relationship tabs.
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No avoidance patterns found
                      </Typography>
                    )}
                  </Stack>
                </Paper>

                {/* Analysis Details */}
                {currentProfile && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Analysis Details
                    </Typography>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        gap: 3,
                        mt: 2,
                      }}
                    >
                      <Stat label="Emails Analyzed" value={currentProfile.emails_analyzed} />
                      <Stat label="Last Updated" value={new Date(currentProfile.updated_at).toLocaleDateString()} />
                      {typeof currentProfile.meta?.modelUsed === 'string' && (
                        <Stat label="AI Model" value={currentProfile.meta.modelUsed} />
                      )}
                      {typeof currentProfile.meta?.corpusSize === 'number' && (
                        <Stat label="Sample Size" value={`${currentProfile.meta.corpusSize} emails`} />
                      )}
                      {typeof currentProfile.meta?.confidence === 'number' && (
                        <Stat label="Confidence" value={`${Math.round(currentProfile.meta.confidence * 100)}%`} />
                      )}
                      {currentProfile.meta?.sentenceStats && (
                        <>
                          <Stat label="Analysis Method" value="Direct calculation" />
                          <Stat
                            label="Sentences Analyzed"
                            value={currentProfile.meta.sentenceStats.totalSentences.toLocaleString()}
                          />
                        </>
                      )}
                    </Box>
                  </Paper>
                )}
              </Stack>
            </>
          )}
        </>
      )}
    </>
  );
}
