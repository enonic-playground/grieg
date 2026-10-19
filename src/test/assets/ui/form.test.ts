import { describe, expect, it } from 'vitest';

import type { ContentType, FormField } from '../../../main/resources/assets/ui/shapes';

import {
  buildData,
  createArguments,
  createMessage,
  formNodes,
  headerProblems,
  extraKeys,
  initialValues,
  occurrenceProblems,
  problemKeys,
  problemsOf,
} from '../../../main/resources/assets/ui/form';

function input(path: string, inputType: string, min = 0, max = 1, extra = {}): FormField {
  return { path, kind: 'input', label: path, inputType, occurrences: { min, max }, ...extra };
}

const OPTIONS = {
  config: {
    option: [
      { '@value': 'guide', value: 'Guide' },
      { '@value': 'news', value: 'News' },
    ],
  },
};

const FORM: FormField[] = [
  input('title', 'TextLine', 1, 1),
  input('tags', 'Tag', 0, 0),
  input('readingTime', 'Long'),
  input('rating', 'Double'),
  input('featured', 'CheckBox'),
  input('category', 'ComboBox', 1, 1, { config: OPTIONS }),
  input('start', 'DateTime', 0, 1, { config: { config: { timezone: { value: 'true' } } } }),
  input('cover', 'ImageSelector'),
  { path: 'author', kind: 'itemSet', label: 'Author', occurrences: { min: 1, max: 0 } },
  input('author.name', 'TextLine', 1, 1),
  input('author.since', 'Long'),
  { path: 'author.links', kind: 'itemSet', label: 'Links', occurrences: { min: 0, max: 0 } },
  input('author.links.url', 'TextLine'),
  {
    path: 'media',
    kind: 'optionSet',
    label: 'Media',
    occurrences: { min: 0, max: 1 },
    selection: { min: 1, max: 1 },
  },
  { path: 'media.image', kind: 'option', label: 'Image' },
  input('media.image.caption', 'TextLine', 1, 1),
];

const TYPE: ContentType = {
  name: 'my.app:article',
  displayName: 'Article',
  description: null,
  superType: 'base:structured',
  abstract: false,
  allowChildContent: true,
  form: FORM,
};

const NODES = formNodes(FORM);

describe('formNodes', () => {
  it('should edit the supported inputs and one level of item sets, and show the rest', () => {
    expect(NODES.map((node) => [node.name, node.type])).toEqual([
      ['title', 'input'],
      ['tags', 'input'],
      ['readingTime', 'input'],
      ['rating', 'input'],
      ['featured', 'input'],
      ['category', 'input'],
      ['start', 'input'],
      ['cover', 'readOnly'],
      ['author', 'itemSet'],
      ['media', 'readOnly'],
    ]);
    const author = NODES.find((node) => node.name === 'author');
    expect(
      author?.type === 'itemSet' && author.fields.map((node) => [node.name, node.type]),
    ).toEqual([
      ['name', 'input'],
      ['since', 'input'],
      ['links', 'readOnly'],
    ]);
  });

  it('should read ComboBox choices and take a zoned DateTime as text', () => {
    expect(NODES.find((node) => node.name === 'category')).toMatchObject({
      input: 'select',
      choices: [
        { value: 'guide', label: 'Guide' },
        { value: 'news', label: 'News' },
      ],
    });
    expect(NODES.find((node) => node.name === 'start')).toMatchObject({
      input: 'text',
      placeholder: '2026-01-31T09:30:00Z',
    });
    expect(
      formNodes([
        input('d', 'DateTime', 0, 1, { config: { config: { timezone: [{ value: 'true' }] } } }),
      ])[0],
    ).toMatchObject({ input: 'text', placeholder: '2026-01-31T09:30:00Z' });
    const local = formNodes([input('d', 'DateTime')])[0];
    expect(local).toMatchObject({ input: 'datetime' });
    expect(local).not.toHaveProperty('placeholder');
  });
});

describe('buildData', () => {
  it('should give back the draft it was filled from, values typed as XP stores them', () => {
    const data = {
      title: 'Cold brew',
      tags: ['coffee', 'summer'],
      readingTime: 6,
      rating: 4.5,
      featured: true,
      category: 'guide',
      cover: 'image-id',
      author: [{ name: 'Ingrid', links: { url: 'https://example.com' } }, { name: 'Ola' }],
      media: { _selected: ['image'], image: { caption: 'Jar' } },
      unknown: 'kept',
    };

    expect(buildData(NODES, initialValues(NODES, data))).toEqual({ data, problems: {} });
  });

  it('should drop empty inputs, collapse one value and flag numbers that are not', () => {
    const values = {
      ...initialValues(NODES, { author: { name: 'Ingrid' } }),
      title: ['  Cold brew  '],
      tags: ['', 'coffee', ' '],
      readingTime: ['6.5'],
      rating: ['abc'],
      featured: [false],
    };

    expect(buildData(NODES, values)).toEqual({
      data: { title: 'Cold brew', tags: 'coffee', featured: false, author: { name: 'Ingrid' } },
      problems: {
        readingTime: ['“6.5” is not a whole number.'],
        rating: ['“abc” is not a number.'],
      },
    });
  });

  it('should key a problem inside a set by its occurrence once there are several', () => {
    const one = initialValues(NODES, { author: { name: 'a', since: 'x' } });
    const two = initialValues(NODES, {
      author: [
        { name: 'a', since: 'x' },
        { name: 'b', since: '1990' },
      ],
    });

    expect(buildData(NODES, one).problems).toEqual({
      'author.since': ['“x” is not a whole number.'],
    });
    expect(buildData(NODES, two).problems).toEqual({
      'author.0.since': ['“x” is not a whole number.'],
    });
  });
});

