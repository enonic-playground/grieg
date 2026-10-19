import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useTranslation } from 'react-i18next';

import type { ReactElement, ReactNode } from 'react';

import { Button } from './button';

export type ConfirmDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // Runs as the dialog unmounts; `preventDefault()` keeps focus off the element that opened it.
  onCloseAutoFocus?: (event: Event) => void;
};

const CONFIRM_DIALOG_NAME = 'ConfirmDialog';

// Always open while mounted: the caller mounts it to ask and unmounts it to close, and focus
// returns to whatever held it before.
export const ConfirmDialog = ({
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
  onCloseAutoFocus,
}: ConfirmDialogProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          data-component={CONFIRM_DIALOG_NAME}
          onCloseAutoFocus={onCloseAutoFocus}
          className="bg-card text-card-foreground fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border p-5 shadow-lg"
        >
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground text-sm">
            {description}
          </AlertDialog.Description>
          <div className="flex justify-end gap-2 pt-2">
            <AlertDialog.Cancel asChild>
              <Button disabled={pending}>{t('common.action.cancel')}</Button>
            </AlertDialog.Cancel>
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};

ConfirmDialog.displayName = CONFIRM_DIALOG_NAME;
