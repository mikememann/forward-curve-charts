/**
 * Read-only IG REST client gate.
 * A live spread-betting account can place trades. This app must not.
 * Only the session, watchlist, market lookup and historical price routes are allowed.
 */

export class IgPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgPathError";
  }
}

const BLOCKED = ["/positions", "/workingorders", "/confirms", "/dealing"];

export function assertIgPath(method: string, path: string): void {
  const verb = method.toUpperCase();
  const pathname = path.split("?")[0];
  if (BLOCKED.some((part) => pathname === part || pathname.startsWith(`${part}/`))) {
    throw new IgPathError(`IG access is read-only. Refusing ${verb} ${pathname}.`);
  }
  const session = pathname === "/session" && (verb === "POST" || verb === "GET" || verb === "DELETE");
  const watchlists = verb === "GET" && (pathname === "/watchlists" || /^\/watchlists\/[^/]+$/.test(pathname));
  const market = verb === "GET" && (pathname === "/markets" || /^\/markets\/[^/]+$/.test(pathname));
  const prices = verb === "GET" && /^\/prices\/[^/]+$/.test(pathname);
  if (session || watchlists || market || prices) return;
  throw new IgPathError(`IG access is read-only. ${verb} ${pathname} is not on the allowlist.`);
}

export async function igCall(
  method: string,
  path: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
): Promise<Response> {
  assertIgPath(method, path);
  return fetchImpl(path, { ...init, method });
}
