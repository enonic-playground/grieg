import type { CheckedItem } from '../../lib/content-shape';
import type { Choice } from './content';
import type { ContentType, Draft, FormField, JsonObject, Occurrences } from './shapes';

import { checkOccurrences } from '../../lib/content-shape';
import { choicesOf } from './content';

// The form a draft opens in: which fields the card can edit, the values it edits, and the
// content_create arguments they turn back into. The occurrence rules are content_create's own.

export type InputKind =
  | 'text'
  | 'textarea'
  | 'html'
  | 'long'
  | 'double'
  | 'checkbox'
  | 'select'
  | 'radio'
  | 'date'
  | 'datetime'
  | 'time';

const INPUT_KINDS: Record<string, InputKind> = {
  TextLine: 'text',
  Tag: 'text',
  TextArea: 'textarea',
  HtmlArea: 'html',
  Long: 'long',
  Double: 'double',
  CheckBox: 'checkbox',
  ComboBox: 'select',
  RadioButton: 'radio',
  Date: 'date',
  DateTime: 'datetime',
  Time: 'time',
};

type FieldBase = {
  name: string;
  label: string;
  helpText?: string;
  occurrences: Occurrences;
};

export type InputNode = FieldBase & {
  type: 'input';
  input: InputKind;
  choices: Choice[];
  placeholder?: string;
};

export type SetNode = FieldBase & { type: 'itemSet'; fields: FormNode[] };

// Shown with its value, not edited: the value goes to content_create as Claude proposed it.
export type ReadOnlyNode = FieldBase & { type: 'readOnly'; kind: string };

export type FormNode = InputNode | SetNode | ReadOnlyNode;

export type Entry = string | boolean;

export type Values = JsonObject;

const ANY: Occurrences = { min: 0, max: 0 };
const ZONED_PLACEHOLDER = '2026-01-31T09:30:00Z';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function parentOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(0, dot);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}

function childrenOf(fields: FormField[], parent: string): FormField[] {
  return fields.filter((field) => field.kind !== 'option' && parentOf(field.path) === parent);
}

// lib-content serializes a config flag as `{ value: 'true' }`, or a list of them.
function configFlag(field: FormField, key: string): boolean {
  const config = isObject(field.config?.config) ? field.config.config : undefined;
  const raw = config?.[key];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return isObject(first) && String(first.value) === 'true';
}

function readOnlyKind(field: FormField): string {
  if (field.kind === 'optionSet') return 'Option set';
  if (field.kind === 'itemSet') return 'Item set';
  return field.inputType ?? 'Input';
}

function nodeOf(field: FormField, fields: FormField[], depth: number): FormNode {
  const base: FieldBase = {
    name: nameOf(field.path),
    label: field.label,
    occurrences: field.occurrences ?? ANY,
    ...(field.helpText != null && { helpText: field.helpText }),
  };
  const input = field.kind === 'input' ? INPUT_KINDS[field.inputType ?? ''] : undefined;
  if (input != null) {
    const zoned = input === 'datetime' && configFlag(field, 'timezone');
    return {
      ...base,
      type: 'input',
      input: zoned ? 'text' : input,
      choices: choicesOf(field.config),
      ...(zoned && { placeholder: ZONED_PLACEHOLDER }),
    };
  }
  if (field.kind === 'itemSet' && depth === 0 && field.capped !== true) {
    return {
      ...base,
      type: 'itemSet',
      fields: childrenOf(fields, field.path).map((child) => nodeOf(child, fields, depth + 1)),
    };
  }
  return { ...base, type: 'readOnly', kind: readOnlyKind(field) };
}

// One level of item sets is edited; deeper sets, option sets and other input types are not.
export function formNodes(fields: FormField[]): FormNode[] {
  return childrenOf(fields, '').map((field) => nodeOf(field, fields, 0));
}

function range({ min, max }: Occurrences): { minimum: number; maximum: number } {
  return { minimum: min, maximum: max };
}

