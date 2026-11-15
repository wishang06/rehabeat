/**
 * care-summary: drafts a summary of one patient for the doctor, with Gemini.
 *
 * POST { input: SummaryInput }  ->  200 { draft: Draft }
 *   400 { error: 'input' }   the body is not what the doctor's page sends
 *   503 { error: 'setup' }   no Gemini key in the Edge Function secrets
 *   502 { error: 'gemini' }  Gemini failed or answered something unreadable
 *
 * The key is read from the GEMINI_API_KEY secret and never leaves this
 * function. The model is gemini-flash-latest unless GEMINI_MODEL says
 * otherwise. Deployed with verify_jwt off: the project's publishable key is
 * not a JWT, and the demo clinic on the doctor's page is used signed out.
 * What it accepts is a fixed shape of numbers and the app's own sentences,
 * and the prompt is built here, so it cannot be used to ask Gemini for anything else.
 */
import { DRAFT_SCHEMA, buildPrompt, parseDraft, parseSummaryInput } from './draft.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
/** Bodies bigger than this are refused before they are read as JSON. */
const MAX_BODY_BYTES = 16_000;
const GEMINI_TIMEOUT_MS = 25_000;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** The first secret that holds a key, so a key saved under a common other name still works. */
function geminiKey(): string | null {
  for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_KEY']) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'method' });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply(400, { error: 'input' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'input' });
  }
  const input = parseSummaryInput(typeof body === 'object' && body !== null ? (body as { input?: unknown }).input : null);
  if (!input) return reply(400, { error: 'input' });

  const key = geminiKey();
  if (!key) {
    console.error('care-summary: no Gemini key in the Edge Function secrets (looked for GEMINI_API_KEY)');
    return reply(503, { error: 'setup' });
  }

  const model = Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-flash-latest';
  const { system, user } = buildPrompt(input);
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: DRAFT_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (cause) {
    console.error('care-summary: Gemini could not be reached', String(cause));
    return reply(502, { error: 'gemini' });
  }

  if (!response.ok) {
    // Gemini's own message (a wrong model name, a bad key, a quota) goes to the logs, not to the page.
    console.error('care-summary: Gemini answered', response.status, (await response.text()).slice(0, 600));
    return reply(502, { error: 'gemini' });
  }

  const result = await response.json().catch(() => null);
  const parts: { text?: string; thought?: boolean }[] = result?.candidates?.[0]?.content?.parts ?? [];
  const answer = parts.filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('');
  let draft = null;
  try {
    draft = parseDraft(JSON.parse(answer));
  } catch {
    draft = null;
  }
  if (!draft) {
    console.error('care-summary: unreadable answer', result?.candidates?.[0]?.finishReason, answer.slice(0, 300));
    return reply(502, { error: 'gemini' });
  }
  return reply(200, { draft, model });
});
