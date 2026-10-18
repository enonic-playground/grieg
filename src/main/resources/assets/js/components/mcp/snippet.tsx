import type { ReactElement, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { CopyButton } from '../ui/copy-button';

export type SnippetProps = {
  label: ReactNode;
  text: string;
};

const SNIPPET_NAME = 'Snippet';

export const Snippet = ({ label, text }: SnippetProps): ReactElement => {
  return (
    <div data-component={SNIPPET_NAME} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs select-all">
        {text}
      </pre>
    </div>
  );
};

Snippet.displayName = SNIPPET_NAME;

//
// * CopyFields
//

export type CopyFieldsProps = {
  children: ReactNode;
};

const COPY_FIELDS_NAME = 'CopyFields';

// One grid for every field in it, so values line up whether or not a field has a copy button.
export const CopyFields = ({ children }: CopyFieldsProps): ReactElement => {
  return (
    <div
      data-component={COPY_FIELDS_NAME}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)_auto]"
    >
      {children}
    </div>
  );
};

CopyFields.displayName = COPY_FIELDS_NAME;

//
// * CopyField
//

export type CopyFieldProps = {
  label: string;
  // Absent while there is nothing to copy, such as a key no longer shown: `placeholder` stands in.
  value?: string;
  placeholder?: string;
};

const COPY_FIELD_NAME = 'CopyField';

export const CopyField = ({ label, value, placeholder }: CopyFieldProps): ReactElement => {
  return (
    <div data-component={COPY_FIELD_NAME} className="contents">
      <span className="text-muted-foreground col-span-2 text-xs sm:col-span-1">{label}</span>
      <code
        className={cn(
          'bg-muted truncate rounded-md border px-2.5 py-1.5 font-mono text-xs',
          value == null && 'text-muted-foreground font-sans italic',
        )}
        title={value}
      >
        {value ?? placeholder}
      </code>
      {value != null ? <CopyButton text={value} /> : <span />}
    </div>
  );
};

CopyField.displayName = COPY_FIELD_NAME;
