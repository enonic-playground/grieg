import { describe, expect, it } from 'vitest';

import type { Tool } from '../../main/resources/lib/mcp';

import {
  CARD_MIME_TYPE,
  cardResources,
  stampView,
  withCards,
} from '../../main/resources/lib/cards';

const HTML = '<!doctype html>\n<html lang="en"><body><div id="root"></div></body></html>';

function tool(name: string): Tool {
  return {
    name,
    title: name,
    description: name,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: () => ({ ok: true, value: {} }),
  };
}

describe('stampView', () => {
  it('should put the view on the html element only', () => {
    expect(stampView(HTML, 'crons')).toBe(
      '<!doctype html>\n<html data-view="crons" lang="en"><body><div id="root"></div></body></html>',
    );
  });
});

describe('cardResources', () => {
  it('should serve one bordered app resource per view, each stamped with its view', () => {
    const resources = cardResources(HTML);

    expect(resources.map(({ uri }) => uri)).toEqual([
      'ui://grieg/workflows',
      'ui://grieg/runs',
      'ui://grieg/crons',
      'ui://grieg/nodes',
      'ui://grieg/content',
    ]);
    expect(resources[2]).toEqual({
      uri: 'ui://grieg/crons',
      name: 'grieg-crons',
      title: 'Scheduled jobs',
      description: 'Every scheduled job on the server',
      mimeType: CARD_MIME_TYPE,
      text: stampView(HTML, 'crons'),
      meta: { ui: { prefersBorder: true } },
    });
  });

  it.each(['workflows', 'runs', 'crons', 'nodes', 'content'])(
    'should stamp the %s view',
    (view) => {
      const resource = cardResources(HTML).find(({ uri }) => uri === `ui://grieg/${view}`);

      expect(resource?.text).toContain(`<html data-view="${view}" lang="en">`);
    },
  );
});

describe('withCards', () => {
  it('should link each card tool to its view and leave the others alone', () => {
    const names = [
      'workflow_list',
      'workflow_run',
      'run_list',
      'run_get',
      'cron_list',
      'cron_set',
      'node_query',
      'node_get',
      'node_repos',
      'content_search',
      'content_get',
      'content_type_get',
      'content_create',
      'content_update',
    ];

    const linked = Object.fromEntries(
      withCards(names.map(tool)).map(({ name, ui }) => [name, ui?.resourceUri]),
    );

    expect(linked).toEqual({
      workflow_list: 'ui://grieg/workflows',
      workflow_run: undefined,
      run_list: 'ui://grieg/runs',
      run_get: 'ui://grieg/runs',
      cron_list: 'ui://grieg/crons',
      cron_set: undefined,
      node_query: 'ui://grieg/nodes',
      node_get: 'ui://grieg/nodes',
      node_repos: 'ui://grieg/nodes',
      content_search: 'ui://grieg/content',
      content_get: 'ui://grieg/content',
      content_type_get: 'ui://grieg/content',
      content_create: undefined,
      content_update: undefined,
    });
  });
});
