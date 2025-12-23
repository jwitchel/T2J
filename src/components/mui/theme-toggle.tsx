'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';

export function MuiThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    handleClose();
  };

  const getIcon = () => {
    if (!mounted) return <SettingsBrightnessIcon />;
    if (theme === 'dark') return <DarkModeIcon />;
    if (theme === 'light') return <LightModeIcon />;
    return <SettingsBrightnessIcon />;
  };

  return (
    <>
      <IconButton onClick={handleClick} color="inherit">
        {getIcon()}
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { zIndex: 1300 } } }}
      >
        <MenuItem onClick={() => handleThemeChange('light')}>
          <ListItemIcon>
            <LightModeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Light</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleThemeChange('dark')}>
          <ListItemIcon>
            <DarkModeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Dark</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleThemeChange('system')}>
          <ListItemIcon>
            <SettingsBrightnessIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>System</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
