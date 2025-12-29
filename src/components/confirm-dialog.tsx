'use client';

import { useState, useCallback, createContext, useContext, ReactNode } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  ButtonProps,
} from '@mui/material';

interface ConfirmOptions {
  title: string;
  description: string;
  confirmationText?: string;
  cancellationText?: string;
  confirmationButtonProps?: ButtonProps;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmContextValue {
  showConfirm: (options: ConfirmOptions) => void;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const showConfirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setOpen(true);
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    setOptions(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    setOpen(false);
    if (options?.onConfirm) {
      await options.onConfirm();
    }
    setOptions(null);
  }, [options]);

  return (
    <ConfirmContext.Provider value={{ showConfirm }}>
      {children}
      <Dialog
        open={open}
        onClose={handleCancel}
        disableRestoreFocus
      >
        {options && (
          <>
            <DialogTitle>{options.title}</DialogTitle>
            <DialogContent>
              <DialogContentText>{options.description}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCancel}>
                {options.cancellationText ?? 'Cancel'}
              </Button>
              <Button
                onClick={handleConfirm}
                color="error"
                variant="contained"
                {...options.confirmationButtonProps}
              >
                {options.confirmationText ?? 'Confirm'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context.showConfirm;
}
