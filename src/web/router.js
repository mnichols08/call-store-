// A small router: "/calls/:id" patterns, one handler per method and path.
export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const names = [];
    const regex = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, name) => (names.push(name), '([^/]+)'))}/?$`);
    routes.push({ method, regex, names, handler, pattern });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    match(method, path) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = route.regex.exec(path);
        if (m) return { handler: route.handler, pattern: route.pattern, params: Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
    /** Whether the path exists for some other method. */
    knows: (path) => routes.some((route) => route.regex.test(path)),
  };
}
