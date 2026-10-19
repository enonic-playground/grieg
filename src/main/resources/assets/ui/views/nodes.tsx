import { FolderTree } from 'lucide-react';

import type { JsonObject, NodeDetail, ToolResults } from '../shapes';
import type { ReactElement } from 'react';

import { Button } from '../../js/components/ui/button';
import { dateTime, relativeTime } from '../../js/lib/format';
import { useCard } from '../card-context';
import { Dot, Empty, Meta, Mono, Row, SectionLabel, ShowMore, Tag } from '../components';
import { Tree } from '../tree';

const PAGE_SIZE = 20;

type Target = { repo: string; branch?: string };

function targetOf(args: JsonObject): Target | undefined {
  if (typeof args.repo !== 'string') return undefined;
  return { repo: args.repo, ...(typeof args.branch === 'string' && { branch: args.branch }) };
}

// NoQL has no escape for a quote inside a string, so such a path cannot be queried this way.
function childrenQuery(path: string): string | undefined {
  return path.includes("'") ? undefined : `_parentPath = '${path}'`;
}

export const ReposView = ({ data }: { data: ToolResults['node_repos'] }): ReactElement => {
  const { open } = useCard();

  if (data.repos.length === 0) return <Empty>No repositories you can read.</Empty>;
  return (
    <ul>
      {data.repos.map((repo) => (
        <Row key={repo.id}>
          <div className="flex min-w-0 items-center gap-2">
            <Mono className="truncate font-medium">{repo.id}</Mono>
            <Tag>{repo.access}</Tag>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {repo.branches.map((branch) => (
              <Button
                key={branch}
                size="sm"
                variant={branch === repo.defaultBranch ? 'secondary' : 'ghost'}
                className="h-6 px-2 font-mono text-xs"
                aria-label={`Browse ${repo.id} on ${branch}`}
                onClick={() =>
                  open(
                    'node_query',
                    { repo: repo.id, branch, query: childrenQuery('/'), count: PAGE_SIZE },
                    `${repo.id} · ${branch}`,
                  )
                }
              >
                {branch}
              </Button>
            ))}
          </div>
        </Row>
      ))}
    </ul>
  );
};

type QueryViewProps = { data: ToolResults['node_query']; args: JsonObject };

export const NodeQueryView = ({ data, args }: QueryViewProps): ReactElement => {
  const { open, refetch, locale } = useCard();
  const target = targetOf(args);

  const showMore = () =>
    refetch('node_query', { ...args, cursor: data.nextCursor }, (current, page) => ({
      ...page,
      count: current.count + page.count,
      hits: [...current.hits, ...page.hits],
    }));

  if (data.hits.length === 0) return <Empty>No nodes match.</Empty>;
  return (
    <>
      <ul>
        {data.hits.map((hit) => (
          <Row
            key={hit._id}
            label={`Open ${hit._path}`}
            onOpen={
              target == null
                ? undefined
                : () => open('node_get', { ...target, key: hit._id }, hit._name || '/')
            }
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{hit._name || '/'}</span>
              <Tag>{hit._nodeType}</Tag>
            </div>
            <Meta>
              <Mono className="truncate">{hit._path}</Mono>
              <Dot />
              <span title={dateTime(hit._ts, locale)}>{relativeTime(hit._ts, locale)}</span>
            </Meta>
            {hit.fields != null && <FieldsLine fields={hit.fields} />}
          </Row>
        ))}
      </ul>
      {data.nextCursor != null && target != null && (
        <ShowMore left={data.total - data.hits.length} onMore={showMore} />
      )}
    </>
  );
};

function inline(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const FieldsLine = ({ fields }: { fields: JsonObject }): ReactElement => (
  <p className="text-muted-foreground mt-0.5 truncate text-xs">
    {Object.entries(fields).map(([path, value], index) => (
      <span key={path}>
        {index > 0 && ' · '}
        <span className="text-dimmed">{path}</span> {inline(value)}
      </span>
    ))}
  </p>
);

const SUBTREES = [
  ['data', 'Data'],
  ['fields', 'Fields'],
  ['permissions', 'Permissions'],
  ['indexConfig', 'Index config'],
] as const;

type NodeViewProps = { data: NodeDetail; args: JsonObject };

export const NodeView = ({ data, args }: NodeViewProps): ReactElement => {
  const { open, locale } = useCard();
  const target = targetOf(args);
  const query = childrenQuery(data._path);

  return (
    <div className="pb-3">
      <div className="px-4 pt-3">
        <Meta>
          <Tag>{data._nodeType}</Tag>
          <Dot />
          <span title={dateTime(data._ts, locale)}>Modified {relativeTime(data._ts, locale)}</span>
        </Meta>
        <Meta>
          <span>id</span>
          <Mono className="text-foreground select-all">{data._id}</Mono>
        </Meta>
        {target != null && query != null && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-1.5 -ml-2"
            onClick={() =>
              open('node_query', { ...target, query, count: PAGE_SIZE }, `${data._path} children`)
            }
          >
            <FolderTree />
            Browse children
          </Button>
        )}
      </div>
      {SUBTREES.filter(([key]) => data[key] !== undefined).map(([key, label]) => (
        <section key={key}>
          <SectionLabel>{label}</SectionLabel>
          <div className="px-4">
            <Tree value={data[key]} />
          </div>
        </section>
      ))}
    </div>
  );
};
