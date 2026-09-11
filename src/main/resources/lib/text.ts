const DEFAULT_SEPARATOR = ', ';

export function joinValues(values: string[], separator = DEFAULT_SEPARATOR): string {
  return values
    .filter((v) => v.length > 0)
    .map((v) => v.trim())
    .join(separator);
}

export function toTag(name: string, value: string): string {
  return `${name}: ${value}`;
}
