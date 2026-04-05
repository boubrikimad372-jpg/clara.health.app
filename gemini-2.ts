import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenAI({ apiKey });

export interface InterviewStep {
  category: string;
  question: string;
  suggestions: string[];
}

export interface AnalysisResult {
  steps: InterviewStep[];
  // Frame 1: Guidance & Possibilities
  guidance: {
    tips: string[];
    potentialConditions: { name: string; explanation: string }[];
    urgency: 'Green' | 'Yellow' | 'Red';
  };
  // Frame 2: Detailed Clinical Record
  clinicalReport: {
    narrative: string; // Starts with "أشعر بـ..." (100-150 words)
    summaryTable: { label: string; value: string }[];
    doctorQuestions: string[]; // 4 direct "I" style questions
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
        narrative: { type: Type.STRING, description: "Detailed story starting with 'أشعر بـ...'. 100-150 words." },
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

export async function analyzeExperience(userData: {
  intakeText: string;
  age?: string;
  seenDoctorBefore: boolean;
  doctorFindings?: string;
  interviewAnswers?: Record<string, string>;
}, language: 'EN' | 'AR' = 'EN'): Promise<AnalysisResult> {
  // gemini-2.5-flash: best price/performance for structured JSON + Arabic/English reasoning
  const model = "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    ROLE: Her Voice - Clinical Triage Expert.
    MISSION: Transform patient symptoms into a deep, respectful 2-frame clinical report.
    
    STRICT LANGUAGE DIRECTIVE: 
    The user has selected ${language === 'AR' ? 'Arabic' : 'English'}. 
    You MUST respond, ask questions, and generate the final report ONLY in ${language === 'AR' ? 'Arabic' : 'English'}. 
    Do not switch languages. If the language is Arabic, use English medical terms in brackets ONLY for clinical precision.

    INPUT DATA:
    - Age: ${userData.age} (MANDATORY for the final summary table)
    - Initial Description: "${userData.intakeText}"
    - Interview Answers: ${JSON.stringify(userData.interviewAnswers || {})}

    TASK 1: INTERVIEW STEPS (If interviewAnswers is empty)
    Generate EXACTLY 8 follow-up questions in ${language === 'AR' ? 'Arabic' : 'English'} to clarify symptoms. 
    Each question MUST have exactly 4 suggestions (Quick Replies) in the SAME language.
    The 8th question should be: "${language === 'AR' ? 'هل هناك شيء تودين إضافته لوصف حالتك، أو شعور معين لا يريحكِ وتودين إخباري به؟' : 'Is there anything else you would like to add to describe your condition, or a specific feeling that makes you uncomfortable?'}"

    TASK 2: THE OUTPUT (TWO DISTINCT FRAMES)
    1. FRAME 1: GUIDE & POSSIBILITIES
       - tips: 4 actionable, empathetic medical tips.
       - potentialConditions: 2-3 medical possibilities with simple explanations.
       - urgency: Green (Routine), Yellow (Soon), Red (Emergency).

    2. FRAME 2: DETAILED CLINICAL RECORD (Personal Statement)
       - narrative: STRICT DIRECTIVE: This MUST be written in the FIRST PERSON ('I' voice / بصيغة المتكلم 'أنا'). 
         Use phrases like 'أشعر بـ', 'بدأ ألمي منذ', 'لاحظتُ أن' (or 'I feel', 'My pain started', 'I noticed'). 
         NEVER use 'The patient', 'She feels', 'المريضة', or 'هي'. 
         Write it as if YOU ARE the patient talking to your doctor. Be descriptive and lengthy (100-150 words).
       - summaryTable: Age (MUST BE ${userData.age}), Pain Scale, Location, Duration.
       - doctorQuestions: 4 questions in the "I" tone.

    STRICT RULES:
    - NO modern color functions (oklab/oklch).
    - NO brevity in narrative.
    - If you speak as a third party in Frame 2, the report is a failure.
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
        systemInstruction: `You are a professional medical communication assistant for women's health. 
        STRICT DIRECTIVE: Frame 2 is a 'Personal Statement'. You are the patient's voice. Use 'I' (أنا). 
        If you use 'The patient' (المريضة) or 'She' (هي), you are violating the core mission. 
        The age provided (${userData.age}) is 100% mandatory in the final table.
        The user has selected ${language === 'AR' ? 'Arabic' : 'English'}. You MUST respond ONLY in that language.`,
      },
    });

    if (!response.text) {
      throw new Error("No response from AI");
    }

    return JSON.parse(response.text) as AnalysisResult;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
}
