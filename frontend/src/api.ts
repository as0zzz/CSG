export async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Ошибка запроса (${response.status})`);
  }
  return response.json();
}
