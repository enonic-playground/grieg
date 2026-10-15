import { useMemo, useState } from 'react';

import type { WorkflowStep } from '../../lib/api/workflows';

export type DraftStep = {
  // Stable React key: the step id is editable, so it cannot be the key.
  key: number;
  id: string;
  prompt: string;
  model: string;
};

export type StepsDraft = {
  steps: DraftStep[];
  dirty: boolean;
  add: () => void;
  remove: (index: number) => void;
  move: (index: number, offset: -1 | 1) => void;
  change: (index: number, field: 'id' | 'prompt' | 'model', value: string) => void;
  reset: () => void;
};

let nextKey = 0;

function toDraft(steps: WorkflowStep[]): DraftStep[] {
  return steps.map((step) => ({
    key: nextKey++,
    id: step.id,
    prompt: step.config?.prompt ?? '',
    model: step.config?.model ?? '',
  }));
}

export function toSteps(draft: DraftStep[]): WorkflowStep[] {
  return draft.map(({ id, prompt, model }) => ({
    id,
    type: 'llm',
    config: model.trim() === '' ? { prompt } : { prompt, model: model.trim() },
  }));
}

// Keeps what the draft cannot express, a legacy type or a missing prompt, so such steps read as
// unsaved and a save rewrites them instead of a run failing on them.
function normalize(saved: WorkflowStep[]): unknown[] {
  return saved.map(({ id, type, config }) => ({
    id,
    type,
    config:
      config?.model == null
        ? { prompt: config?.prompt }
        : { prompt: config.prompt, model: config.model },
  }));
}

function newStepId(steps: DraftStep[]): string {
  const taken = new Set(steps.map((step) => step.id));
  let n = steps.length + 1;
  while (taken.has(`step${n}`)) n += 1;
  return `step${n}`;
}

// A refetch replaces the draft only while it is untouched; it never overwrites edits.
export function useStepsDraft(saved: WorkflowStep[]): StepsDraft {
  const [steps, setSteps] = useState(() => toDraft(saved));
  const [seed, setSeed] = useState(saved);
  const baseline = useMemo(() => JSON.stringify(normalize(saved)), [saved]);

  if (seed !== saved) {
    setSeed(saved);
    if (JSON.stringify(toSteps(steps)) === JSON.stringify(normalize(seed)))
      setSteps(toDraft(saved));
  }

  return {
    steps,
    dirty: JSON.stringify(toSteps(steps)) !== baseline,
    add: () => {
      const key = nextKey++;
      setSteps((current) => [...current, { key, id: newStepId(current), prompt: '', model: '' }]);
    },
    remove: (index) => setSteps((current) => current.filter((_, i) => i !== index)),
    move: (index, offset) =>
      setSteps((current) => {
        const target = index + offset;
        if (target < 0 || target >= current.length) return current;
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      }),
    change: (index, field, value) =>
      setSteps((current) =>
        current.map((step, i) => (i === index ? { ...step, [field]: value } : step)),
      ),
    reset: () => setSteps(toDraft(saved)),
  };
}
