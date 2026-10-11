// GraalJS bridge to Java classes; XP lets app scripts look up any host class.
declare const Java: {
  type(className: string): JavaClass;
};

type JavaClass = (abstract new (...args: never[]) => unknown) &
  Record<string, (text: string) => unknown>;