// Rebuilds the nesting the flat form carries in its paths, for checkOccurrences.
export function checkedItems(fields: FormField[], parent = ''): CheckedItem[] {
  return childrenOf(fields, parent).map((field): CheckedItem => {
    const name = nameOf(field.path);
    const occurrences = range(field.occurrences ?? ANY);
    if (field.kind === 'input') return { formItemType: 'Input', name, occurrences };
    if (field.kind === 'itemSet') {
      return {
        formItemType: 'ItemSet',
        name,
        occurrences,
        items: checkedItems(fields, field.path),
      };
    }
    return {
      formItemType: 'OptionSet',
      name,
      occurrences,
      selection: range(field.selection ?? ANY),
      options: fields
        .filter((option) => option.kind === 'option' && parentOf(option.path) === field.path)
        .map((option) => ({
          name: nameOf(option.path),
          items: checkedItems(fields, option.path),
        })),
    };
  });
}

//
// * Values
//

export function listOf(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((item) => item != null) : [value];
}

function entryOf(input: InputKind, value: unknown): Entry {
  if (input === 'checkbox') return value === true || value === 'true';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// Inputs and item sets hold lists while edited; everything else keeps Claude's value.
export function initialValues(nodes: FormNode[], data: JsonObject): Values {
  const values: Values = { ...data };
  for (const node of nodes) {
    if (node.type === 'input') {
      const list = listOf(data[node.name]).map((value) => entryOf(node.input, value));
      // An unchecked box is a value, not a missing one.
      values[node.name] = list.length === 0 && node.input === 'checkbox' ? [false] : list;
    } else if (node.type === 'itemSet') {
      values[node.name] = listOf(data[node.name]).map((set) =>
        initialValues(node.fields, isObject(set) ? set : {}),
      );
    }
  }
  return values;
}

// Draft keys no field shows; they still go to content_create, so the form lists them.
export function extraKeys(nodes: FormNode[], values: Values): string[] {
  const names = new Set(nodes.map((node) => node.name));
  return Object.keys(values).filter((key) => !names.has(key));
}

export function emptyEntry(node: InputNode): Entry {
  return node.input === 'checkbox' ? false : '';
}

export function entries(values: Values, name: string): Entry[] {
  const list = values[name];
  return Array.isArray(list) ? (list as Entry[]) : [];
}

export function sets(values: Values, name: string): Values[] {
  const list = values[name];
  return Array.isArray(list) ? (list as Values[]) : [];
}

const WHOLE_NUMBER = /^-?\d+$/;
// Decimal only: `Number()` also reads hex, binary and `Infinity`.
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

type Converted = { value?: unknown; problem?: string };

function convert(input: InputKind, entry: Entry): Converted {
  if (typeof entry === 'boolean') return { value: entry };
  const text = input === 'html' || input === 'textarea' ? entry : entry.trim();
  if (text === '') return {};
  if (input === 'long') {
    return WHOLE_NUMBER.test(text) && Number.isSafeInteger(Number(text))
      ? { value: Number(text) }
      : { problem: `“${text}” is not a whole number.` };
  }
  if (input === 'double') {
    const number = Number(text);
    return DECIMAL.test(text) && Number.isFinite(number)
      ? { value: number }
      : { problem: `“${text}” is not a number.` };
  }
  return { value: text };
}

// XP keeps one value as a scalar and several as an array; an empty input is no value.
function collapse(target: JsonObject, name: string, list: unknown[]): void {
  if (list.length === 0) delete target[name];
  else target[name] = list.length === 1 ? list[0] : list;
}

export type Built = { data: JsonObject; problems: Problems };

function addProblem(problems: Problems, key: string, message: string): void {
  (problems[key] ??= []).push(message);
}

function build(nodes: FormNode[], values: Values, prefix: string, problems: Problems) {
  const data: JsonObject = { ...values };
  for (const node of nodes) {
    const key = `${prefix}${node.name}`;
    if (node.type === 'input') {
      const converted = entries(values, node.name).map((entry) => convert(node.input, entry));
      for (const { problem } of converted) if (problem != null) addProblem(problems, key, problem);
      collapse(
        data,
        node.name,
        converted.flatMap(({ value }) => (value === undefined ? [] : [value])),
      );
    } else if (node.type === 'itemSet') {
      const list = sets(values, node.name);
      collapse(
        data,
        node.name,
        list.map((set, i) =>
          build(node.fields, set, `${key}.${list.length > 1 ? `${i}.` : ''}`, problems),
        ),
      );
    }
  }
  return data;
}

// Value problems are keyed like checkOccurrences paths, without `data.`: `title`, `author.name`,
// or `author.1.name` when the set has several occurrences.
export function buildData(nodes: FormNode[], values: Values): Built {
  const problems: Problems = {};
  const data = build(nodes, values, '', problems);
  return { data, problems };
}

//
// * Problems
//

export type Problems = Record<string, string[]>;

const PATH_PROBLEM = /`data\.([^`]+)`\s+([^`]*?\.)(?=\s|$)/g;
// XP's own refusal, passed through by content_create: `Invalid value in [data.a[1].b]: reason.`
const XP_PROBLEM = /\[data\.((?:[^[\]\s]|\[\d+\])+)\]:?\s*([^.]*)/g;

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Reads the `data.<path>` problems out of a checkOccurrences list or a content_create refusal.
// An option set's `._selected` belongs to the set.
export function problemsOf(text: string): Problems {
  const problems: Problems = {};
  for (const [, path, message] of text.matchAll(PATH_PROBLEM)) {
    addProblem(problems, path.replace(/\._selected$/, ''), sentence(message));
  }
  for (const [, path, reason] of text.matchAll(XP_PROBLEM)) {
    const key = path.replaceAll(/\[(\d+)\]/g, '.$1');
    addProblem(
      problems,
      key,
      reason.trim() === '' ? 'Invalid value.' : `Invalid value: ${reason.trim()}.`,
    );
  }
  return problems;
}

