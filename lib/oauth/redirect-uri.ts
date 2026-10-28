export function sameDiagnosticRedirect(left: string | null, right: string | null) {
  if (!left || !right) return false;
  if (left === right) return true;
  try {
    const a = new URL(left);
    const b = new URL(right);
    const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    return !a.username && !a.password && !b.username && !b.password
      && loopback(a.hostname) && loopback(b.hostname)
      && a.protocol === b.protocol && a.port === b.port && a.pathname === b.pathname
      && a.search === b.search && a.hash === b.hash;
  } catch { return false; }
}
