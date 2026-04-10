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

TASK: Write a first-person clinical narrative in ${langName}. Length must match the available symptom data — do NOT pad or inflate to reach a word count.

STRICT RULES:
- Write ONLY in ${langName}.
- Use FIRST PERSON exclusively. Use phrases like: ${starters}
- NEVER use "The patient", "She feels", "The user", or any third-person reference.
- Write as if YOU ARE the patient speaking directly to her doctor — calm, factual, and clinically precise.
- ZERO emotional or dramatic language. No "I'm scared", "terrifying", "concerning to me", or any feeling-based commentary. Only clinical facts.
- NO repetition — every sentence must add a new, distinct medical fact.
- NO padding — do not add filler sentences to reach a word count. If data is limited, write less.
- Describe symptoms with clinical accuracy: is the pain continuous or intermittent? Does it radiate? Sharp, dull, burning, cramping, pressure?
- MUST include (only if data is available): onset and timeline, anatomical location, pain character, aggravating factors, relieving factors, associated symptoms, functional impact.
- End with a concise, factual closing sentence requesting medical evaluation.
- This app is designed specifically for women's health. If the symptom location is relevant to gynecological conditions (e.g. lower abdomen, pelvis), ALWAYS include whether the pain relates to the menstrual cycle, discharge, or reproductive health — even if the patient did not mention it, infer from context or note it as unconfirmed.
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
    const prompt = buildNarrativePrompt(userData, outLang);

    // Try streaming with gemini-2.5-flash first, fall back to non-streaming if it fails
    let narrativeText = '';

    try {
      const streamModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const streamResult = await streamModel.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      for await (const chunk of streamResult.stream) {
        if (clientDisconnected || res.writableEnded) {
          console.log('Client disconnected — stopping stream');
          break;
        }
        const text = chunk.text();
        if (text) {
          narrativeText += text;
          res.write(text);
        }
      }
    } catch (streamErr: unknown) {
      // Streaming failed — fall back to non-streaming with lite model
      console.warn('Streaming failed, falling back to non-streaming:', streamErr);
      narrativeText = '';

      const liteModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      const result = await liteModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      narrativeText = result.response.text();
      if (!res.writableEnded && narrativeText) {
        res.write(narrativeText);
      }
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('narrative error:', message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Narrative generation failed. Please try again.' });
      return;
    }
  } finally {
    clearTimeout(timeoutId);
    if (!res.writableEnded) res.end();
  }
}
