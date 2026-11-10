/** The managed desktop exposes only the local API it needs. Execution shortcuts,
 * pairing, PTYs, configuration, plugins and credential-management routes stay closed. */
export function managedRoute(method: string, path: string) {
  if (method === "GET") return /^\/api\/(info|session|session\/[A-Za-z0-9_-]+(?:\/message)?|shell(?:\/[A-Za-z0-9_-]+(?:\/output)?)?)$/.test(path)
  if (method === "POST") return /^\/api\/(session|session\/[A-Za-z0-9_-]+\/(prompt|interrupt)|shell)$/.test(path)
  return method === "DELETE" && /^\/api\/shell\/[A-Za-z0-9_-]+$/.test(path)
}
