import { request } from '/lib/http-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generate } from '../../main/resources/lib/vertex';
import { accessToken, credentialsProject, envProject } from '../../main/resources/lib/vertex-auth';

vi.mock('../../main/resources/lib/vertex-auth', () => ({
  accessToken: vi.fn(),
  credentialsProject: vi.fn(),
  envProject: vi.fn(),
}));

const TOKEN = 'ya29.secret-token';
const PROMPT = 'Summarize the confidential report';

const send = vi.mocked(request);
const token = vi.mocked(accessToken);
const fromCredentials = vi.mocked(credentialsProject);
const fromEnv = vi.mocked(envProject);
const info = vi.fn();
const warning = vi.fn();

function withConfig(config: Record<string, string>) {
  vi.stubGlobal('app', { config });
}

function respond(status: number, body: unknown) {
  send.mockReturnValue({
    status,
    message: '',
    headers: {},
    contentType: 'application/json',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    bodyStream: {} as never,
    cookies: [],
  });
}

function textResponse(text: string) {
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
}

function failure(): Error {
  try {
    generate({ prompt: PROMPT });
  } catch (e) {
    return e as Error;
  }
  throw new Error('generate() did not throw');
}

function logged(): string {
  return [...info.mock.calls, ...warning.mock.calls].flat().join('\n');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('log', { info, warning });
  withConfig({ 'vertex.project': 'acme-ai' });
  token.mockReturnValue(TOKEN);
  respond(200, textResponse('Done.'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generate', () => {
  it('should POST the prompt to the eu generateContent endpoint with the bearer token', () => {
    expect(generate({ prompt: PROMPT })).toBe('Done.');

    expect(send).toHaveBeenCalledTimes(1);
    const params = send.mock.calls[0][0];
    expect(params).toMatchObject({
      url: 'https://aiplatform.eu.rep.googleapis.com/v1/projects/acme-ai/locations/eu/publishers/google/models/gemini-3.1-flash-lite:generateContent',
      method: 'POST',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(JSON.parse(params.body as string)).toEqual({
      contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
    });
  });

  it('should set both timeouts to 120 seconds', () => {
    generate({ prompt: PROMPT });

    expect(send.mock.calls[0][0]).toMatchObject({
      connectionTimeout: 120_000,
      readTimeout: 120_000,
    });
  });

  it('should pass vertex.credentialsPath to the auth module, and nothing when unset', () => {
    withConfig({ 'vertex.project': 'acme-ai', 'vertex.credentialsPath': '/etc/xp/sa.json' });
    generate({ prompt: PROMPT });
    expect(token).toHaveBeenLastCalledWith('/etc/xp/sa.json');

    withConfig({ 'vertex.project': 'acme-ai' });
    generate({ prompt: PROMPT });
    expect(token).toHaveBeenLastCalledWith(undefined);
  });

  describe('model', () => {
    it('should prefer the argument over vertex.model', () => {
      withConfig({ 'vertex.project': 'acme-ai', 'vertex.model': 'gemini-3.7-flash' });

      generate({ prompt: PROMPT, model: 'gemini-3.1-pro' });

      expect(send.mock.calls[0][0].url).toContain('/models/gemini-3.1-pro:generateContent');
    });

    it('should fall back to vertex.model', () => {
      withConfig({ 'vertex.project': 'acme-ai', 'vertex.model': 'gemini-3.7-flash' });

      generate({ prompt: PROMPT });

      expect(send.mock.calls[0][0].url).toContain('/models/gemini-3.7-flash:generateContent');
    });

    it.each(['../gemini-3.1-pro', 'gemini?x=1', 'a/b', ''])(
      'should refuse the model name %j',
      (model) => {
        expect(() => generate({ prompt: PROMPT, model })).toThrow('Invalid model name');
        expect(send).not.toHaveBeenCalled();
      },
    );
  });

  describe('project', () => {
    it('should prefer vertex.project over the credentials and the environment', () => {
      fromCredentials.mockReturnValue('from-credentials');
      fromEnv.mockReturnValue('from-env');

      generate({ prompt: PROMPT });

      expect(send.mock.calls[0][0].url).toContain('/projects/acme-ai/');
    });

    it("should fall back to the credentials' project", () => {
      withConfig({ 'vertex.credentialsPath': '/etc/xp/sa.json' });
      fromCredentials.mockReturnValue('from-credentials');
      fromEnv.mockReturnValue('from-env');

      generate({ prompt: PROMPT });

      expect(fromCredentials).toHaveBeenCalledWith('/etc/xp/sa.json');
      expect(send.mock.calls[0][0].url).toContain('/projects/from-credentials/');
    });

    it('should fall back to GOOGLE_CLOUD_PROJECT', () => {
      withConfig({});
      fromEnv.mockReturnValue('from-env');

      generate({ prompt: PROMPT });

      expect(send.mock.calls[0][0].url).toContain('/projects/from-env/');
    });

    it('should name all three sources when no project is found', () => {
      withConfig({});

      const error = failure();

      expect(error.message).toBe(
        'No Google Cloud project: set vertex.project, use credentials that name a project, or set GOOGLE_CLOUD_PROJECT',
      );
      expect(send).not.toHaveBeenCalled();
    });

    it('should refuse a project id that is not a single path segment', () => {
      withConfig({});
      fromCredentials.mockReturnValue('../other');

      expect(failure().message).toBe('Invalid Google Cloud project id');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('response', () => {
    it('should join the text parts and skip thought parts', () => {
      respond(200, {
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking...', thought: true },
                { text: 'Hello, ' },
                { text: 'world' },
              ],
            },
          },
        ],
      });

      expect(generate({ prompt: PROMPT })).toBe('Hello, world');
    });

    it('should skip parts that are not text', () => {
      respond(200, {
        candidates: [{ content: { parts: [null, { inlineData: {} }, { text: 'ok' }] } }],
      });

      expect(generate({ prompt: PROMPT })).toBe('ok');
    });
  });

  describe('errors', () => {
    it.each([
      [429, 'Vertex AI returned 429'],
      [500, 'Vertex AI returned 500'],
      [300, 'Vertex AI returned 300'],
    ])('should map a %i to "%s" without the response body', (status, message) => {
      respond(status, { error: { message: `quota exceeded for ${PROMPT}` } });

      expect(failure().message).toBe(message);
    });

    it.each([
      [
        429,
        { error: { status: 'RESOURCE_EXHAUSTED', message: PROMPT } },
        '429 (RESOURCE_EXHAUSTED)',
      ],
      [404, { error: { status: 'NOT_FOUND', message: TOKEN } }, '404 (NOT_FOUND)'],
      [403, { error: { status: PROMPT } }, '403'],
    ])('should add only the error status enum to a %i', (status, body, suffix) => {
      respond(status, body);

      expect(failure().message).toBe(`Vertex AI returned ${suffix}`);
    });

    it('should tell an unrouted 404 from a JSON one', () => {
      respond(404, `<html><body>Not Found ${TOKEN}</body></html>`);

      expect(failure().message).toBe(
        'Vertex AI returned 404 (not routed: the endpoint may not be available to this project, or the model not yet served on v1)',
      );
    });

    it('should leave a non-JSON error other than 404 bare', () => {
      respond(502, `<html>${PROMPT}</html>`);

      expect(failure().message).toBe('Vertex AI returned 502');
    });

    it('should report a blocked prompt by its reason', () => {
      respond(200, { promptFeedback: { blockReason: 'SAFETY' } });

      expect(failure().message).toBe('Vertex AI blocked the prompt (SAFETY)');
    });

    it.each([
      ['MAX_TOKENS', 'The report says'],
      ['SAFETY', 'partial'],
      ['MAX_TOKENS', ''],
    ])('should refuse a %s candidate rather than return %j', (finishReason, text) => {
      respond(200, { candidates: [{ content: { parts: [{ text }] }, finishReason }] });

      expect(failure().message).toBe(`Vertex AI stopped early (${finishReason})`);
    });

    it.each([
      ['blockReason', { promptFeedback: { blockReason: PROMPT } }, 'Vertex AI blocked the prompt'],
      [
        'finishReason',
        { candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: PROMPT }] },
        'Vertex AI stopped early',
      ],
    ])('should not echo a %s that is not an enum name', (_field, body, message) => {
      respond(200, body);

      expect(failure().message).toBe(message);
    });

    it('should report a response without candidates', () => {
      respond(200, {});

      expect(failure().message).toBe('No text in the response');
    });

    it.each([`<html>${PROMPT}</html>`, 'null', '[]', '"text"'])(
      'should report the body %j as unreadable',
      (body) => {
        respond(200, body);

        expect(failure().message).toBe('Vertex AI returned an unreadable response');
      },
    );

    it.each([{ candidates: 'x' }, { candidates: [{ content: { parts: 'x' } }] }])(
      'should report a malformed candidate %j as having no text',
      (body) => {
        respond(200, body);

        expect(failure().message).toBe('No text in the response');
      },
    );

    it('should map a transport failure to a short message', () => {
      send.mockImplementation(() => {
        throw new Error(`connect timed out, Authorization: Bearer ${TOKEN}`);
      });

      expect(failure().message).toBe('Vertex AI request failed');
      expect(logged()).not.toContain(TOKEN);
    });

    it.each([
      [401, { error: { status: TOKEN, message: `${TOKEN} ${PROMPT}` } }],
      [404, `<html>${TOKEN} ${PROMPT}</html>`],
      [200, `${TOKEN} ${PROMPT}`],
      [200, { promptFeedback: { blockReason: `${TOKEN} ${PROMPT}` } }],
      [200, { candidates: [{ finishReason: `${TOKEN} ${PROMPT}` }] }],
      [200, { candidates: [{ content: { parts: [{ data: `${TOKEN} ${PROMPT}` }] } }] }],
    ])(
      'should keep the token and the prompt out of the message for a %i with %j',
      (status, body) => {
        respond(status, body);

        const { message } = failure();

        expect(message).not.toContain(TOKEN);
        expect(message).not.toContain(PROMPT);
      },
    );

    it('should let an auth failure through without calling Vertex AI', () => {
      token.mockImplementation(() => {
        throw new Error('Could not get a Google access token');
      });

      expect(failure().message).toBe('Could not get a Google access token');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('logs', () => {
    it('should log the status, latency and run id', () => {
      generate({ prompt: PROMPT, runId: 'run-42' });

      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/^Vertex AI returned 200 in \d+ ms \(run run-42\)$/),
      );
    });

    it('should leave the run out of the log line when no run id is given', () => {
      generate({ prompt: PROMPT });

      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/^Vertex AI returned 200 in \d+ ms$/),
      );
    });

    it('should never log the prompt, the output or the token', () => {
      respond(200, textResponse('The secret output'));
      generate({ prompt: PROMPT, runId: 'run-42' });
      respond(500, { error: { message: PROMPT } });
      failure();

      expect(logged()).not.toContain(PROMPT);
      expect(logged()).not.toContain('The secret output');
      expect(logged()).not.toContain(TOKEN);
    });
  });
});
