import { GoogleGenerativeAI } from '@google/generative-ai';
// ─── Types ────────────────────────────────────────────────────────────────────

export type OutputLanguage = 'EN' | 'AR' | 'HI' | 'UR';

export interface UserData {
  intakeText: string;
  age?: string;
  seenDoctorBefore: boolean;
  doctorFindings?: string;
  interviewAnswers?: Record<string, string>;
}

export interface AnalyzeRequestBody {
  userData: UserData;
  uiLanguage?: OutputLanguage;
  outputLanguage?: OutputLanguage;
}

export interface NarrativeRequestBody {
  userData: UserData;
  outputLanguage?: OutputLanguage;
}

// ─── Constants (single source of truth) ──────────────────────────────────────

export const OUTPUT_LANG_NAMES: Record<OutputLanguage, string> = {
  EN: 'English',
  AR: 'Arabic',
  HI: 'Hindi',
  UR: 'Urdu',
};

export const FIRST_PERSON_STARTERS: Record<OutputLanguage, string> = {
  EN: 'I feel / My pain started / I noticed',
  AR: 'أشعر بـ / بدأ ألمي منذ / لاحظتُ أن',
  HI: 'मुझे महसूस हो रहा है / मेरा दर्द शुरू हुआ / मैंने देखा',
  UR: 'مجھے محسوس ہو رہا ہے / میرا درد شروع ہوا / میں نے محسوس کیا',
};

export const VALID_LANGUAGES: OutputLanguage[] = ['EN', 'AR', 'HI', 'UR'];

// ─── API Key validation ───────────────────────────────────────────────────────

export function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }
  return key.trim();
}

// ─── Request validation ───────────────────────────────────────────────────────

export function validateUserData(userData: unknown): userData is UserData {
  if (!userData || typeof userData !== 'object') return false;
  const u = userData as Record<string, unknown>;
  if (typeof u.intakeText !== 'string' || u.intakeText.trim() === '') return false;
  if (typeof u.seenDoctorBefore !== 'boolean') return false;
  if (u.age !== undefined && typeof u.age !== 'string') return false;
  if (u.doctorFindings !== undefined && typeof u.doctorFindings !== 'string') return false;
  if (u.interviewAnswers !== undefined && typeof u.interviewAnswers !== 'object') return false;
  return true;
}

export function validateLanguage(lang: unknown): lang is OutputLanguage {
  return typeof lang === 'string' && VALID_LANGUAGES.includes(lang as OutputLanguage);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

export const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          question: { type: Type.STRING },
          suggestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Exactly 4 quick reply options.',
          },
        },
        required: ['category', 'question', 'suggestions'],
      },
    },
    guidance: {
      type: Type.OBJECT,
      properties: {
        tips: { type: Type.ARRAY, items: { type: Type.STRING } },
        potentialConditions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              explanation: { type: Type.STRING },
            },
            required: ['name', 'explanation'],
          },
        },
        urgency: { type: Type.STRING, enum: ['Green', 'Yellow', 'Red'] },
      },
      required: ['tips', 'potentialConditions', 'urgency'],
    },
    clinicalReport: {
      type: Type.OBJECT,
      properties: {
        narrative: { type: Type.STRING },
        summaryTable: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              value: { type: Type.STRING },
            },
            required: ['label', 'value'],
          },
        },
        doctorQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['narrative', 'summaryTable', 'doctorQuestions'],
    },
  },
  // steps اختياري عند وجود إجابات — لكن Schema يجعلها مطلوبة دائماً
  // الحل: نجعلها مطلوبة دائماً ونتركها فارغة [] عند وجود إجابات
  required: ['steps', 'guidance', 'clinicalReport'],
};

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildStructuredPrompt(
  userData: UserData,
  uiLang: OutputLanguage,
  outputLang: OutputLanguage
): string {
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
Generate EXACTLY 8 follow-up questions in ${interviewLangName}.
Each must have exactly 4 suggestions in the same language.
8th question: ask if there is anything else she would like to add.`
  }

TASK 2 — CLINICAL OUTPUT (all in ${outputLangName}):

FRAME 1 — GUIDANCE:
- tips: 4 actionable, empathetic tips.
- potentialConditions: 2–3 medical possibilities with simple explanations.
- urgency: Green (Routine) / Yellow (See doctor soon) / Red (Emergency).

FRAME 2 — CLINICAL RECORD:
- narrative: Write exactly ONE sentence as a placeholder only (e.g. "I will describe my symptoms to my doctor."). The full narrative is generated by a separate call.
- summaryTable: Age (MUST BE "${userData.age || 'N/A'}"), Pain Scale, Location, Duration.
- doctorQuestions: 4 first-person questions to ask the doctor.

CRITICAL: narrative must be a 1-sentence placeholder. Nothing more.
`;
}

export function buildNarrativePrompt(
  userData: UserData,
  outputLang: OutputLanguage
): string {
  const langName = OUTPUT_LANG_NAMES[outputLang];
  const starters = FIRST_PERSON_STARTERS[outputLang];

  return `
You are Clara — a medical communication assistant writing a patient's personal clinical statement.

TASK: Write a detailed first-person clinical narrative (150–200 words) in ${langName}.

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
