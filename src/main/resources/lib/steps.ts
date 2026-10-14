export type LlmStep = {
  id: string;
  type: 'llm';
  config: { prompt: string; model?: string };
};

export type StepError = { index: number; id?: string; message: string };

export const MAX_OUTPUT = 32 * 1024;
const TRUNCATED = '\n[truncated]';

const STEP_ID = /^[\w-]{1,64}$/;
// Model names are a Vertex URL path segment.
const MODEL = /^[\w.:-]+$/;
const PLACEHOLDER = /\{\{steps\.([^.{}]*)\.output\}\}/g;

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function references(prompt: string): string[] {
  return [...prompt.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

// Returns the first problem, naming the step by its position and, where it has one, its id.
export function validateSteps(steps: unknown): StepError | undefined {
  if (!Array.isArray(steps)) return { index: -1, message: '`steps` must be an array' };

  const seen = new Set<string>();
  for (const [index, value] of steps.entries()) {
    const step = objectOf(value);
    const id = typeof step?.id === 'string' ? step.id : undefined;
    const fail = (message: string): StepError => ({ index, id, message });

    if (id == null || !STEP_ID.test(id)) {
      return fail('Step `id` must be 1-64 letters, digits, `_` or `-`');
    }
    if (seen.has(id)) return fail(`Step id \`${id}\` is used twice`);
    if (step?.type !== 'llm') return fail('Step `type` must be `llm`');

    const config = objectOf(step.config);
    if (typeof config?.prompt !== 'string' || config.prompt.trim() === '') {
      return fail('Step needs a non-empty `config.prompt`');
    }
    if (config.model != null && (typeof config.model !== 'string' || !MODEL.test(config.model))) {
      return fail('Step `config.model` is not a valid model name');
    }
    const unknown = references(config.prompt).find((ref) => !seen.has(ref));
    if (unknown != null) {
      return fail(`Prompt references \`${unknown}\`, which is not an earlier step`);
    }
    seen.add(id);
  }
  return undefined;
}

export function renderPrompt(prompt: string, outputs: ReadonlyMap<string, string>): string {
  return prompt.replace(PLACEHOLDER, (placeholder, id: string) => {
    const output = outputs.get(id);
    if (output == null) throw new Error(`Unknown step reference ${placeholder}`);
    return output;
  });
}

// Counts UTF-16 code units, not bytes, and never splits a surrogate pair.
export function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  let end = MAX_OUTPUT - TRUNCATED.length;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end) + TRUNCATED;
}
