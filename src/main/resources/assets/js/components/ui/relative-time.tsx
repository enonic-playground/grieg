import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { dateTime, relativeTime } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { cn } from '../../lib/utils';

export type RelativeTimeProps = {
  iso: string;
  className?: string;
};

const RELATIVE_TIME_NAME = 'RelativeTime';

export const RelativeTime = ({ iso, className }: RelativeTimeProps): ReactElement => {
  const { i18n } = useTranslation();
  const now = useNow();

  return (
    <time
      data-component={RELATIVE_TIME_NAME}
      dateTime={iso}
      title={dateTime(iso, i18n.language)}
      className={cn('whitespace-nowrap', className)}
    >
      {relativeTime(iso, i18n.language, now)}
    </time>
  );
};

RelativeTime.displayName = RELATIVE_TIME_NAME;
