import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import {
  getApiKey,
  validateUserData,
  validateLanguage,
  buildStructuredPrompt,
  type OutputLanguage,
  type AnalyzeRequestBody,
} from './_shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InterviewStep {
  category: string;
  question: string;
  suggestions: string[];
}

interface AnalysisResult {
  steps: InterviewStep[];
  guidance: {
    tips: string[];
    potentialConditions: { name: string; explanation: string }[];
    urgency: 'Green' | 'Yellow' | 'Red';
  };
  clinicalReport: {
    narrative: string;
    summaryTable: { label: string; value: string }[];
    doctorQuestions: string[];
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((x) => typeof x === 'string');
}

function validateAnalysisResult(data: unknown): data is AnalysisResult {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;

  if (!Array.isArray(d.steps)) return false;
  for (const step of d.steps) {
    if (typeof step !== 'object' || step === null) return false;
    const s = step as Record<string, unknown>;
    if (typeof s.category !== 'string') return false;
    if (typeof s.question !== 'string') return false;
    if (!isStringArray(s.suggestions) || s.suggestions.length === 0) return false;
  }

  if (!d.guidance || typeof d.guidance !== 'object') return false;
  const g = d.guidance as Record<string, unknown>;
  if (!isStringArray(g.tips) || g.tips.length === 0) return false;
  if (!Array.isArray(g.potentialConditions) || g.potentialConditions.length === 0) return false;
  for (const pc of g.potentialConditions) {
    if (typeof pc !== 'object' || pc === null) return false;
    const p = pc as Record<string, unknown>;
    if (typeof p.name !== 'string' || typeof p.explanation !== 'string') return false;
  }
  if (!['Green', 'Yellow', 'Red'].includes(g.urgency as string)) return false;

  if (!d.clinicalReport || typeof d.clinicalReport !== 'object') return false;
  const cr = d.clinicalReport as Record<string, unknown>;
  if (typeof cr.narrative !== 'string') return false;
  if (!Array.isArray(cr.summaryTable) || cr.summaryTable.length === 0) return false;
  for (const row of cr.summaryTable) {
    if (typeof row !== 'object' || row === null) return false;
    const r = row as Record<string, unknown>;
    if (typeof r.label !== 'string' || typeof r.value !== 'string') return false;
  }
  if (!isStringArray(cr.doctorQuestions) || cr.doctorQuestions.length === 0) return false;

  return true;
}

// ─── Strip markdown code fences ───────────────────────────────────────────────

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

// ─── Models (ordered by priority) ────────────────────────────────────────────
// llama-3.1-8b-instant    → 14,400 RPD (primary:  saves the 70B quota for narrative)
// llama-3.3-70b-versatile →  1,000 RPD (fallback: better reasoning for complex JSON)

const MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'] as const;

const MAX_RETRIES = 3;   // attempts per model before switching
const RETRY_DELAY_MS = 500; // base delay between retries (multiplied by attempt)

// ─── Sleep helper ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Single call attempt ──────────────────────────────────────────────────────

async function callGroq(
  groq: Groq,
  prompt: string,
  model: string,
  attempt: number
): Promise<AnalysisResult> {
  console.log(`[analyze] model=${model} attempt=${attempt}`);

  const completion = await groq.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a clinical triage assistant. You MUST respond with ONLY a valid JSON object that exactly matches the requested structure. No markdown, no code fences, no explanation.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 4096,
  });

  const rawText = completion.choices[0]?.message?.content ?? '';
  const cleanedText = stripCodeFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedText);
  } catch {
    throw new Error(`JSON parse failed: ${cleanedText.slice(0, 200)}`);
  }

  if (!validateAnalysisResult(parsed)) {
    throw new Error('Structure validation failed — JSON shape does not match expected schema');
  }

  return parsed;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'API key error';
    console.error('API key error:', message);
    return res
      .status(500)
      .json({ error: 'Server configuration error: GROQ_API_KEY is missing' });
  }

  const body = req.body as AnalyzeRequestBody;
  const { userData, uiLanguage, outputLanguage } = body ?? {};

  if (!validateUserData(userData)) {
    return res.status(400).json({
      error:
        'Invalid request: userData must include a non-empty intakeText and seenDoctorBefore (boolean)',
    });
  }

  const uiLang: OutputLanguage = validateLanguage(uiLanguage) ? uiLanguage : 'EN';
  const outLang: OutputLanguage = validateLanguage(outputLanguage) ? outputLanguage : 'EN';

  const groq = new Groq({ apiKey });
  const prompt = buildStructuredPrompt(userData, uiLang, outLang);
  const errors: string[] = [];

  // ── Retry loop: try each model up to MAX_RETRIES times ───────────────────
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await callGroq(groq, prompt, model, attempt);
        console.log(`[analyze] success — model=${model} attempt=${attempt}`);
        return res.status(200).json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`[${model}] attempt ${attempt}: ${message}`);
        console.warn(`[analyze] failed — ${errors[errors.length - 1]}`);

        // Rate limit → skip remaining attempts for this model
        if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
          console.warn(`[analyze] rate limit hit on ${model}, switching model`);
          break;
        }

        // Exponential backoff before next retry (skip on final attempt)
        const isLast = model === MODELS[MODELS.length - 1] && attempt === MAX_RETRIES;
        if (!isLast) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }
  }

  // All models and retries exhausted
  console.error('[analyze] all retries exhausted:', errors.join(' | '));
  return res.status(500).json({
    error: 'Analysis failed after multiple attempts. Please try again in a moment.',
  });
}
