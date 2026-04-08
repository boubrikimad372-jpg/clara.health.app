import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  getApiKey,
  validateUserData,
  validateLanguage,
  buildNarrativePrompt,
  type OutputLanguage,
  type NarrativeRequestBody,
} from './_shared';

// ─── Timeout ──────────────────────────────────────────────────────────────────
const STREAM_TIMEOUT_MS = 45_000;

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
  const body = req.body as NarrativeRequestBody;
  const { userData, outputLanguage } = body ?? {};

  if (!validateUserData(userData)) {
    return res.status(400).json({
      error: 'Invalid request: userData must include a non-empty intakeText and seenDoctorBefore (boolean)',
    });
  }

  const outLang: OutputLanguage = validateLanguage(outputLanguage) ? outputLanguage : 'EN';

  // ── Streaming headers ──
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('X-Accel-Buffering', 'no'); // تعطيل Nginx buffering في Vercel

  // ── Client disconnect detection ──
  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
  });

  // ── Timeout controller ──
  const timeoutId = setTimeout(() => {
    if (!res.writableEnded) {
      console.error('narrative stream timed out');
      res.end();
    }
  }, STREAM_TIMEOUT_MS);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = buildNarrativePrompt(userData, outLang);

    const streamResult = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    // ── Stream chunks to client ──
    for await (const chunk of streamResult.stream) {
      // إيقاف الـ stream إذا قطع المستخدم الاتصال
      if (clientDisconnected || res.writableEnded) {
        console.log('Client disconnected — stopping stream');
        break;
      }

      const text = chunk.text();
      if (text) {
        res.write(text);
      }
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('narrative stream error:', message);

    // إرسال رسالة خطأ للـ stream إذا لم يُرسل شيء بعد
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream failed. Please try again.' });
      return;
    }
  } finally {
    clearTimeout(timeoutId);
    if (!res.writableEnded) {
      res.end();
    }
  }
}
