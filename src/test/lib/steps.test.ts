import { describe, expect, it } from 'vitest';

import { MAX_OUTPUT, capOutput, renderPrompt, validateSteps } from '../../main/resources/lib/steps';

function llm(id: string, prompt: string, model?: string): unknown {
  return { id, type: 'llm', config: { prompt, model } };
}

describe('validateSteps', () => {
  it('should accept steps that reference only earlier steps', () => {
    const steps = [llm('a', 'Write'), llm('b', 'Shorten {{steps.a.output}}', 'gemini-3.1-pro')];
    expect(validateSteps(steps)).toBeUndefined();
    expect(validateSteps([])).toBeUndefined();
    expect(validateSteps([llm('a'.repeat(64), 'x')])).toBeUndefined();
  });

  it.each([
    ['a non-array', { id: 'a' }, -1, '`steps` must be an array'],
    [
      'a step type other than llm',
      [{ id: 'a', type: 'http', config: { prompt: 'x' } }],
      0,
      'Step `type` must be `llm`',
    ],
    ['a missing prompt', [{ id: 'a', type: 'llm' }], 0, 'Step needs a non-empty `config.prompt`'],
    ['a blank prompt', [llm('a', '  ')], 0, 'Step needs a non-empty `config.prompt`'],
    ['an empty id', [llm('', 'x')], 0, 'Step `id` must be 1-64 letters, digits, `_` or `-`'],
    [
      'a 65-character id',
      [llm('a'.repeat(65), 'x')],
      0,
      'Step `id` must be 1-64 letters, digits, `_` or `-`',
    ],
    [
      'a non-string model',
      [{ id: 'a', type: 'llm', config: { prompt: 'x', model: 5 } }],
      0,
      'Step `config.model` is not a valid model name',
    ],
    ['a repeated id', [llm('a', 'x'), llm('a', 'y')], 1, 'Step id `a` is used twice'],
    [
      'an id with a dot',
      [llm('a.b', 'x')],
      0,
      'Step `id` must be 1-64 letters, digits, `_` or `-`',
    ],
    [
      'a model with a slash',
      [llm('a', 'x', '../m')],
      0,
      'Step `config.model` is not a valid model name',
    ],
    [
      'a reference to a later step',
      [llm('a', '{{steps.b.output}}'), llm('b', 'x')],
      0,
      'Prompt references `b`, which is not an earlier step',
    ],
    [
      'a self reference',
      [llm('a', '{{steps.a.output}}')],
      0,
      'Prompt references `a`, which is not an earlier step',
    ],
    [
      'a reference to an unknown step',
      [llm('a', 'x'), llm('b', '{{steps.zz.output}}')],
      1,
      'Prompt references `zz`, which is not an earlier step',
    ],
  ])('should reject %s', (_name, steps, index, message) => {
    expect(validateSteps(steps)).toMatchObject({ index, message });
  });

  it('should name the failing step by position and id', () => {
    expect(validateSteps([llm('a', 'x'), llm('b', '')])).toEqual({
      index: 1,
      id: 'b',
      message: 'Step needs a non-empty `config.prompt`',
    });
  });
});

describe('renderPrompt', () => {
  it('should replace every reference with the step output verbatim', () => {
    const outputs = new Map([
      ['a', 'one $& $1'],
      ['b', 'two'],
    ]);
    expect(
      renderPrompt('{{steps.a.output}} + {{steps.b.output}} + {{steps.a.output}}', outputs),
    ).toBe('one $& $1 + two + one $& $1');
  });

  it('should leave text that is not a step reference alone', () => {
    expect(renderPrompt('{{name}} {{steps.a}} {{ steps.a.output }}', new Map([['a', 'x']]))).toBe(
      '{{name}} {{steps.a}} {{ steps.a.output }}',
    );
  });

  it('should throw on a reference to a step without output', () => {
    expect(() => renderPrompt('{{steps.b.output}}', new Map([['a', 'x']]))).toThrow(
      'Unknown step reference {{steps.b.output}}',
    );
    expect(() => renderPrompt('{{steps.toString.output}}', new Map())).toThrow(
      'Unknown step reference',
    );
  });
});

describe('capOutput', () => {
  it('should not split a surrogate pair at the cut', () => {
    const text = `${'x'.repeat(MAX_OUTPUT - 13)}😀${'x'.repeat(20)}`;

    expect(capOutput(text)).toBe(`${'x'.repeat(MAX_OUTPUT - 13)}\n[truncated]`);
  });

  it('should keep an output at the cap unchanged', () => {
    const text = 'x'.repeat(MAX_OUTPUT);
    expect(capOutput(text)).toBe(text);
  });

  it('should cut a longer output to the cap and mark it', () => {
    expect(capOutput('x'.repeat(MAX_OUTPUT + 1))).toBe(
      `${'x'.repeat(MAX_OUTPUT - 12)}\n[truncated]`,
    );
  });
});
