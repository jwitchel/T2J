import { useSnackbar, VariantType } from 'notistack';

export interface MuiToastActions {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

export function useMuiToast(): MuiToastActions {
  const { enqueueSnackbar } = useSnackbar();

  const showToast = (message: string, variant: VariantType) => {
    enqueueSnackbar(message, { variant });
  };

  return {
    success: (message: string) => showToast(message, 'success'),
    error: (message: string) => showToast(message, 'error'),
    info: (message: string) => showToast(message, 'info'),
    warning: (message: string) => showToast(message, 'warning'),
  };
}
