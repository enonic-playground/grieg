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

// For error text bound for the log: hides MCP keys and the SHA-256 digests their nodes are named by.
export function redactKeys(text: string): string {
  return text.replace(/grieg_[\w-]+/g, 'grieg_…').replace(/\b[\da-f]{64}\b/gi, '<digest>');
}
