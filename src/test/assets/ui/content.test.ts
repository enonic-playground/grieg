import { describe, expect, it } from 'vitest';

import {
  ancestors,
  choicesOf,
  fieldDepth,
  fieldKind,
  occurrencesLabel,
  selectionLabel,
  typeFamily,
  workflowState,
} from '../../../main/resources/assets/ui/content';

describe('typeFamily', () => {
  it.each([
    ['base:folder', 'folder'],
    ['portal:template-folder', 'folder'],
    ['media:image', 'image'],
    ['media:vector', 'image'],
    ['media:document', 'media'],
    ['base:shortcut', 'other'],
    ['portal:site', 'page'],
    ['com.example.news:article', 'page'],
  ])('should put %s in the %s family', (type, family) => {
    expect(typeFamily(type)).toBe(family);
  });
});

describe('ancestors', () => {
  it('should list the parent paths root first, without the item', () => {
    expect(ancestors('/site/articles/item')).toEqual([
      { name: 'site', path: '/site' },
      { name: 'articles', path: '/site/articles' },
    ]);
  });

  it('should give a top-level item no ancestors', () => {
    expect(ancestors('/site')).toEqual([]);
    expect(ancestors('/')).toEqual([]);
  });
});

describe('workflowState', () => {
  it.each([
    ['READY', 'Ready', 'success'],
    ['IN_PROGRESS', 'In progress', 'muted'],
    ['PENDING_APPROVAL', 'Pending approval', 'info'],
    ['REJECTED', 'Rejected', 'danger'],
    ['SOMETHING_NEW', 'Something new', 'muted'],
  ])('should show %s as %s', (state, label, tone) => {
    expect(workflowState(state)).toEqual({ label, tone });
  });

  it('should show no state when there is none', () => {
    expect(workflowState(null)).toBeUndefined();
  });
});

describe('occurrencesLabel', () => {
  it.each([
    [0, 1, 'Optional'],
    [1, 1, 'Required'],
    [0, 0, 'Any number'],
    [2, 0, 'At least 2'],
    [0, 5, 'Up to 5'],
    [3, 3, 'Exactly 3'],
    [1, 4, '1 to 4'],
  ])('should read min %i and max %i as %s', (min, max, label) => {
    expect(occurrencesLabel({ min, max })).toBe(label);
  });
});

describe('selectionLabel', () => {
  it.each([
    [1, 1, 'Pick 1'],
    [0, 2, 'Pick up to 2'],
    [1, 0, 'Pick at least 1'],
    [1, 3, 'Pick 1 to 3'],
  ])('should read min %i and max %i as %s', (min, max, label) => {
    expect(selectionLabel({ min, max })).toBe(label);
  });
});

describe('choicesOf', () => {
  it('should read lib-content option config, value from @value and label from value', () => {
    const config = {
      maximize: true,
      config: {
        option: [
          { '@value': 'guide', value: 'Guide' },
          { '@value': 'news', value: 'News' },
        ],
      },
    };

    expect(choicesOf(config)).toEqual([
      { value: 'guide', label: 'Guide' },
      { value: 'news', label: 'News' },
    ]);
  });

  it('should read a single option, and use the label as value when there is no @value', () => {
    expect(choicesOf({ config: { option: { '@value': 'a', value: 'A' } } })).toEqual([
      { value: 'a', label: 'A' },
    ]);
    expect(choicesOf({ config: { option: [{ value: 'red' }] } })).toEqual([
      { value: 'red', label: 'red' },
    ]);
  });

  it('should find no choices on an input without options', () => {
    expect(choicesOf({ maximize: true })).toEqual([]);
    expect(choicesOf(undefined)).toEqual([]);
  });
});

describe('fieldKind and fieldDepth', () => {
  it('should name inputs by input type and sets by kind, one level per dot', () => {
    const caption = {
      path: 'media.image.caption',
      kind: 'input' as const,
      label: 'Caption',
      inputType: 'TextLine',
    };
    const media = { path: 'media', kind: 'optionSet' as const, label: 'Media' };

    expect(fieldKind(caption)).toBe('TextLine');
    expect(fieldKind(media)).toBe('Option set');
    expect(fieldKind({ path: 'x', kind: 'input', label: 'X' })).toBe('Input');
    expect(fieldDepth(caption)).toBe(2);
    expect(fieldDepth(media)).toBe(0);
  });
});
