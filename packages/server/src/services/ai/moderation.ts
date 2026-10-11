// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
export interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
}

export async function checkModeration(
  text: string,
  apiKey: string,
  baseUrl = 'https://api.openai.com/v1'
): Promise<ModerationResult> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/moderations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text }),
  });

  if (!response.ok) {
    // If moderation API fails, allow content through to avoid blocking
    return { flagged: false, categories: {} };
  }

  const data = await response.json() as {
    results: { flagged: boolean; categories: Record<string, boolean> }[];
  };

  const result = data.results[0];
  return {
    flagged: result?.flagged ?? false,
    categories: result?.categories ?? {},
  };
}
