import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ─── Types ────────────────────────────────────────────────────────────────────

type OutputLanguage = 'EN' | 'AR' | 'HI' | 'UR';

interface UserData {
  intakeText: string;
  age?: string;
  seenDoctorBefore: boolean;
  doctorFindings?: string;
  interviewAnswers?: Record<string, string>;
}

interface NarrativeRequestBody {
  userData: UserData;
  outputLanguage?: OutputLanguage;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OUTPUT_LANG_NAMES: Record<OutputLanguage, string> = {
  EN: 'English',
  AR: 'Arabic',
  HI: 'Hindi',
  UR: 'Urdu',
};

const FIRST_PERSON_STARTERS: Record<OutputLanguage, string> = {
  EN: 'I feel / My pain started / I noticed',
  AR: 'أشعر بـ / بدأ ألمي منذ / لاحظتُ أن',
  HI: 'मुझे महसूस हो रहा है / मेरा दर्द शुरू हुआ / मैंने देखा',
  UR: 'مجھے محسوس ہو رہا ہے / میرا درد شروع ہوا / میں نے محسوس کیا',
};

const VALID_LANGUAGES: OutputLanguage[] = ['EN', 'AR', 'HI', 'UR'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error('GEMINI_API_KEY is not configured in Vercel Environment Variables.');
  }
  return key.trim();
}

function validateUserData(userData: unknown): userData is UserData {
  if (!userData || typeof userData !== 'object') return false;
  const u = userData as Record<string, unknown>;
  if (typeof u.intakeText !== 'string' || u.intakeText.trim() === '') return false;
  if (typeof u.seenDoctorBefore !== 'boolean') return false;
  if (u.age !== undefined && typeof u.age !== 'string') return false;
  if (u.doctorFindings !== undefined && typeof u.doctorFindings !== 'string') return false;
  if (u.interviewAnswers !== undefined && typeof u.interviewAnswers !== 'object') return false;
  return true;
}

function validateLanguage(lang: unknown): lang is OutputLanguage {
  return typeof lang === 'string' && VALID_LANGUAGES.includes(lang as OutputLanguage);
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildNarrativePrompt(userData: UserData, outputLang: OutputLanguage): string {
  const langName = OUTPUT_LANG_NAMES[outputLang];
  const starters = FIRST_PERSON_STARTERS[outputLang];

  return `
You are Clara — a medical communication assistant writing a patient's personal clinical statement.

TASK: Write a detailed first-person clinical narrative (150-200 words) in ${langName}.

STRICT RULES:
- Write ONLY in ${langName}.
- Use FIRST PERSON exclusively. Use phrases like: ${starters}
- NEVER use "The patient", "She feels", "The user", or any third-person reference.
- Write as if YOU ARE the patient speaking directly to her doctor.
- Be descriptive, specific, and emotionally precise.
- Include: symptom onset, location, character of pain, aggravating/relieving factors, associated symptoms.
${outputLang === 'AR' ? '- Add English medical terms in brackets for clinical precision.' : ''}

PATIENT DATA:
- Age: ${userData.age || 'Not provided'}
- Initial description: "${userData.intakeText}"
- Medical history: ${userData.seenDoctorBefore
    ? `Has seen a doctor. Findings: "${userData.doctorFindings || 'None'}"`
    : 'No prior doctor visit.'}
- Detailed answers: ${JSON.stringify(userData.interviewAnswers || {})}

RESPOND WITH ONLY the narrative text. No labels, no JSON, no headers, no preamble.
`;
}

// ─── Timeout ──────────────────────────────────────────────────────────────────

const STREAM_TIMEOUT_MS = 45_000;

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
      error: 'Invalid request: userData must include a non-empty intakeText and seenDoctorBefore (boolean)',
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
      console.error('narrative stream timed out');
      res.end();
    }
  }, STREAM_TIMEOUT_MS);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = buildNarrativePrompt(userData, outLang);

    const streamResult = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    for await (const chunk of streamResult.stream) {
      if (clientDisconnected || res.writableEnded) {
        console.log('Client disconnected — stopping stream');
        break;
      }
      const text = chunk.text();
      if (text) res.write(text);
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('narrative stream error:', message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream failed. Please try again.' });
      return;
    }
  } finally {
    clearTimeout(timeoutId);
    if (!res.writableEnded) res.end();
  }
}
