// Content fixtures for the content card, in the shapes lib/tools.ts returns: a site with
// articles in two languages, a folder tree and some media.

type Json = Record<string, unknown>;

const EDIT_BASE = 'http://localhost:8080/admin/cs/main/default/edit';
const ARTICLE = 'com.example.news:article';

type MockContent = {
  id: string;
  path: string;
  displayName: string;
  type: string;
  language?: string;
  modifiedTime: string;
  workflowState?: string;
  valid?: boolean;
  published?: string;
  data: Json;
};

const CONTENT: MockContent[] = [
  {
    id: 'c-site',
    path: '/coffee-blog',
    displayName: 'Coffee blog',
    type: 'portal:site',
    language: 'en',
    modifiedTime: '2026-09-01T09:00:00Z',
    workflowState: 'READY',
    published: '2026-03-01T09:00:00Z',
    data: { description: 'Notes on brewing, beans and gear' },
  },
  {
    id: 'c-articles',
    path: '/coffee-blog/articles',
    displayName: 'Articles',
    type: 'base:folder',
    modifiedTime: '2026-09-02T09:00:00Z',
    workflowState: 'READY',
    data: {},
  },
  {
    id: 'c-brewing',
    path: '/coffee-blog/articles/brewing-guide',
    displayName: 'The pour-over brewing guide',
    type: ARTICLE,
    language: 'en',
    modifiedTime: '2026-10-17T14:20:00Z',
    workflowState: 'READY',
    published: '2026-05-04T08:00:00Z',
    data: {
      title: 'The pour-over brewing guide',
      lead: 'Grind, bloom, pour: three steps to a clean cup.',
      body: '<p>Start with 15 g of coffee to 250 g of water.</p>',
      category: 'guide',
      tags: ['brewing', 'pour-over'],
      readingTime: 6,
      featured: true,
      author: { name: 'Ingrid Berg', bio: 'Barista and trainer in Oslo' },
    },
  },
  {
    id: 'c-brygging',
    path: '/coffee-blog/articles/bryggeguide',
    displayName: 'Guide til filterkaffe',
    type: ARTICLE,
    language: 'nb',
    modifiedTime: '2026-10-18T07:45:00Z',
    workflowState: 'IN_PROGRESS',
    data: {
      title: 'Guide til filterkaffe',
      lead: 'Mal, la kaffen svelle, hell: tre steg til en ren kopp.',
      category: 'guide',
      tags: ['brygging'],
      readingTime: 6,
      featured: false,
      author: { name: 'Ingrid Berg' },
    },
  },
  {
    id: 'c-espresso',
    path: '/coffee-blog/articles/espresso-at-home',
    displayName: 'Espresso at home',
    type: ARTICLE,
    language: 'en',
    modifiedTime: '2026-10-12T11:00:00Z',
    workflowState: 'IN_PROGRESS',
    valid: false,
    data: { lead: 'What a home machine can and cannot do.', tags: ['espresso'] },
  },
  {
    id: 'c-grinder',
    path: '/coffee-blog/articles/grinder-review',
    displayName: 'Burr grinder review',
    type: ARTICLE,
    language: 'en',
    modifiedTime: '2026-09-28T16:30:00Z',
    workflowState: 'READY',
    published: '2026-09-29T06:00:00Z',
    data: { title: 'Burr grinder review', category: 'review', tags: ['gear'], readingTime: 9 },
  },
  {
    id: 'c-images',
    path: '/coffee-blog/images',
    displayName: 'Images',
    type: 'base:folder',
    modifiedTime: '2026-08-20T10:00:00Z',
    data: {},
  },
  {
    id: 'c-beans',
    path: '/coffee-blog/images/beans.jpg',
    displayName: 'Roasted beans',
    type: 'media:image',
    modifiedTime: '2026-08-20T10:05:00Z',
    workflowState: 'READY',
    data: { caption: 'A medium roast from Huila', altText: 'Coffee beans' },
  },
  {
    id: 'c-presskit',
    path: '/coffee-blog/images/press-kit.pdf',
    displayName: 'Press kit',
    type: 'media:document',
    modifiedTime: '2026-08-21T12:00:00Z',
    workflowState: 'READY',
    data: {},
  },
];

