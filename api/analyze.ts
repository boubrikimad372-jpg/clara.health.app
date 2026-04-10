import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

// ─── Types ────────────────────────────────────────────────────────────────────

type OutputLanguage = 'EN' | 'AR' | 'HI' | 'UR';

interface UserData {
  intakeText: string;
  age?: string;
  seenDoctorBefore: boolean;
  doctorFindings?: string;
  interviewAnswers?: Record<string, string>;
}

interface AnalyzeRequestBody {
  userData: UserData;
  uiLanguage?: OutputLanguage;
  outputLanguage?: OutputLanguage;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OUTPUT_LANG_NAMES: Record<OutputLanguage, string> = {
  EN: 'English',
  AR: 'Arabic',
  HI: 'Hindi',
  UR: 'Urdu',
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

// ─── Schema ───────────────────────────────────────────────────────────────────

const ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    steps: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          category: { type: SchemaType.STRING },
          question: { type: SchemaType.STRING },
          suggestions: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Exactly 4 quick reply options.',
          },
        },
        required: ['category', 'question', 'suggestions'],
      },
    },
    guidance: {
      type: SchemaType.OBJECT,
      properties: {
        tips: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        potentialConditions: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              name: { type: SchemaType.STRING },
              explanation: { type: SchemaType.STRING },
            },
            required: ['name', 'explanation'],
          },
        },
        urgency: { type: SchemaType.STRING, enum: ['Green', 'Yellow', 'Red'] },
      },
      required: ['tips', 'potentialConditions', 'urgency'],
    },
    clinicalReport: {
      type: SchemaType.OBJECT,
      properties: {
        narrative: { type: SchemaType.STRING },
        summaryTable: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              label: { type: SchemaType.STRING },
              value: { type: SchemaType.STRING },
            },
            required: ['label', 'value'],
          },
        },
        doctorQuestions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      },
      required: ['narrative', 'summaryTable', 'doctorQuestions'],
    },
  },
  required: ['steps', 'guidance', 'clinicalReport'],
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildStructuredPrompt(userData: UserData, uiLang: OutputLanguage, outputLang: OutputLanguage): string {
  const outputLangName = OUTPUT_LANG_NAMES[outputLang];
  const interviewLangName = OUTPUT_LANG_NAMES[uiLang];
  const hasAnswers = userData.interviewAnswers && Object.keys(userData.interviewAnswers).length > 0;

  return `
ROLE: Clara — Clinical Triage Expert.
MISSION: Transform patient symptoms into a respectful 2-frame clinical report.

LANGUAGE DIRECTIVE:
- Interview questions (steps): ${interviewLangName}.
- Final clinical report (guidance + clinicalReport): ${outputLangName}.
- Accept any dialect or informal language as input — understand it fully.
- If outputLanguage is Arabic, include English medical terms in brackets.

INPUT:
- Age: ${userData.age || 'Not provided'}
- Description: "${userData.intakeText}"
- Medical history: ${userData.seenDoctorBefore
    ? `Has seen doctor. Findings: "${userData.doctorFindings || 'None'}"`
    : 'No prior doctor visit.'}
- Interview answers: ${JSON.stringify(userData.interviewAnswers || {})}

${hasAnswers
    ? `TASK 1 — INTERVIEW STEPS: Return steps as an empty array [] since interview is complete.`
    : `TASK 1 — INTERVIEW STEPS:
This app is designed exclusively for women's health. All questions must be written with this in mind.

Generate between 6 and 10 follow-up questions in ${interviewLangName} — choose the number that best fits the symptoms described. Do NOT force exactly 8 if fewer or more are clinically appropriate.

MANDATORY RULE: Question #1 MUST ask about pain intensity on a scale from 1 to 10. This is non-negotiable.
The 4 suggestions for question #1 must be: 1-3 (mild), 4-6 (moderate), 7-8 (severe), 9-10 (unbearable) — all translated into ${interviewLangName}.

IMPORTANT — Aggravating and relieving factors MUST be two separate questions:
- One question: "What makes the pain or symptoms WORSE?" (e.g. movement, eating, stress, specific positions)
- One question: "What makes the pain or symptoms BETTER?" (e.g. rest, heat, medication, empty stomach)
Never combine these into a single question.

WOMEN'S HEALTH RULE: If the symptom location could be related to gynecological or reproductive health (e.g. lower abdomen, pelvis, back, chest), ALWAYS include a question about menstrual cycle, discharge, or other relevant reproductive symptoms. This is mandatory for this app.

Each question must have exactly 4 short suggestions in ${interviewLangName}.
Last question: ask if there is anything else she would like to add.`
  }

TASK 2 — CLINICAL OUTPUT (all in ${outputLangName}):

FRAME 1 — GUIDANCE:
- tips: 4 actionable, empathetic tips.
- potentialConditions: 2-3 medical possibilities with simple explanations.
- urgency: Green (Routine) / Yellow (See doctor soon) / Red (Emergency).

FRAME 2 — CLINICAL RECORD:
- narrative: Write exactly ONE sentence as a placeholder only (e.g. "I will describe my symptoms to my doctor."). The full narrative is generated by a separate call.
- summaryTable: ALWAYS use ${outputLangName} for ALL labels. NEVER use English labels when output language is not English.
  Provide exactly 4 rows: Age (value: "${userData.age || 'N/A'}"), Pain Scale (from answers or "—"), Location (from symptoms), Duration (from symptoms or "—").
- doctorQuestions: 4 first-person questions to ask the doctor.

CRITICAL: narrative must be a 1-sentence placeholder. summaryTable labels MUST be in ${outputLangName} — this is mandatory.
`;
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
    return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing' });
  }

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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_SCHEMA as any,
      },
    });

    const prompt = buildStructuredPrompt(userData, uiLang, outLang);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

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
