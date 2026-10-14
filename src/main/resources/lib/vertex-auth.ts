// Google auth through the JVM library include()d in the app jar. Tests mock this module: the
// Vitest runtime has no `Java`.

type AccessToken = { getTokenValue(): string };

type GoogleCredentials = {
  createScopedRequired(): boolean;
  createScoped(scopes: unknown): GoogleCredentials;
  refreshIfExpired(): void;
  getAccessToken(): AccessToken | null;
  getProjectId(): string | null;
};

type InputStream = { close(): void };

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const ADC = 'adc';

// Keyed by the file's path and modification time, so a replaced credentials file is reloaded.
let cached: { source: string; credentials: GoogleCredentials } | undefined;

// Only the class is logged: an auth exception's message can carry the token endpoint's response.
function exceptionClass(e: unknown): string {
  try {
    return (e as { getClass(): { getName(): string } }).getClass().getName();
  } catch {
    return e instanceof Error ? e.name : 'unknown error';
  }
}

function googleCredentials(): {
  fromStream(stream: InputStream): GoogleCredentials;
  getApplicationDefault(): GoogleCredentials;
} {
  return Java.type('com.google.auth.oauth2.GoogleCredentials') as never;
}

function sourceOf(credentialsPath: string | undefined): string {
  if (credentialsPath == null) return ADC;
  const File = Java.type('java.io.File') as unknown as new (path: string) => {
    lastModified(): number;
  };
  return `${credentialsPath}@${new File(credentialsPath).lastModified()}`;
}

function load(credentialsPath: string | undefined): GoogleCredentials {
  let credentials: GoogleCredentials;
  if (credentialsPath == null) {
    credentials = googleCredentials().getApplicationDefault();
  } else {
    const FileInputStream = Java.type('java.io.FileInputStream') as unknown as new (
      path: string,
    ) => InputStream;
    const stream = new FileInputStream(credentialsPath);
    try {
      credentials = googleCredentials().fromStream(stream);
    } finally {
      stream.close();
    }
  }
  // User credentials carry their scopes in the refresh token and refuse to be scoped.
  if (!credentials.createScopedRequired()) return credentials;
  const List = Java.type('java.util.List') as unknown as { of(item: string): unknown };
  return credentials.createScoped(List.of(SCOPE));
}

function credentialsFor(credentialsPath: string | undefined): GoogleCredentials {
  try {
    const source = sourceOf(credentialsPath);
    if (cached?.source !== source) {
      cached = { source, credentials: load(credentialsPath) };
    }
    return cached.credentials;
  } catch (e) {
    log.warning(`Vertex AI could not load Google credentials: ${exceptionClass(e)}`);
    throw new Error(
      credentialsPath == null
        ? 'Could not load Application Default Credentials'
        : 'Could not load the credentials file in vertex.credentialsPath',
    );
  }
}

// The library refreshes only when the cached token is missing or about to expire.
export function accessToken(credentialsPath: string | undefined): string {
  const credentials = credentialsFor(credentialsPath);
  let token: string | undefined;
  try {
    credentials.refreshIfExpired();
    token = credentials.getAccessToken()?.getTokenValue();
  } catch (e) {
    log.warning(`Vertex AI could not get a Google access token: ${exceptionClass(e)}`);
  }
  if (!token) throw new Error('Could not get a Google access token');
  return token;
}

export function credentialsProject(credentialsPath: string | undefined): string | undefined {
  const credentials = credentialsFor(credentialsPath);
  try {
    return credentials.getProjectId() || undefined;
  } catch {
    // Compute Engine credentials throw rather than return null when the metadata server has none.
    return undefined;
  }
}

export function envProject(): string | undefined {
  const System = Java.type('java.lang.System') as unknown as {
    getenv(name: string): string | null;
  };
  return System.getenv('GOOGLE_CLOUD_PROJECT') || undefined;
}