const ARTICLE_TYPE: Json = {
  name: ARTICLE,
  displayName: 'Article',
  description: 'A blog article with an author and optional media',
  superType: 'base:structured',
  abstract: false,
  allowChildContent: true,
  form: [
    {
      path: 'title',
      kind: 'input',
      label: 'Title',
      inputType: 'TextLine',
      occurrences: { min: 1, max: 1 },
    },
    {
      path: 'lead',
      kind: 'input',
      label: 'Lead',
      helpText: 'One or two sentences shown in lists',
      inputType: 'TextArea',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'body',
      kind: 'input',
      label: 'Body',
      inputType: 'HtmlArea',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'category',
      kind: 'input',
      label: 'Category',
      inputType: 'ComboBox',
      occurrences: { min: 1, max: 1 },
      config: {
        config: {
          option: [
            { '@value': 'guide', value: 'Guide' },
            { '@value': 'review', value: 'Review' },
            { '@value': 'news', value: 'News' },
          ],
        },
      },
    },
    {
      path: 'tags',
      kind: 'input',
      label: 'Tags',
      inputType: 'Tag',
      occurrences: { min: 0, max: 0 },
    },
    {
      path: 'readingTime',
      kind: 'input',
      label: 'Reading time (minutes)',
      inputType: 'Long',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'featured',
      kind: 'input',
      label: 'Featured',
      inputType: 'CheckBox',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'rating',
      kind: 'input',
      label: 'Rating',
      helpText: 'From 0 to 5',
      inputType: 'Double',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'layout',
      kind: 'input',
      label: 'Layout',
      inputType: 'RadioButton',
      occurrences: { min: 1, max: 1 },
      config: {
        config: {
          option: [
            { '@value': 'wide', value: 'Wide' },
            { '@value': 'narrow', value: 'Narrow' },
          ],
        },
      },
    },
    {
      path: 'publishOn',
      kind: 'input',
      label: 'Publish on',
      inputType: 'Date',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'tastingAt',
      kind: 'input',
      label: 'Tasting starts',
      inputType: 'DateTime',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'bestServedAt',
      kind: 'input',
      label: 'Best served at',
      inputType: 'Time',
      occurrences: { min: 0, max: 1 },
    },
    { path: 'author', kind: 'itemSet', label: 'Author', occurrences: { min: 1, max: 2 } },
    {
      path: 'author.name',
      kind: 'input',
      label: 'Name',
      inputType: 'TextLine',
      occurrences: { min: 1, max: 1 },
    },
    {
      path: 'author.bio',
      kind: 'input',
      label: 'Bio',
      inputType: 'TextArea',
      occurrences: { min: 0, max: 1 },
    },
    {
      path: 'media',
      kind: 'optionSet',
      label: 'Media',
      occurrences: { min: 0, max: 1 },
      selection: { min: 1, max: 1 },
    },
    { path: 'media.image', kind: 'option', label: 'Image', default: true },
    {
      path: 'media.image.caption',
      kind: 'input',
      label: 'Caption',
      inputType: 'TextLine',
      occurrences: { min: 0, max: 1 },
    },
    { path: 'media.video', kind: 'option', label: 'Video' },
    {
      path: 'media.video.url',
      kind: 'input',
      label: 'Video URL',
      inputType: 'TextLine',
      occurrences: { min: 1, max: 1 },
    },
  ],
};

const CONTENT_TYPES: Record<string, Json> = {
  [ARTICLE]: ARTICLE_TYPE,
  'base:folder': {
    name: 'base:folder',
    displayName: 'Folder',
    description: null,
    superType: null,
    abstract: false,
    allowChildContent: true,
    form: [],
  },
};

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

function summary(item: MockContent): Json {
  return {
    id: item.id,
    name: item.path.slice(item.path.lastIndexOf('/') + 1),
    path: item.path,
    displayName: item.displayName,
    type: item.type,
    language: item.language ?? null,
    modifiedTime: item.modifiedTime,
    modifier: 'user:system:ingrid',
    workflowState: item.workflowState ?? null,
    valid: item.valid ?? true,
    hasChildren: CONTENT.some((other) => parentOf(other.path) === item.path),
    project: 'default',
    inheritance: null,
    editUrl: `${EDIT_BASE}/${item.id}`,
  };
}

function matches(item: MockContent, text: string): boolean {
  const haystack = `${item.displayName} ${item.path} ${JSON.stringify(item.data)}`.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

// Without `text`, `path` lists direct children; with it, `path` narrows to a subtree. The
// cursor is the next offset, so it reads as a number.
export function searchContent(args: Json): Json {
  const text = typeof args.text === 'string' && args.text.trim() !== '' ? args.text : undefined;
  const path = typeof args.path === 'string' ? args.path : undefined;
  const found = CONTENT.filter((item) => {
    if (args.contentType != null && item.type !== args.contentType) return false;
    if (text == null) return path == null || parentOf(item.path) === path;
    const inside = path == null || path === '/' || item.path.startsWith(`${path}/`);
    return inside && matches(item, text);
  });
  const start = typeof args.cursor === 'string' ? Number(args.cursor) : Number(args.start) || 0;
  const count = Number(args.count ?? 10);
  const page = found.slice(start, start + count);
  const next = start + page.length;
  return {
    total: found.length,
    start,
    count: page.length,
    hits: page.map(summary),
    ...(next < found.length && { nextCursor: String(next) }),
  };
}

export function getContent(key: unknown): Json | undefined {
  const wanted = typeof key === 'string' ? key.replace(/^\/content(?=\/)/, '') : key;
  const item = CONTENT.find((candidate) => candidate.id === wanted || candidate.path === wanted);
  if (item == null) return undefined;
  return {
    ...summary(item),
    owner: 'user:system:ingrid',
    createdTime: '2026-03-01T08:00:00Z',
    publishedTime: item.published ?? null,
    data: item.data,
  };
}

export function getContentType(name: unknown): Json | undefined {
  return typeof name === 'string' ? CONTENT_TYPES[name] : undefined;
}
