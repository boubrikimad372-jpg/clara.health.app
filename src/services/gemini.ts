import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenAI({ apiKey });

export type OutputLanguage = 'EN' | 'AR' | 'HI' | 'UR';

export interface InterviewStep {
  category: string;
  question: string;
  suggestions: string[];
}

export interface AnalysisResult {
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

const ANALYSIS_SCHEMA = {
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
            description: "Exactly 4 quick reply options for the user."
          },
        },
        required: ["category", "question", "suggestions"],
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
            required: ["name", "explanation"],
          },
        },
        urgency: { type: Type.STRING, enum: ["Green", "Yellow", "Red"] },
      },
      required: ["tips", "potentialConditions", "urgency"],
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
            required: ["label", "value"],
          },
        },
        doctorQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["narrative", "summaryTable", "doctorQuestions"],
    },
  },
  required: ["steps", "guidance", "clinicalReport"],
};

const OUTPUT_LANG_NAMES: Record<OutputLanguage, string> = {
  EN: 'English',
  AR: 'Arabic',
  HI: 'Hindi',
  UR: 'Urdu',
};

const FIRST_PERSON_STARTERS: Record<OutputLanguage, string> = {
  EN: "I feel / My pain started / I noticed",
  AR: "أشعر بـ / بدأ ألمي منذ / لاحظتُ أن",
  HI: "मुझे महसूस हो रहा है / मेरा दर्द शुरू हुआ / मैंने देखा",
  UR: "مجھے محسوس ہو رہا ہے / میرا درد شروع ہوا / میں نے محسوس کیا",
};

const FORBIDDEN_THIRD_PERSON: Record<OutputLanguage, string[]> = {
  EN: ['The patient', 'The user', 'She feels', 'Patient describes'],
  AR: ['تصف المريضة', 'تعاني المستخدمة', 'المريضة تشعر', 'هي تعاني'],
  HI: ['मरीज़ को', 'वह महसूस करती हैं', 'रोगी बताती हैं'],
  UR: ['مریضہ کو', 'وہ محسوس کرتی ہیں', 'مریضہ بیان کرتی ہیں'],
};

export async function analyzeExperience(
  userData: {
    intakeText: string;
    age?: string;
    seenDoctorBefore: boolean;
    doctorFindings?: string;
    interviewAnswers?: Record<string, string>;
  },
  uiLanguage: 'EN' | 'AR' | 'HI' | 'UR' = 'EN',
  outputLanguage: OutputLanguage = 'EN'
): Promise<AnalysisResult> {
  const model = "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });

  const outputLangName = OUTPUT_LANG_NAMES[outputLanguage];
  const firstPersonExamples = FIRST_PERSON_STARTERS[outputLanguage];

  // Interview questions follow UI language; final report follows outputLanguage
  const interviewLangName = OUTPUT_LANG_NAMES[uiLanguage];

  const prompt = `
    ROLE: Clara - Clinical Triage Expert.
    MISSION: Transform patient symptoms into a respectful 2-frame clinical report.

    LANGUAGE DIRECTIVE:
    - Interview questions (steps) MUST be in ${interviewLangName}.
    - The final clinical report (guidance + clinicalReport) MUST be in ${outputLangName}.
    - The user's input may be in dialect, informal language, or any language — understand it fully regardless.
    - If outputLanguage is Arabic, include English medical terms in brackets for clinical precision.

    INPUT DATA:
    - Age: ${userData.age || 'Not provided'}
    - Initial Description: "${userData.intakeText}"
    - Medical History: ${userData.seenDoctorBefore ? `Has seen a doctor. Findings: "${userData.doctorFindings || 'None specified'}"` : 'Has not seen a doctor for this.'}
    - Interview Answers: ${JSON.stringify(userData.interviewAnswers || {})}

    TASK 1: INTERVIEW STEPS (only if interviewAnswers is empty)
    Generate EXACTLY 8 follow-up questions in ${interviewLangName} to clarify symptoms.
    Each question MUST have exactly 4 suggestions in the same language.
    The 8th question should ask: "Is there anything else you'd like to add to describe your condition?"

    TASK 2: THE OUTPUT (TWO FRAMES) — all in ${outputLangName}

    FRAME 1: GUIDANCE & POSSIBILITIES
    - tips: 4 actionable, empathetic medical tips.
    - potentialConditions: 2–3 medical possibilities with simple explanations.
    - urgency: Green (Routine), Yellow (Soon), Red (Emergency).

    FRAME 2: DETAILED CLINICAL RECORD (Personal Statement)
    - narrative: STRICT — written in FIRST PERSON only. Use phrases like: ${firstPersonExamples}.
      NEVER use "The patient", "She feels", or any third-person reference.
      Write as if YOU ARE the patient speaking directly to the doctor. 100–150 words.
    - summaryTable: Age (MUST BE "${userData.age || 'N/A'}"), Pain Scale, Location, Duration.
    - doctorQuestions: 4 questions in "I" tone, to ask the doctor.

    STRICT RULES:
    - If Frame 2 uses third person in any language, the report is a failure.
    - Never use oklab/oklch color functions.
    - Never be brief in narrative.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
        systemInstruction: `You are Clara, a professional medical communication assistant for women's health.
        Frame 2 is a Personal Statement — you are the patient's voice. Use first person only (I / أنا / मैं / میں).
        Age "${userData.age || 'N/A'}" is mandatory in the summary table.
        Interview questions: ${interviewLangName}. Clinical report: ${outputLangName}.`,
      },
    });

    if (!response.text) throw new Error("No response from AI");

    const result = JSON.parse(response.text) as AnalysisResult;

    // Programmatic third-person check
    const forbidden = FORBIDDEN_THIRD_PERSON[outputLanguage];
    const hasForbidden = forbidden.some(term => result.clinicalReport.narrative.includes(term));

    if (hasForbidden) {
      // One retry with stronger instruction
      const retryPrompt = prompt + `\n\nCRITICAL CORRECTION: The previous narrative used third person. Rewrite Frame 2 narrative ONLY using first-person voice: ${firstPersonExamples}. Do NOT use any third-person at all.`;
      const retryResponse = await ai.models.generateContent({
        model,
        contents: retryPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA,
          systemInstruction: `REWRITE MANDATORY. First-person only. Age: ${userData.age}. Output language: ${outputLangName}.`,
        },
      });
      if (!retryResponse.text) throw new Error("No retry response");
      return JSON.parse(retryResponse.text) as AnalysisResult;
    }

    return result;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
}
