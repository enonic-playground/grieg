import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { Button } from '../ui/button';
import { Snippet } from './snippet';

export type KeyRevealProps = {
  apiKey: string;
  onDone: () => void;
};

const KEY_REVEAL_NAME = 'KeyReveal';

export const KeyReveal = ({ apiKey, onDone }: KeyRevealProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <div data-component={KEY_REVEAL_NAME} className="flex flex-col gap-4">
      <div
        role="alert"
        className="border-warning/40 bg-warning/10 text-foreground flex items-start gap-2 rounded-md border p-3 text-sm"
      >
        <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" />
        <span>{t('mcp.reveal.warning')}</span>
      </div>

      <Snippet label={t('mcp.reveal.key')} text={apiKey} />

      <div>
        <Button variant="primary" onClick={onDone}>
          {t('mcp.reveal.done')}
        </Button>
      </div>
    </div>
  );
};

KeyReveal.displayName = KEY_REVEAL_NAME;