describe('convert', () => {
  it.each([
    ['TextArea', '  a  ', { value: '  a  ' }],
    ['Long', '-3', { value: -3 }],
    ['Long', '9007199254740993', { problem: '“9007199254740993” is not a whole number.' }],
    ['Double', '-1.5e2', { value: -150 }],
    ['Double', '0x10', { problem: '“0x10” is not a number.' }],
    ['Double', 'Infinity', { problem: '“Infinity” is not a number.' }],
  ])('should turn a %s entry %j into %j', (inputType, entry, expected) => {
    const { data, problems } = buildData(formNodes([input('f', inputType)]), { f: [entry] });

    expect('value' in expected ? { value: data.f } : { problem: problems.f?.[0] }).toEqual(
      expected,
    );
  });
});

describe('initialValues', () => {
  it('should hold an absent checkbox as unchecked, since that is what it shows', () => {
    const values = initialValues(formNodes([input('flag', 'CheckBox', 1, 1)]), {});

    expect(values).toEqual({ flag: [false] });
    expect(
      occurrenceProblems(
        [input('flag', 'CheckBox', 1, 1)],
        buildData(formNodes([input('flag', 'CheckBox', 1, 1)]), values).data,
      ),
    ).toEqual({});
  });
});

describe('extraKeys', () => {
  it('should name the draft keys no field of the form shows', () => {
    expect(extraKeys(NODES, { title: ['a'], stray: 1, author: [] })).toEqual(['stray']);
  });
});

describe('problemKeys', () => {
  const head = ['title', 'tags', 'readingTime', 'rating', 'featured', 'category', 'start', 'cover'];

  it('should key the fields of one set by name, and of several by occurrence', () => {
    expect(problemKeys(NODES, initialValues(NODES, { author: { name: 'a', x: 1 }, y: 2 }))).toEqual(
      [...head, 'author', 'author.name', 'author.since', 'author.links', 'author.x', 'media', 'y'],
    );
    expect(
      problemKeys(NODES, initialValues(NODES, { author: [{ name: 'a' }, { name: 'b' }] })),
    ).toEqual([
      ...head,
      'author',
      'author.0.name',
      'author.0.since',
      'author.0.links',
      'author.1.name',
      'author.1.since',
      'author.1.links',
      'media',
    ]);
  });
});

describe('occurrenceProblems', () => {
  it("should apply content_create's rules, keyed by path", () => {
    expect(
      occurrenceProblems(FORM, {
        author: [{}, { name: 'Ola' }],
        media: { _selected: [] },
      }),
    ).toEqual({
      title: ['Needs at least 1 value(s), got 0.'],
      category: ['Needs at least 1 value(s), got 0.'],
      'author.0.name': ['Needs at least 1 value(s), got 0.'],
      media: ['Must name 1 to 1 option(s), got 0.'],
    });
  });
});

describe('problemsOf', () => {
  it('should read the paths a content_create refusal names', () => {
    expect(
      problemsOf(
        'Nothing was created: the data does not fit `my.app:article`. `data.title` needs at least 1 value(s), got 0. `data.tags` takes at most 2 value(s), got 3. Check the fields with content_type_get and retry.',
      ),
    ).toEqual({
      title: ['Needs at least 1 value(s), got 0.'],
      tags: ['Takes at most 2 value(s), got 3.'],
    });
  });

  it("should read the path XP's own refusal names in brackets", () => {
    expect(
      problemsOf(
        'XP refused to create the `my.app:article` item: Invalid value in [data.author[1].name]: too long. Check field names, value types and required fields with content_type_get, then retry.',
      ),
    ).toEqual({ 'author.1.name': ['Invalid value: too long.'] });
  });

  it('should find nothing in a refusal that names no path', () => {
    expect(problemsOf('XP refused to create the `my.app:article` item: bad value.')).toEqual({});
  });
});

describe('create request', () => {
  const header = { parentPath: ' /site ', displayName: ' Cold brew ' };

  it('should require a display name and an absolute location', () => {
    expect(headerProblems(header)).toEqual({});
    expect(headerProblems({ parentPath: 'site', displayName: ' ' })).toEqual({
      displayName: ['Required.'],
      parentPath: ['Starts with /, e.g. /my-site/articles.'],
    });
  });

  it('should ask for exactly the reviewed arguments, inlined only when not shared', () => {
    const args = createArguments(TYPE, header, { title: 'Cold brew' });

    expect(args).toEqual({
      parentPath: '/site',
      contentType: 'my.app:article',
      displayName: 'Cold brew',
      data: { title: 'Cold brew' },
    });
    expect(createMessage(TYPE, args, true)).toBe(
      'Create the Article "Cold brew" under /site with content_create, using exactly the arguments I reviewed in the form; they are in your context.',
    );
    const inline = createMessage(TYPE, args, false);
    expect(inline).toContain('```json');
    expect(JSON.parse(inline.split('```json\n')[1].split('\n```')[0])).toEqual(args);
  });
});
