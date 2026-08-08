export const API_CORS: HeadersInit = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-max-age': '86400',
};

const JSON_HEADERS: HeadersInit = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const HTML_HEADERS: HeadersInit = {
  'content-type': 'text/html; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();
  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: mergeHeaders(JSON_HEADERS, extraHeaders),
  });
}

export function html(body: string, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: mergeHeaders(HTML_HEADERS, extraHeaders),
  });
}

export function apiError(
  message: string,
  status = 400,
  type = 'invalid_request_error',
  code: string | null = null,
  param: string | null = null,
  extraHeaders?: HeadersInit,
): Response {
  return json(
    {
      error: {
        message,
        type,
        param,
        code,
      },
    },
    status,
    mergeHeaders(API_CORS, extraHeaders),
  );
}
