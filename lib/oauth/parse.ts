export function searchParamsToRecord(searchParams: URLSearchParams) {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = output[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (existing) {
      output[key] = [existing, value];
    } else {
      output[key] = value;
    }
  }
  return output;
}

export async function requestBodyToRecord(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (!text) return { raw: {}, text: "" };

  if (contentType.includes("application/json")) {
    try {
      return { raw: JSON.parse(text) as Record<string, unknown>, text };
    } catch {
      return { raw: { invalid_json: text }, text };
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return { raw: searchParamsToRecord(new URLSearchParams(text)), text };
  }

  return { raw: { body: text }, text };
}
