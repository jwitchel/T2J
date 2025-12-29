'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppBar,
  Toolbar,
  Button,
  Stack,
  Container,
  useMediaQuery,
  useTheme,
  Typography,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import MailIcon from '@mui/icons-material/Mail';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import WorkIcon from '@mui/icons-material/Work';
import TuneIcon from '@mui/icons-material/Tune';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { MuiThemeToggle } from './theme-toggle';
import { useMuiToast } from '@/hooks/use-mui-toast';

interface NavLink {
  href: string;
  label: string;
}

interface MuiNavbarProps {
  variant: 'public' | 'authenticated';
  user?: {
    name?: string;
    email: string;
  };
  onSignOut?: () => Promise<void>;
}

const publicNavLinks: NavLink[] = [
  { href: '/about', label: 'About' },
  { href: '/demo', label: 'Demo' },
  { href: '/faq', label: 'FAQ' },
];

const authenticatedMenuItems = [
  { href: '/tone', label: 'Tone Analysis', icon: TuneIcon },
  { divider: true },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
  { href: '/settings/email-accounts', label: 'Email Accounts', icon: MailIcon },
  { href: '/settings/llm-providers', label: 'LLM Providers', icon: SmartToyIcon },
  { divider: true, label: 'Development Tools' },
  { href: '/dashboard/jobs', label: 'Jobs', icon: WorkIcon },
];

export function MuiNavbar({ variant, user, onSignOut }: MuiNavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useTheme();
  const { success } = useMuiToast();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const menuOpen = Boolean(anchorEl);

  useEffect(() => {
    setIsLocalhost(window.location.hostname === 'localhost');
  }, []);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleSignOut = async () => {
    handleMenuClose();
    try {
      await onSignOut?.();
      success('You have been signed out');
      router.push('/signin');
    } catch {
      // Error already handled by auth context
    }
  };

  const displayName = user?.name || user?.email || '';
  const homeHref = variant === 'public' ? '/' : '/dashboard';

  return (
    <>
      {/* Localhost indicator */}
      {isLocalhost && <div style={{ height: 3, backgroundColor: '#ef4444' }} />}

      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ justifyContent: 'space-between' }}>
            {/* Logo and Nav Links */}
            <Stack direction="row" alignItems="center" spacing={4}>
              <Link href={homeHref} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}>
                <Image src="/logo.png" alt="Time to Just Logo" width={32} height={32} className="logo-rotate" />
                <Typography variant="subtitle1">
                  Time to Just
                </Typography>
              </Link>

              {/* Public nav links (desktop) */}
              {variant === 'public' && !isMobile && (
                <Stack direction="row" spacing={1}>
                  {publicNavLinks.map((link) => (
                    <Button
                      key={link.href}
                      component={Link}
                      href={link.href}
                      color={pathname === link.href ? 'primary' : 'inherit'}
                    >
                      {link.label}
                    </Button>
                  ))}
                </Stack>
              )}
            </Stack>

            {/* Right side actions */}
            <Stack direction="row" spacing={1} alignItems="center">
              <MuiThemeToggle />
              <Divider orientation="vertical" flexItem />

              {variant === 'public' ? (
                /* Public: Sign In / Sign Up buttons */
                <>
                  <Button component={Link} href="/signin" color="inherit">
                    Sign In
                  </Button>
                  <Button component={Link} href="/signup" variant="contained">
                    Sign Up
                  </Button>
                </>
              ) : (
                /* Authenticated: User dropdown menu */
                <>
                  <Button
                    onClick={handleMenuClick}
                    color="inherit"
                    endIcon={<KeyboardArrowDownIcon />}
                    startIcon={<PersonIcon />}
                  >
                    {!isMobile && displayName}
                  </Button>
                  <Menu
                    anchorEl={anchorEl}
                    open={menuOpen}
                    onClose={handleMenuClose}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    slotProps={{ paper: { sx: { minWidth: 200 } } }}
                  >
                    {authenticatedMenuItems.map((item, index) => {
                      if ('divider' in item && item.divider) {
                        return item.label ? (
                          <MenuItem key={index} disabled sx={{ opacity: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              {item.label}
                            </Typography>
                          </MenuItem>
                        ) : (
                          <Divider key={index} />
                        );
                      }
                      const Icon = item.icon!;
                      return (
                        <MenuItem
                          key={item.href}
                          component={Link}
                          href={item.href!}
                          onClick={handleMenuClose}
                        >
                          <ListItemIcon>
                            <Icon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText>{item.label}</ListItemText>
                        </MenuItem>
                      );
                    })}
                    <Divider />
                    <MenuItem onClick={handleSignOut} sx={{ color: 'error.main' }}>
                      <ListItemIcon>
                        <LogoutIcon fontSize="small" color="error" />
                      </ListItemIcon>
                      <ListItemText>Sign Out</ListItemText>
                    </MenuItem>
                  </Menu>
                </>
              )}
            </Stack>
          </Toolbar>

          {/* Mobile Nav for public pages */}
          {variant === 'public' && isMobile && (
            <Stack direction="row" spacing={1} sx={{ pb: 1 }}>
              {publicNavLinks.map((link) => (
                <Button
                  key={link.href}
                  component={Link}
                  href={link.href}
                  size="small"
                  color={pathname === link.href ? 'primary' : 'inherit'}
                >
                  {link.label}
                </Button>
              ))}
            </Stack>
          )}
        </Container>
      </AppBar>
    </>
  );
}
