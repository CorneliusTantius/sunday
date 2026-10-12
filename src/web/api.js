export async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  if (options.stream) return response;
  if (response.status === 204) return null;
  return response.json();
}

export function jsonRequest(url, method, body, options = {}) {
  return request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options });
}
