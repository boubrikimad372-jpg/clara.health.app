import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import {
  getApiKey,
  validateUserData,
  validateLanguage,
  buildNarrativePrompt,
  type OutputLanguage,
  type NarrativeRequestBody,
} from './_shared.js';

// ─── Config ───────────────────────────────────────────────────────────────────

// llama-3.3-70b-versatile → primary: best writing quality for clinical narrative
// llama-3.1-8b-instant    → fallback: if 70B hits rate limit
const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] as const;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;
const STREAM_TIMEOUT_MS = 45_000;

// ─── Sleep helper ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'API key error';
    console.error('API key error:', message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const body = req.body as NarrativeRequestBody;
  const { userData, outputLanguage } = body ?? {};

  if (!validateUserData(userData)) {
    return res.status(400).json({
      error:
        'Invalid request: userData must include a non-empty intakeText and seenDoctorBefore (boolean)',
    });
  }

  const outLang: OutputLanguage = validateLanguage(outputLanguage) ? outputLanguage : 'EN';

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  let clientDisconnected = false;
  req.on('close', () => { clientDisconnected = true; });

  const timeoutId = setTimeout(() => {
    if (!res.writableEnded) {
      console.error('[narrative] stream timed out');
      res.end();
    }
  }, STREAM_TIMEOUT_MS);

  const groq = new Groq({ apiKey });
  const prompt = buildNarrativePrompt(userData, outLang);
  const errors: string[] = [];

  // ── Retry loop: try each model up to MAX_RETRIES times ───────────────────
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[narrative] model=${model} attempt=${attempt}`);

      try {
        // ── Try streaming ──────────────────────────────────────────────────
        const stream = await groq.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          temperature: 0.5,
          max_tokens: 1024,
        });

        let wroteAnything = false;

        for await (const chunk of stream) {
          if (clientDisconnected || res.writableEnded) {
            console.log('[narrative] client disconnected — stopping stream');
            clearTimeout(timeoutId);
            if (!res.writableEnded) res.end();
            return;
          }
          const text = chunk.choices[0]?.delta?.content ?? '';
          if (text) {
            res.write(text);
            wroteAnything = true;
          }
        }

        if (wroteAnything) {
          console.log(`[narrative] success — model=${model} attempt=${attempt}`);
          clearTimeout(timeoutId);
          if (!res.writableEnded) res.end();
          return;
        }

        // Stream completed but wrote nothing — treat as failure
        throw new Error('Stream completed with empty content');

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`[${model}] attempt ${attempt}: ${message}`);
        console.warn(`[narrative] failed — ${errors[errors.length - 1]}`);

        // If we already started writing, we can't retry — just end
        if (res.headersSent && !res.writableEnded) {
          console.error('[narrative] headers already sent, cannot retry');
          clearTimeout(timeoutId);
          res.end();
          return;
        }

        // Rate limit → skip remaining attempts for this model
        if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
          console.warn(`[narrative] rate limit on ${model}, switching model`);
          break;
        }

        // Exponential backoff before next retry
        const isLast = model === MODELS[MODELS.length - 1] && attempt === MAX_RETRIES;
        if (!isLast) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }
  }

  // All models and retries exhausted
  clearTimeout(timeoutId);
  console.error('[narrative] all retries exhausted:', errors.join(' | '));

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Narrative generation failed after multiple attempts. Please try again.',
    });
  } else if (!res.writableEnded) {
    res.end();
  }
}
