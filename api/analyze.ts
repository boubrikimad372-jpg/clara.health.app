import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  getApiKey,
  validateUserData,
  validateLanguage,
  buildStructuredPrompt,
  ANALYSIS_SCHEMA,
  OUTPUT_LANG_NAMES,
  type OutputLanguage,
  type AnalyzeRequestBody,
} from './_shared';

// ─── Timeout helper ───────────────────────────────────────────────────────────
const TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Method check ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── API Key check ──
  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'API key error';
    console.error('API key error:', message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── Request validation ──
  const body = req.body as AnalyzeRequestBody;
  const { userData, uiLanguage, outputLanguage } = body ?? {};

  if (!validateUserData(userData)) {
    return res.status(400).json({
      error: 'Invalid request: userData must include a non-empty intakeText and seenDoctorBefore (boolean)',
    });
  }

  const uiLang: OutputLanguage = validateLanguage(uiLanguage) ? uiLanguage : 'EN';
  const outLang: OutputLanguage = validateLanguage(outputLanguage) ? outputLanguage : 'EN';

  // ── AI call ──
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: `You are Clara, a professional medical communication assistant for women's health.
Age "${userData.age || 'N/A'}" is mandatory in the summary table.
Interview questions language: ${OUTPUT_LANG_NAMES[uiLang]}.
Report language: ${OUTPUT_LANG_NAMES[outLang]}.
narrative: ONE placeholder sentence only — full narrative comes from a separate streaming call.
If interview is complete (answers provided), return steps as empty array [].`,
    });

    const prompt = buildStructuredPrompt(userData, uiLang, outLang);

    const aiResponse = await withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: ANALYSIS_SCHEMA as any,
        },
      }),
      TIMEOUT_MS
    );

    const rawText = aiResponse.response.text();

    if (!rawText || rawText.trim() === '') {
      throw new Error('Empty response from AI model');
    }

    // ── Safe JSON parse ──
    let result: unknown;
    try {
      result = JSON.parse(rawText);
    } catch {
      console.error('JSON parse failed. Raw text:', rawText.slice(0, 200));
      throw new Error('AI returned invalid JSON');
    }

    return res.status(200).json(result);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('analyze handler error:', message);

    if (message.includes('timed out')) {
      return res.status(504).json({ error: 'Request timed out. Please try again.' });
    }
    if (message.includes('invalid JSON')) {
      return res.status(502).json({ error: 'AI returned an unexpected response. Please try again.' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
}
