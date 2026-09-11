import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';

import { cn } from '../lib/utils';
import { useTheme } from './theme-provider';

export type ThemeToggleProps = {
  className?: string;
};

const THEME_TOGGLE_NAME = 'ThemeToggle';

const THEME_CYCLE = ['light', 'dark', 'system'] as const;

const THEME_ICON_MAP = {
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
  system: <SunMoon className="size-4.5" />,
};

const THEME_LABEL_KEYS = {
  light: 'theme.light',
  dark: 'theme.dark',
  system: 'theme.system',
};

export const ThemeToggle = ({ className }: ThemeToggleProps): ReactElement => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const handleClick = (): void => {
    const currentIndex = THEME_CYCLE.indexOf(theme);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    setTheme(THEME_CYCLE[nextIndex]);
  };

  const icon = THEME_ICON_MAP[theme];
  const label = t(THEME_LABEL_KEYS[theme]);

  const classNames = cn(
    'inline-flex size-8 items-center justify-center rounded-md',
    'text-muted-foreground transition-colors',
    'hover:bg-accent hover:text-accent-foreground',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
    className,
  );

  return (
    <button
      data-component={THEME_TOGGLE_NAME}
      type="button"
      onClick={handleClick}
      className={classNames}
      aria-label={t('theme.toggle.aria', { label })}
      title={t('theme.toggle.aria', { label })}
    >
      {icon}
    </button>
  );
};

ThemeToggle.displayName = THEME_TOGGLE_NAME;
