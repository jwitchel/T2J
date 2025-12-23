'use client';

import { useState, useMemo } from 'react';
import { LazyLog, ScrollFollow } from '@melloware/react-logviewer';
import { Box, Paper, Stack, IconButton, Tooltip, FormControlLabel, Switch } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import DeleteIcon from '@mui/icons-material/Delete';

interface MuiLogViewerProps {
  height?: number | string;
  autoConnect?: boolean;
}

export function MuiLogViewer({ height = 400, autoConnect = false }: MuiLogViewerProps) {
  const [connected, setConnected] = useState(autoConnect);
  const [follow, setFollow] = useState(true);
  const [key, setKey] = useState(0);

  const wsUrl = useMemo(() => {
    if (typeof window === 'undefined' || !connected) return undefined;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws?format=text`;
  }, [connected]);

  const handleClear = () => {
    setKey((k) => k + 1);
  };

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tooltip title={connected ? 'Disconnect' : 'Connect'}>
          <IconButton
            onClick={() => setConnected(!connected)}
            size="small"
            color={connected ? 'error' : 'success'}
          >
            {connected ? <StopIcon /> : <PlayArrowIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Clear logs">
          <IconButton onClick={handleClear} size="small" disabled={!connected}>
            <DeleteIcon />
          </IconButton>
        </Tooltip>
        <FormControlLabel
          control={
            <Switch checked={follow} onChange={(e) => setFollow(e.target.checked)} size="small" />
          }
          label="Auto-scroll"
          sx={{ ml: 1 }}
        />
      </Stack>
      <Box sx={{ height, bgcolor: 'grey.900' }}>
        {wsUrl ? (
          <ScrollFollow
            key={key}
            startFollowing={follow}
            render={({ follow: scrollFollow }) => (
              <LazyLog
                url={wsUrl}
                follow={scrollFollow}
                enableSearch
                caseInsensitive
                selectableLines
                extraLines={1}
              />
            )}
          />
        ) : (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'grey.500',
              fontFamily: 'monospace',
            }}
          >
            Click play to connect...
          </Box>
        )}
      </Box>
    </Paper>
  );
}
