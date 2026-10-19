import { Plus, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { Entry, FormNode, Header, InputNode, Problems, SetNode, Values } from '../form';
import type { ContentType, Draft } from '../shapes';
import type { ReactElement, ReactNode } from 'react';

import { Button } from '../../js/components/ui/button';
import { inputClasses } from '../../js/components/ui/input';
import { cn } from '../../js/lib/utils';
import { useCard } from '../card-context';
import { Mono, Pill, Tag } from '../components';
import { occurrencesLabel } from '../content';
import {
  buildData,
  contextText,
  createArguments,
  createMessage,
  emptyEntry,
  entries,
  extraKeys,
  formNodes,
  headerProblems,
  initialValues,
  occurrenceProblems,
  problemKeys,
  problemsOf,
  sets,
} from '../form';
import { Tree } from '../tree';

function merge(...lists: Problems[]): Problems {
  const merged: Problems = {};
  for (const list of lists) {
    for (const [key, messages] of Object.entries(list)) {
      merged[key] = [...new Set([...(merged[key] ?? []), ...messages])];
    }
  }
  return merged;
}

function count(problems: Problems): number {
  return Object.values(problems).reduce((total, messages) => total + messages.length, 0);
}

const ProblemList = ({ messages, id }: { messages?: string[]; id?: string }) =>
  messages == null || messages.length === 0 ? null : (
    <ul id={id} className="text-danger mt-1 text-xs">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );

type FieldContext = { problems: Problems; idPrefix: string };

type FieldProps = {
  node: FormNode;
  values: Values;
  onChange: (next: Values) => void;
  prefix: string;
  context: FieldContext;
};

const FieldLabel = ({
  node,
  htmlFor,
  children,
}: {
  node: FormNode;
  htmlFor?: string;
  children?: ReactNode;
}): ReactElement => (
  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
    {htmlFor == null ? (
      <span className="font-medium">{node.label}</span>
    ) : (
      <label htmlFor={htmlFor} className="font-medium">
        {node.label}
      </label>
    )}
    <span className="text-muted-foreground text-xs">{occurrencesLabel(node.occurrences)}</span>
    {children}
  </div>
);

const Help = ({ text }: { text?: string }) =>
  text == null ? null : <p className="text-muted-foreground mt-0.5 text-xs">{text}</p>;

type ControlProps = {
  node: InputNode;
  id: string;
  entry: Entry;
  label: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (entry: Entry) => void;
};

const NATIVE_TYPES: Partial<Record<InputNode['input'], string>> = {
  date: 'date',
  datetime: 'datetime-local',
  time: 'time',
};

const Control = ({
  node,
  id,
  entry,
  label,
  invalid,
  describedBy,
  onChange,
}: ControlProps): ReactElement => {
  const common = {
    id,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
  };
  if (node.input === 'checkbox') {
    return (
      <input
        {...common}
        type="checkbox"
        aria-label={label}
        className="accent-primary size-4"
        checked={entry === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }
  const text = typeof entry === 'string' ? entry : '';
  const unknown = text !== '' && !node.choices.some((choice) => choice.value === text);
  if (node.input === 'select') {
    return (
      <select
        {...common}
        aria-label={label}
        className={inputClasses}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {node.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
        {unknown && <option value={text}>{text} (not an option)</option>}
      </select>
    );
  }
  if (node.input === 'radio') {
    const choices = unknown
      ? [...node.choices, { value: text, label: `${text} (not an option)` }]
      : node.choices;
    return (
      <div
        {...common}
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-x-4 gap-y-1 py-1 text-xs"
      >
        {choices.map((choice) => (
          <label key={choice.value} className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name={id}
              className="accent-primary"
              checked={text === choice.value}
              onChange={() => onChange(choice.value)}
            />
            {choice.label}
          </label>
        ))}
      </div>
    );
  }
  if (node.input === 'textarea' || node.input === 'html') {
    return (
      <textarea
        {...common}
        aria-label={label}
        className={cn(inputClasses, 'min-h-16 resize-y', node.input === 'html' && 'font-mono')}
        rows={node.input === 'html' ? 5 : 3}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      {...common}
      aria-label={label}
      type={NATIVE_TYPES[node.input] ?? 'text'}
      inputMode={
        node.input === 'long' ? 'numeric' : node.input === 'double' ? 'decimal' : undefined
      }
      placeholder={node.placeholder}
      className={inputClasses}
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};

function canAdd(node: FormNode, length: number): boolean {
  return (
    node.occurrences.max !== 1 && (node.occurrences.max === 0 || length < node.occurrences.max)
  );
}

const InputField = ({
  node,
  values,
  onChange,
  prefix,
  context,
}: FieldProps & { node: InputNode }) => {
  const key = `${prefix}${node.name}`;
  const id = `${context.idPrefix}-${key}`;
  const problems = context.problems[key];
  const list = entries(values, node.name);
  const single = node.occurrences.max === 1;
  // A single or required input shows an empty control rather than only an Add button.
  const shown =
    list.length === 0 && (single || node.occurrences.min > 0) ? [emptyEntry(node)] : list;
  const set = (next: Entry[]) => onChange({ ...values, [node.name]: next });

  return (
    <div>
      <FieldLabel
        node={node}
        htmlFor={shown.length > 0 && node.input !== 'radio' ? `${id}-0` : undefined}
      >
        {node.input === 'html' && <Tag>HTML source</Tag>}
      </FieldLabel>
      <Help text={node.helpText} />
      <div className="mt-1 flex flex-col gap-1">
        {shown.map((entry, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <Control
                node={node}
                id={`${id}-${i}`}
                entry={entry}
                label={shown.length > 1 ? `${node.label} ${i + 1}` : node.label}
                invalid={problems != null}
                describedBy={problems == null ? undefined : `${id}-problems`}
                onChange={(next) => set(shown.with(i, next))}
              />
            </div>
            {(!single || shown.length > 1) && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Remove ${node.label} ${i + 1}`}
                title="Remove"
                onClick={() => set(shown.toSpliced(i, 1))}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
      </div>
      {canAdd(node, shown.length) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1 -ml-2"
          onClick={() => set([...shown, emptyEntry(node)])}
        >
          <Plus />
          Add {node.label.toLowerCase()}
        </Button>
      )}
      <ProblemList id={`${id}-problems`} messages={problems} />
    </div>
  );
};

const SetField = ({ node, values, onChange, prefix, context }: FieldProps & { node: SetNode }) => {
  const key = `${prefix}${node.name}`;
  const list = sets(values, node.name);
  const set = (next: Values[]) => onChange({ ...values, [node.name]: next });

  return (
    <div>
      <FieldLabel node={node}>
        <Tag>Item set</Tag>
      </FieldLabel>
      <Help text={node.helpText} />
      {list.map((item, i) => {
        const itemPrefix = `${key}.${list.length > 1 ? `${i}.` : ''}`;
        return (
          <fieldset key={i} className="mt-2 flex flex-col gap-2.5 rounded-md border px-3 pt-1 pb-3">
            <legend className="flex items-center gap-1 px-1 text-xs font-medium">
              {node.label} {i + 1}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`Remove ${node.label} ${i + 1}`}
                title="Remove"
                onClick={() => set(list.toSpliced(i, 1))}
              >
                <X />
              </Button>
            </legend>
            {node.fields.map((child) => (
              <Field
                key={child.name}
                node={child}
                values={item}
                onChange={(next) => set(list.with(i, next))}
                prefix={itemPrefix}
                context={context}
              />
            ))}
            {extraKeys(node.fields, item).map((name) => (
              <ExtraField
                key={name}
                name={name}
                value={item[name]}
                problems={context.problems[`${itemPrefix}${name}`]}
              />
            ))}
          </fieldset>
        );
      })}
      {(canAdd(node, list.length) || (node.occurrences.max === 1 && list.length === 0)) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1 -ml-2"
          onClick={() => set([...list, initialValues(node.fields, {})])}
        >
          <Plus />
          Add {node.label.toLowerCase()}
        </Button>
      )}
      <ProblemList messages={context.problems[key]} />
    </div>
  );
};

const ReadOnlyField = ({ node, values, prefix, context }: FieldProps) => {
  const value = values[node.name];
  return (
    <div>
      <FieldLabel node={node}>
        <Tag>{node.type === 'readOnly' ? node.kind : node.type}</Tag>
      </FieldLabel>
      <Help text={node.helpText} />
      <div className="mt-1">
        {value == null ? (
          <p className="text-dimmed text-xs italic">Empty</p>
        ) : (
          <Tree value={value} />
        )}
      </div>
      <p className="text-dimmed mt-0.5 text-xs">Edit in Content Studio once it is created.</p>
      <ProblemList messages={context.problems[`${prefix}${node.name}`]} />
    </div>
  );
};

type ExtraFieldProps = { name: string; value: unknown; problems?: string[] };

const ExtraField = ({ name, value, problems }: ExtraFieldProps): ReactElement => (
  <div>
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Mono className="font-medium">{name}</Mono>
      <Pill tone="danger">Not in this content type</Pill>
    </div>
    <div className="mt-1">
      <Tree value={value} />
    </div>
    <ProblemList messages={problems} />
  </div>
);

const Field = (props: FieldProps): ReactElement => {
  const { node } = props;
  if (node.type === 'input') return <InputField {...props} node={node} />;
  if (node.type === 'itemSet') return <SetField {...props} node={node} />;
  return <ReadOnlyField {...props} />;
};

type HeaderFieldProps = {
  id: string;
  label: string;
  value: string;
  problems?: string[];
  mono?: boolean;
  aside?: ReactNode;
  onChange: (value: string) => void;
};

const HeaderField = ({ id, label, value, problems, mono, aside, onChange }: HeaderFieldProps) => {
  const described = [aside != null && `${id}-aside`, problems != null && `${id}-problems`]
    .filter(Boolean)
    .join(' ');
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {aside != null && (
          <span id={`${id}-aside`} className="text-muted-foreground text-xs">
            {aside}
          </span>
        )}
      </div>
      <input
        id={id}
        className={cn(inputClasses, 'mt-1', mono && 'font-mono')}
        value={value}
        aria-invalid={problems != null || undefined}
        aria-describedby={described === '' ? undefined : described}
        onChange={(event) => onChange(event.target.value)}
      />
      <ProblemList id={`${id}-problems`} messages={problems} />
    </div>
  );
};

const HEADER_KEYS = ['displayName', 'parentPath'];

type ContentFormProps = { type: ContentType; draft: Draft };

export const ContentFormView = ({ type, draft }: ContentFormProps): ReactElement => {
  const { host, ask } = useCard();
  const idPrefix = useId();
  const nodes = useMemo(() => formNodes(type.form), [type.form]);
  const [values, setValues] = useState(() => initialValues(nodes, draft.data));
  const [header, setHeader] = useState<Header>({
    parentPath: draft.parentPath,
    displayName: draft.displayName,
  });
  const [edited, setEdited] = useState(false);
  const [sent, setSent] = useState<string>();
  const [sending, setSending] = useState(false);

  const { data, problems: valueProblems } = buildData(nodes, values);
  const args = createArguments(type, header, data, draft.project);
  const live = merge(headerProblems(header), valueProblems, occurrenceProblems(type.form, data));
  // The refusal speaks about the draft as it was sent; once the user edits, the live check
  // takes over.
  const refusal = draft.error == null || edited ? {} : problemsOf(draft.error);
  const problems = merge(live, refusal);
  const shownKeys = new Set([...HEADER_KEYS, ...problemKeys(nodes, values)]);
  const unplaced = Object.entries(problems).filter(([key]) => !shownKeys.has(key));
  const blocking = count(live);
  const current = JSON.stringify(args);
  const context: FieldContext = { problems, idPrefix };

  const change = (next: Values) => {
    setValues(next);
    setEdited(true);
  };
  const changeHeader = (next: Partial<Header>) => {
    setHeader((previous) => ({ ...previous, ...next }));
    setEdited(true);
  };

  const submit = async () => {
    if (blocking > 0 || sending) return;
    setSending(true);
    try {
      const shared = await host.share(contextText(type, args), { content_create: args });
      const delivered = await ask(
        createMessage(type, args, shared),
        `create the ${type.displayName} "${args.displayName}" with the values in the form`,
      );
      if (delivered) setSent(current);
    } finally {
      setSending(false);
    }
  };

  return (
    // No <form>: hosts sandbox the card without `allow-forms`, which suppresses submit events.
    <div className="pb-3">
      <div className="flex flex-col gap-2.5 px-4 pt-3 pb-3">
        <HeaderField
          id={`${idPrefix}-displayName`}
          label="Display name"
          value={header.displayName}
          problems={problems.displayName}
          onChange={(displayName) => changeHeader({ displayName })}
        />
        <HeaderField
          id={`${idPrefix}-parentPath`}
          label="Location"
          value={header.parentPath}
          problems={problems.parentPath}
          mono
          aside={
            draft.project == null ? undefined : (
              <>
                in project <Mono>{draft.project}</Mono>
              </>
            )
          }
          onChange={(parentPath) => changeHeader({ parentPath })}
        />
      </div>
      {draft.error != null && (
        <div
          role="alert"
          className="bg-danger-subtle text-danger mx-4 mb-3 rounded-md px-3 py-2 text-xs"
        >
          <p className="font-medium">content_create refused the last attempt</p>
          <p className="mt-0.5 break-words whitespace-pre-wrap">{draft.error}</p>
        </div>
      )}
      {unplaced.length > 0 && (
        <ul className="text-danger mx-4 mb-3 text-xs">
          {unplaced.flatMap(([key, messages]) =>
            messages.map((message) => (
              <li key={`${key}:${message}`}>
                <Mono>{key}</Mono> {message}
              </li>
            )),
          )}
        </ul>
      )}
      <ul className="border-t">
        {nodes.map((node) => (
          <li key={node.name} className="border-b px-4 py-2.5">
            <Field node={node} values={values} onChange={change} prefix="" context={context} />
          </li>
        ))}
        {extraKeys(nodes, values).map((name) => (
          <li key={name} className="border-b px-4 py-2.5">
            <ExtraField name={name} value={values[name]} problems={problems[name]} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-4 pt-3">
        <p className="text-muted-foreground mr-auto text-xs" aria-live="polite">
          {blocking > 0
            ? `Fix ${blocking === 1 ? '1 problem' : `${blocking} problems`} to create it.`
            : sent === current
              ? 'Sent to Claude. Approve content_create to create it on draft.'
              : 'Claude creates it on draft, after you approve the tool call.'}
        </p>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={blocking > 0 || sending || sent === current}
          onClick={() => void submit()}
        >
          {sent === current ? 'Sent' : 'Create'}
        </Button>
      </div>
    </div>
  );
};
