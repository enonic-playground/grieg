import type { JsonObject } from './shapes';
import type { ReactElement } from 'react';

import { Mono, Tag } from './components';

// Nested objects below this depth start collapsed.
const OPEN_DEPTH = 2;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function isTruncation(value: unknown): value is { truncated: true; message: string } {
  return isObject(value) && value.truncated === true && typeof value.message === 'string';
}

const Scalar = ({ value }: { value: unknown }): ReactElement => {
  if (value == null) return <span className="text-dimmed">null</span>;
  if (typeof value === 'string')
    return <span className="break-words whitespace-pre-wrap">{value}</span>;
  return <Mono className="text-info">{String(value)}</Mono>;
};

function isScalarList(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => !isObject(item) && !Array.isArray(item))
  );
}

export const Tree = ({ value, depth = 0 }: { value: unknown; depth?: number }): ReactElement => {
  if (isTruncation(value)) return <p className="text-dimmed text-xs italic">{value.message}</p>;
  if (isScalarList(value)) {
    return (
      <span className="flex flex-wrap gap-1 py-0.5">
        {value.map((item, index) => (
          <Tag key={index}>{String(item)}</Tag>
        ))}
      </span>
    );
  }
  if (!isObject(value) && !Array.isArray(value)) return <Scalar value={value} />;

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  if (entries.length === 0) {
    return <span className="text-dimmed">{Array.isArray(value) ? '[]' : '{}'}</span>;
  }
  return (
    <dl className="grid grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {entries.map(([key, item]) => {
        const nested =
          (isObject(item) || Array.isArray(item)) && !isTruncation(item) && !isScalarList(item);
        return nested ? (
          <details key={key} open={depth < OPEN_DEPTH} className="col-span-2">
            <summary className="text-muted-foreground cursor-pointer font-mono text-xs">
              {key}
              <span className="text-dimmed ml-1.5">
                {Array.isArray(item) ? `[${item.length}]` : `{${Object.keys(item).length}}`}
              </span>
            </summary>
            <div className="border-l py-1 pl-3">
              <Tree value={item} depth={depth + 1} />
            </div>
          </details>
        ) : (
          <div key={key} className="contents">
            <dt className="text-muted-foreground truncate font-mono text-xs leading-5">{key}</dt>
            <dd className="min-w-0 text-xs leading-5">
              <Tree value={item} depth={depth + 1} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
};
