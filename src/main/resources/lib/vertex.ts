import { request, type HttpResponse } from '/lib/http-client';

import type { VertexConfig } from './config';

import { getVertexConfig } from './config';
import { accessToken, credentialsProject, envProject } from './vertex-auth';

export type GenerateParams = {
  prompt: string;
  model?: string;
  // Only ever logged, so a run's log lines can be matched to it.
  runId?: string;
};

// Both default to 10 s in lib-http-client, and a generation regularly takes longer.
const TIMEOUT_MS = 120_000;
// Model and project are URL path segments.
const SEGMENT = /^[\w.:-]+$/;
// Block reasons, finish reasons and error statuses are Google enum names; any other value is not echoed into a message.
const REASON = /^[A-Z_]{1,64}$/;
const UNREADABLE = 'Vertex AI returned an unreadable response';

function endpoint(project: string, model: string): string {
  return `https://aiplatform.eu.rep.googleapis.com/v1/projects/${project}/locations/eu/publishers/google/models/${model}:generateContent`;
}

function resolveProject(config: VertexConfig): string {
  const project = config.project ?? credentialsProject(config.credentialsPath) ?? envProject();
  if (project == null) {
    throw new Error(
      'No Google Cloud project: set vertex.project, use credentials that name a project, or set GOOGLE_CLOUD_PROJECT',
    );
  }
  if (!SEGMENT.test(project)) throw new Error('Invalid Google Cloud project id');
  return project;
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function withReason(message: string, reason: unknown): string {
  return typeof reason === 'string' && REASON.test(reason) ? `${message} (${reason})` : message;
}

function parseObject(body: string | null): Record<string, unknown> | undefined {
  try {
    return objectOf(JSON.parse(body ?? ''));
  } catch {
    return undefined;
  }
}

// Only Google's status enum is echoed. A 404 without a JSON body never reached the Vertex API.
function statusError(response: HttpResponse): Error {
  const message = `Vertex AI returned ${response.status}`;
  const parsed = parseObject(response.body);
  if (parsed != null) return new Error(withReason(message, objectOf(parsed.error)?.status));
  if (response.status === 404) {
    return new Error(
      `${message} (not routed: the endpoint may not be available to this project, or the model not yet served on v1)`,
    );
  }
  return new Error(message);
}

function textOf(body: string | null): string {
  const parsed = parseObject(body);
  if (parsed == null) throw new Error(UNREADABLE);

  const blockReason = objectOf(parsed.promptFeedback)?.blockReason;
  if (blockReason != null) throw new Error(withReason('Vertex AI blocked the prompt', blockReason));

  const candidate = Array.isArray(parsed.candidates) ? objectOf(parsed.candidates[0]) : undefined;
  // Any reason but STOP means the text is cut off or withheld, so a fragment is not returned.
  const finishReason = candidate?.finishReason;
  if (finishReason != null && finishReason !== 'STOP') {
    throw new Error(withReason('Vertex AI stopped early', finishReason));
  }

  const parts = objectOf(candidate?.content)?.parts;
  const text = (Array.isArray(parts) ? parts : [])
    .flatMap((item) => {
      const part = objectOf(item);
      return part && part.thought !== true && typeof part.text === 'string' ? [part.text] : [];
    })
    .join('');
  if (text === '') throw new Error('No text in the response');
  return text;
}

// Returns the model's text, or throws an error whose message carries no prompt, output or token.
export function generate({ prompt, model, runId }: GenerateParams): string {
  const config = getVertexConfig();
  const modelName = model ?? config.model;
  if (!SEGMENT.test(modelName)) throw new Error('Invalid model name');
  const project = resolveProject(config);
  const token = accessToken(config.credentialsPath);

  const run = runId == null ? '' : ` (run ${runId})`;
  const started = Date.now();
  let response: HttpResponse;
  try {
    response = request({
      url: endpoint(project, modelName),
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      contentType: 'application/json',
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      connectionTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
  } catch {
    log.warning(`Vertex AI request failed after ${Date.now() - started} ms${run}`);
    throw new Error('Vertex AI request failed');
  }

  const ms = Date.now() - started;
  if (response.status < 200 || response.status >= 300) {
    log.warning(`Vertex AI returned ${response.status} in ${ms} ms${run}`);
    throw statusError(response);
  }
  log.info(`Vertex AI returned ${response.status} in ${ms} ms${run}`);
  return textOf(response.body);
}
