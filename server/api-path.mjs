// Detect the API boundary independently of Express's routing case policy.
// Do not normalize the rest of the path: resource types and tokens are case-sensitive.
export function isApiPath(path) {
  return /^\/api(?:\/|$)/i.test(path)
}
