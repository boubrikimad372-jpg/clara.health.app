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
  const key = process.env.GROQ_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error(
      'GROQ_API_KEY is not configured. Add it in Vercel Dashboard → Settings → Environment Variables (no VITE_ prefix), then redeploy.'
    );
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

// ─── JSON Schema (as plain string for Groq prompt) ───────────────────────────
// Groq does not support responseSchema like Gemini.
// Instead we embed the expected JSON structure directly in the prompt.

export const ANALYSIS_SCHEMA_DESCRIPTION = `
{
  "steps": [
    {
      "category": "string",
      "question": "string",
      "suggestions": ["string", "string", "string", "string"]  // exactly 4
    }
    // ... 6-10 items, or empty array [] if interview is complete
  ],
  "guidance": {
    "tips": ["string", "string", "string", "string"],           // exactly 4
    "potentialConditions": [
      { "name": "string", "explanation": "string" }
      // 2-3 items
    ],
    "urgency": "Green" | "Yellow" | "Red"
  },
  "clinicalReport": {
    "narrative": "string",   // ONE sentence placeholder only
    "summaryTable": [
      { "label": "string", "value": "string" }
      // exactly 4 rows: Age, Pain Scale, Location, Duration
    ],
    "doctorQuestions": ["string", "string", "string", "string"] // exactly 4
  }
}`;

// ─── Prompt builders ──────────────────────────────────────────────────────────

export function buildStructuredPrompt(
  userData: UserData,
  uiLang: OutputLanguage,
  outputLang: OutputLanguage
): string {
  const outputLangName = OUTPUT_LANG_NAMES[outputLang];
  const interviewLangName = OUTPUT_LANG_NAMES[uiLang];
  const hasAnswers =
    userData.interviewAnswers && Object.keys(userData.interviewAnswers).length > 0;

  return `
ROLE: Clara — Clinical Triage Expert.
MISSION: Transform patient symptoms into a respectful 2-frame clinical report.

CRITICAL OUTPUT RULE:
- You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no explanation.
- The JSON must exactly match this structure:
${ANALYSIS_SCHEMA_DESCRIPTION}

LANGUAGE DIRECTIVE:
- Interview questions (steps): ${interviewLangName}.
- Final clinical report (guidance + clinicalReport): ${outputLangName}.
- Accept any dialect or informal language as input — understand it fully.
- If outputLanguage is Arabic, include English medical terms in brackets.

INPUT:
- Age: ${userData.age || 'Not provided'}
- Description: "${userData.intakeText}"
- Medical history: ${
    userData.seenDoctorBefore
      ? `Has seen doctor. Findings: "${userData.doctorFindings || 'None'}"`
      : 'No prior doctor visit.'
  }
- Interview answers: ${JSON.stringify(userData.interviewAnswers || {})}

${
  hasAnswers
    ? `TASK 1 — INTERVIEW STEPS: Return steps as an empty array [] since interview is complete.`
    : `TASK 1 — INTERVIEW STEPS:
This app is designed exclusively for women's health. All questions must be written with this in mind.

Generate between 6 and 10 follow-up questions in ${interviewLangName} — choose the number that best fits the symptoms described. Do NOT force exactly 8 if fewer or more are clinically appropriate.

MANDATORY RULE: Question #1 MUST ask about pain intensity on a scale from 1 to 10. This is non-negotiable.
The 4 suggestions for question #1 must be: 1-3 (mild), 4-6 (moderate), 7-8 (severe), 9-10 (unbearable) — all translated into ${interviewLangName}.

IMPORTANT — Aggravating and relieving factors MUST always be two completely separate questions:
- One question asks ONLY: what makes the pain or symptoms WORSE? (movement, eating, stress, position, etc.)
- One question asks ONLY: what makes the pain or symptoms BETTER? (rest, heat, medication, empty stomach, etc.)
Never combine them into one question.

SENSITIVE CONDITIONS RULE:
Always include one question that asks whether the symptoms could be related to a sensitive or personal condition. The 4 suggestions must be chosen from the most clinically relevant options for the specific symptom described. Examples:
- Menstrual cycle (before / during / after period)
- Pregnancy or suspected pregnancy
- Urinary tract infection
- Digestive or bowel issue
- Skin or hormonal condition
- Emotional or psychological stress
- Sexual health or intimacy-related
- None of the above

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
  STRICT RULES for doctorQuestions:
  * Every question MUST reference the patient's actual data: her specific symptom, location, duration, pain character, or context from her answers.
  * BANNED: any generic question that could apply to any patient (e.g. "What causes this pain?", "What tests do you recommend?", "What are treatment options?", "How can I manage symptoms?"). These are FORBIDDEN.
  * Each question must name a specific anatomical location, condition, or clinical detail from her case.
  * If the pain is abdominal/pelvic or occurs around the menstrual cycle, at least 2 questions MUST address gynecological possibilities (e.g. dysmenorrhea, endometriosis, ovarian cysts, PCOS).
  * Use proper medical terminology in the question itself (e.g. "dysmenorrhea", "Mittelschmerz", "IBS", "pelvic inflammatory disease").
  * Questions must be in ${outputLangName}. If Arabic, include the English medical term in brackets.
  * Good examples:
    - "Could my lower abdominal pain that worsens during menstruation be a sign of endometriosis [بطانة الرحم المهاجرة]?"
    - "Given that my pain is burning and located in the upper abdomen, could this be gastritis or a peptic ulcer?"
    - "Should I get a pelvic ultrasound to rule out ovarian cysts given my pain peaks at ovulation?"
    - "My pain scale was 7-8 and movement makes it worse — does this warrant an urgent physical examination?"
  * Bad examples (FORBIDDEN):
    - "What are the possible causes of my pain?" ← too generic
    - "What tests do I need?" ← too generic
    - "How can I prevent future episodes?" ← not specific to her case

CRITICAL: narrative must be a 1-sentence placeholder. summaryTable labels MUST be in ${outputLangName}.
RESPOND WITH ONLY the JSON object. No markdown. No code fences. No explanation.
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
- Medical history: ${
    userData.seenDoctorBefore
      ? `Has seen a doctor. Findings: "${userData.doctorFindings || 'None'}"`
      : 'No prior doctor visit.'
  }
- Detailed answers: ${JSON.stringify(userData.interviewAnswers || {})}

RESPOND WITH ONLY the narrative text. No labels, no JSON, no headers, no preamble.
`;
}