export function occurrenceProblems(fields: FormField[], data: JsonObject): Problems {
  return problemsOf(checkOccurrences(checkedItems(fields), data).join(' '));
}

// Every key a rendered field shows problems under, so the rest can be listed at the top.
export function problemKeys(nodes: FormNode[], values: Values, prefix = ''): string[] {
  return [
    ...nodes.flatMap((node) => {
      const key = `${prefix}${node.name}`;
      if (node.type !== 'itemSet') return [key];
      const list = sets(values, node.name);
      return [
        key,
        ...list.flatMap((set, i) =>
          problemKeys(node.fields, set, `${key}.${list.length > 1 ? `${i}.` : ''}`),
        ),
      ];
    }),
    ...extraKeys(nodes, values).map((key) => `${prefix}${key}`),
  ];
}

//
// * Create Request
//

export type CreateArguments = {
  project?: string;
  parentPath: string;
  contentType: string;
  displayName: string;
  data: JsonObject;
};

export type Header = Pick<Draft, 'parentPath' | 'displayName'>;

export function createArguments(
  type: ContentType,
  header: Header,
  data: JsonObject,
  project?: string,
): CreateArguments {
  return {
    ...(project != null && { project }),
    parentPath: header.parentPath.trim(),
    contentType: type.name,
    displayName: header.displayName.trim(),
    data,
  };
}

export function headerProblems(header: Header): Problems {
  const problems: Problems = {};
  if (header.displayName.trim() === '') addProblem(problems, 'displayName', 'Required.');
  if (!header.parentPath.trim().startsWith('/')) {
    addProblem(problems, 'parentPath', 'Starts with /, e.g. /my-site/articles.');
  }
  return problems;
}

function json(args: CreateArguments): string {
  return `\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
}

export function contextText(type: ContentType, args: CreateArguments): string {
  return `The user reviewed a new ${type.displayName} in the form card and asked to create it with these content_create arguments:\n${json(args)}`;
}

// Inlines the arguments when the host would not take them as model context.
export function createMessage(type: ContentType, args: CreateArguments, shared: boolean): string {
  const where = args.project == null ? '' : ` in project ${args.project}`;
  const ask = `Create the ${type.displayName} "${args.displayName}" under ${args.parentPath}${where} with content_create, using exactly the arguments I reviewed in the form`;
  return shared ? `${ask}; they are in your context.` : `${ask}:\n${json(args)}`;
}
