import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { Button } from './button';

type CopyState = 'idle' | 'copied' | 'failed';

const RESET_AFTER_MS = 2000;

export type CopyButtonProps = {
  text: string;
  label?: string;
};

const COPY_BUTTON_NAME = 'CopyButton';

export const CopyButton = ({ text, label }: CopyButtonProps): ReactElement => {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), RESET_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // `navigator.clipboard` exists only in secure contexts, and XP is often served over plain HTTP.
  const copy = (): void => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard == null) {
      setState('failed');
      return;
    }
    clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };

  const stateLabel =
    state === 'copied'
      ? t('common.action.copied')
      : state === 'failed'
        ? t('common.action.copyFailed')
        : (label ?? t('common.action.copy'));

  return (
    <>
      <Button data-component={COPY_BUTTON_NAME} size="sm" onClick={copy}>
        {state === 'copied' ? <Check /> : <Copy />}
        {stateLabel}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === 'idle' ? '' : stateLabel}
      </span>
    </>
  );
};

CopyButton.displayName = COPY_BUTTON_NAME;
