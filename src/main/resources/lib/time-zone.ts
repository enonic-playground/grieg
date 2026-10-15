// JVM-backed time zone check. Tests mock this module: the Vitest runtime has no `Java`.

type JavaTimeZone = { getID(): string };

// lib-scheduler resolves a zone with `TimeZone.getTimeZone`, which silently falls back to GMT for
// an id it does not know, so a typo would schedule in GMT without an error.
export function isTimeZone(id: string): boolean {
  const timeZone = Java.type('java.util.TimeZone') as unknown as {
    getTimeZone(id: string): JavaTimeZone;
  };
  return timeZone.getTimeZone(id).getID() === id;
}
