const rawBaseUrl = import.meta.env.BASE_URL || "/";

export const BASE_PATH = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) || "/" : rawBaseUrl;

export function withBasePath(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (BASE_PATH === "/") {
    return normalizedPath;
  }
  return `${BASE_PATH}${normalizedPath}`;
}
