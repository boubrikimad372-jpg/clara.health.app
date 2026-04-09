import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  getApiKey,
  validateUserData,
  validateLanguage,
  buildStructuredPrompt,
  ANALYSIS_SCHEMA,
  type OutputLanguage,
  type AnalyzeRequestBody,
} from './_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── API Key ──
  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'API key error';
    console.error('API key error:', message);
    return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing' });
  }

  // ── Validate request ──
  const body = req.body as AnalyzeRequestBody;
  const { userData, uiLanguage, outputLanguage } = body ?? {};

  if (!validateUserData(userData)) {
    return res.status(400).json({
      error: 'Invalid request: userData must include a non-empty intakeText and seenDoctorBefore (boolean)',
    });
  }

  const uiLang: OutputLanguage = validateLanguage(uiLanguage) ? uiLanguage : 'EN';
  const outLang: OutputLanguage = validateLanguage(outputLanguage) ? outputLanguage : 'EN';

  try {
    // ── Build Gemini client ──
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_SCHEMA as any,
      },
    });

    // ── Build prompt ──
    const prompt = buildStructuredPrompt(userData, uiLang, outLang);

    // ── Call Gemini ──
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // ── Parse JSON response ──
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('Failed to parse Gemini response as JSON:', text);
      return res.status(500).json({ error: 'AI returned an invalid response. Please try again.' });
    }

    return res.status(200).json(parsed);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Analyze handler error:', message);
    return res.status(500).json({ error: `Analysis failed: ${message}` });
  }
}
