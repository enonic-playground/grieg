import { FileIcon, FileText, Folder, FolderOpen, ImageIcon, Paperclip } from 'lucide-react';

import type { TypeFamily } from '../content';
import type {
  ContentDetail,
  ContentSummary,
  ContentType,
  FormField,
  JsonObject,
  ToolResults,
} from '../shapes';
import type { ReactElement } from 'react';

import { Button } from '../../js/components/ui/button';
import { dateTime, relativeTime, shortUser } from '../../js/lib/format';
import { useCard } from '../card-context';
import { Dot, Empty, Meta, Mono, Pill, Row, SectionLabel, ShowMore, Tag } from '../components';
import {
  ancestors,
  choicesOf,
  fieldDepth,
  fieldKind,
  occurrencesLabel,
  selectionLabel,
  typeFamily,
  workflowState,
} from '../content';
import { Tree } from '../tree';

const PAGE_SIZE = 20;

const FAMILY_ICONS: Record<TypeFamily, typeof FileIcon> = {
  folder: Folder,
  page: FileText,
  image: ImageIcon,
  media: Paperclip,
  other: FileIcon,
};

const TypeIcon = ({ type }: { type: string }): ReactElement => {
  const Icon = FAMILY_ICONS[typeFamily(type)];
  return <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />;
};

const StatePills = ({ item }: { item: ContentSummary }): ReactElement => {
  const state = workflowState(item.workflowState);
  return (
    <>
      {item.language != null && <Tag>{item.language}</Tag>}
      {state != null && <Pill tone={state.tone}>{state.label}</Pill>}
      {!item.valid && <Pill tone="danger">Invalid</Pill>}
    </>
  );
};

const When = ({ iso, locale }: { iso: string | null | undefined; locale: string }) =>
  iso == null ? null : <span title={dateTime(iso, locale)}>{relativeTime(iso, locale)}</span>;

function childrenArgs(path: string): JsonObject {
  return { path, count: PAGE_SIZE };
}

type SearchViewProps = { data: ToolResults['content_search']; args: JsonObject };

