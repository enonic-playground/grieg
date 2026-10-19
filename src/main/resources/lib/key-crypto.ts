// JVM-backed primitives for MCP keys and OAuth tokens. Tests mock this module: the Vitest runtime
// has no `Java`.

type ByteArray = unknown;

type SecureRandom = { nextBytes(bytes: ByteArray): void };
type Encoder = { withoutPadding(): Encoder; encodeToString(bytes: ByteArray): string };
type Digest = { update(input: unknown): void; digest(): ByteArray };

const RANDOM_BYTES = 32;

let random: SecureRandom | undefined;

export function randomToken(): string {
  random ??= new (Java.type('java.security.SecureRandom') as unknown as new () => SecureRandom)();
  const bytes = new (Java.type('byte[]') as unknown as new (size: number) => ByteArray)(
    RANDOM_BYTES,
  );
  random.nextBytes(bytes);
  const base64 = Java.type('java.util.Base64') as unknown as { getUrlEncoder(): Encoder };
  return base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
}

function sha256(text: string): ByteArray {
  const digest = (
    Java.type('java.security.MessageDigest') as unknown as {
      getInstance(algorithm: string): Digest;
    }
  ).getInstance('SHA-256');
  const utf8 = (
    Java.type('java.nio.charset.StandardCharsets') as unknown as {
      UTF_8: { encode(text: string): unknown };
    }
  ).UTF_8;
  digest.update(utf8.encode(text));
  return digest.digest();
}

export function sha256Hex(text: string): string {
  const hex = Java.type('java.util.HexFormat') as unknown as {
    of(): { formatHex(bytes: ByteArray): string };
  };
  return hex.of().formatHex(sha256(text));
}

// The PKCE S256 transform (RFC 7636 §4.2).
export function sha256Base64Url(text: string): string {
  const base64 = Java.type('java.util.Base64') as unknown as { getUrlEncoder(): Encoder };
  return base64.getUrlEncoder().withoutPadding().encodeToString(sha256(text));
}
