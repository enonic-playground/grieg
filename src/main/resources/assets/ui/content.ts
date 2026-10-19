import type { FormField, JsonObject, Occurrences } from './shapes';

export type TypeFamily = 'folder' | 'page' | 'image' | 'media' | 'other';

// App content types render as pages in a site; `base:*` types other than folders do not.
export function typeFamily(type: string): TypeFamily {
  if (type === 'base:folder' || type === 'portal:template-folder') return 'folder';
  if (type === 'media:image' || type === 'media:vector') return 'image';
  if (type.startsWith('media:')) return 'media';
  if (type.startsWith('base:')) return 'other';
  return 'page';
}

export type Crumb = { name: string; path: string };

// Root first; the item itself is not one.
export function ancestors(path: string): Crumb[] {
  const names = path.split('/').filter((name) => name !== '');
  return names.slice(0, -1).map((name, index) => ({
    name,
    path: `/${names.slice(0, index + 1).join('/')}`,
  }));
}

export type Tone = 'success' | 'muted' | 'danger' | 'info';

const WORKFLOW_STATES: Record<string, { label: string; tone: Tone }> = {
  READY: { label: 'Ready', tone: 'success' },
  IN_PROGRESS: { label: 'In progress', tone: 'muted' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

export function workflowState(state: string | null): { label: string; tone: Tone } | undefined {
  if (state == null || state === '') return undefined;
  const known = WORKFLOW_STATES[state];
  if (known != null) return known;
  const words = state.toLowerCase().replaceAll('_', ' ');
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: 'muted' };
}

// `max` 0 is unlimited, as in XP.
export function occurrencesLabel({ min, max }: Occurrences): string {
  if (max === 0) return min === 0 ? 'Any number' : `At least ${min}`;
  if (min === max) return min === 1 ? 'Required' : `Exactly ${min}`;
  if (min === 0) return max === 1 ? 'Optional' : `Up to ${max}`;
  return `${min} to ${max}`;
}

export function selectionLabel({ min, max }: Occurrences): string {
  if (max === 0) return `Pick at least ${min}`;
  if (min === max) return `Pick ${min}`;
  if (min === 0) return `Pick up to ${max}`;
  return `Pick ${min} to ${max}`;
}

export type Choice = { value: string; label: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function choiceOf(item: unknown): Choice[] {
  if (!isObject(item) || item.value == null) return [];
  const label = String(item.value);
  return [{ value: item['@value'] == null ? label : String(item['@value']), label }];
}

// lib-content serializes `<option value="v">Label</option>` as `{ '@value': 'v', value: 'Label' }`
// under the input's `config.option`.
export function choicesOf(config: JsonObject | undefined): Choice[] {
  const list = isObject(config?.config) ? config.config.option : undefined;
  const items = Array.isArray(list) ? list : list == null ? [] : [list];
  return items.flatMap(choiceOf);
}

const KIND_LABELS: Record<FormField['kind'], string> = {
  input: 'Input',
  itemSet: 'Item set',
  optionSet: 'Option set',
  option: 'Option',
};

export function fieldKind(field: FormField): string {
  return field.kind === 'input' ? (field.inputType ?? 'Input') : KIND_LABELS[field.kind];
}

export function fieldDepth(field: FormField): number {
  return field.path.split('.').length - 1;
}