export const ContentSearchView = ({ data, args }: SearchViewProps): ReactElement => {
  const { open, refetch, locale } = useCard();

  // A cursor replaces `start`; content_search refuses both together.
  const showMore = () => {
    const { start: _start, ...rest } = args;
    return refetch('content_search', { ...rest, cursor: data.nextCursor }, (current, page) => ({
      ...page,
      start: current.start,
      count: current.count + page.count,
      hits: [...current.hits, ...page.hits],
    }));
  };

  if (data.hits.length === 0) return <Empty>No content matches.</Empty>;
  return (
    <>
      <ul>
        {data.hits.map((hit) => {
          const crumbs = ancestors(hit.path);
          const title = hit.displayName || hit.name;
          return (
            <Row
              key={hit.id}
              label={`Open ${hit.path}`}
              onOpen={() => open('content_get', { key: hit.id }, title)}
              actions={
                hit.hasChildren === true ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Browse ${title}`}
                    title="Browse children"
                    onClick={() => open('content_search', childrenArgs(hit.path), title)}
                  >
                    <FolderOpen />
                  </Button>
                ) : undefined
              }
            >
              <div className="flex min-w-0 items-center gap-2">
                <TypeIcon type={hit.type} />
                <span className="truncate font-medium">{title}</span>
                <StatePills item={hit} />
              </div>
              <Meta>
                <Mono>{hit.type}</Mono>
                <Dot />
                <span className="truncate">
                  {crumbs.length === 0 ? '/' : crumbs.map((crumb) => crumb.name).join(' › ')}
                </span>
                {hit.modifiedTime != null && (
                  <>
                    <Dot />
                    <When iso={hit.modifiedTime} locale={locale} />
                  </>
                )}
              </Meta>
            </Row>
          );
        })}
      </ul>
      {data.nextCursor != null && (
        <ShowMore left={data.total - data.start - data.hits.length} onMore={showMore} />
      )}
    </>
  );
};

const LinkButton = ({
  onClick,
  children,
  label,
}: {
  onClick: () => void;
  children: string;
  label?: string;
}): ReactElement => (
  <button
    type="button"
    aria-label={label}
    className="hover:text-foreground focus-visible:ring-ring rounded underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
    onClick={onClick}
  >
    {children}
  </button>
);

const SUBTREES = [
  ['data', 'Data'],
  ['fields', 'Fields'],
  ['x', 'Extra data'],
  ['page', 'Page'],
  ['attachments', 'Attachments'],
] as const;

export const ContentView = ({ data }: { data: ContentDetail }): ReactElement => {
  const { open, locale } = useCard();
  const crumbs = ancestors(data.path);
  const history = [
    data.owner != null && <>Owner {shortUser(data.owner)}</>,
    data.createdTime != null && (
      <>
        Created <When iso={data.createdTime} locale={locale} />
      </>
    ),
    data.modifiedTime != null && (
      <>
        Modified <When iso={data.modifiedTime} locale={locale} />
        {data.modifier != null && ` by ${shortUser(data.modifier)}`}
      </>
    ),
    data.publishedTime != null && (
      <>
        Published <When iso={data.publishedTime} locale={locale} />
      </>
    ),
  ].filter((part) => part !== false);

  return (
    <div className="pb-3">
      <div className="px-4 pt-3">
        <Meta>
          <TypeIcon type={data.type} />
          <LinkButton
            label={`Content type ${data.type}`}
            onClick={() => open('content_type_get', { name: data.type }, data.type)}
          >
            {data.type}
          </LinkButton>
          <StatePills item={data} />
        </Meta>
        <nav aria-label="Path">
          <Meta>
            <LinkButton
              label="Browse the top level"
              onClick={() => open('content_search', childrenArgs('/'), 'Content')}
            >
              /
            </LinkButton>
            {crumbs.map((crumb) => (
              <span key={crumb.path} className="inline-flex items-center gap-1.5">
                <LinkButton
                  onClick={() => open('content_search', childrenArgs(crumb.path), crumb.name)}
                >
                  {crumb.name}
                </LinkButton>
                <span aria-hidden className="text-dimmed">
                  ›
                </span>
              </span>
            ))}
            <span className="text-foreground">{data.name}</span>
          </Meta>
        </nav>
        <Meta>
          {history.map((part, index) => (
            <span key={index} className="inline-flex items-center gap-1.5">
              {index > 0 && <Dot />}
              <span>{part}</span>
            </span>
          ))}
        </Meta>
        <Meta>
          <span>id</span>
          <Mono className="text-foreground select-all">{data.id}</Mono>
        </Meta>
        {data.hasChildren === true && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-1.5 -ml-2"
            onClick={() =>
              open('content_search', childrenArgs(data.path), data.displayName || data.name)
            }
          >
            <FolderOpen />
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

const FieldRow = ({ field }: { field: FormField }): ReactElement => {
  const choices = choicesOf(field.config);
  return (
    <Row>
      <div style={{ paddingLeft: `${fieldDepth(field) * 0.75}rem` }}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium">{field.label}</span>
          <Tag>{fieldKind(field)}</Tag>
          {field.occurrences != null && (
            <span className="text-muted-foreground text-xs">
              {occurrencesLabel(field.occurrences)}
            </span>
          )}
          {field.default === true && <Pill tone="muted">Default</Pill>}
        </div>
        <Meta>
          <Mono className="truncate">{field.path}</Mono>
          {field.selection != null && (
            <>
              <Dot />
              <span>{selectionLabel(field.selection)}</span>
            </>
          )}
        </Meta>
        {field.helpText != null && (
          <p className="text-muted-foreground mt-0.5 text-xs">{field.helpText}</p>
        )}
        {choices.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {choices.map((choice) => (
              <Tag key={choice.value}>{choice.label}</Tag>
            ))}
          </div>
        )}
        {field.capped === true && (
          <p className="text-dimmed mt-0.5 text-xs italic">Nested fields not listed: too deep.</p>
        )}
      </div>
    </Row>
  );
};

export const ContentTypeView = ({ data }: { data: ContentType }): ReactElement => (
  <div>
    <div className="px-4 pt-3 pb-2">
      <Meta>
        <TypeIcon type={data.name} />
        {data.superType == null ? (
          <span>Content type</span>
        ) : (
          <span>
            Extends <Mono>{data.superType}</Mono>
          </span>
        )}
        {data.abstract && <Pill tone="muted">Abstract</Pill>}
        {!data.allowChildContent && <Pill tone="muted">No children</Pill>}
      </Meta>
      {data.description != null && data.description !== '' && (
        <p className="text-muted-foreground mt-1 text-xs">{data.description}</p>
      )}
    </div>
    {data.form.length === 0 ? (
      <Empty>This content type has no fields.</Empty>
    ) : (
      <ul className="border-t">
        {data.form.map((field) => (
          <FieldRow key={field.path} field={field} />
        ))}
      </ul>
    )}
    {data.note != null && <p className="text-dimmed px-4 py-2 text-xs italic">{data.note}</p>}
  </div>
);
