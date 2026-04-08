// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── CALL 1: Structured JSON (عبر Vercel API) ─────────────────────────────────

export async function analyzeStructured(
  userData: {
    intakeText: string;
    age?: string;
    seenDoctorBefore: boolean;
    doctorFindings?: string;
    interviewAnswers?: Record<string, string>;
  },
  uiLanguage: OutputLanguage = 'EN',
  outputLanguage: OutputLanguage = 'EN'
): Promise<AnalysisResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userData, uiLanguage, outputLanguage }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Failed to analyze');
  }

  return response.json() as Promise<AnalysisResult>;
}

// ─── CALL 2: Streaming narrative (عبر Vercel API) ────────────────────────────

export async function streamNarrative(
  userData: {
    intakeText: string;
    age?: string;
    seenDoctorBefore: boolean;
    doctorFindings?: string;
    interviewAnswers?: Record<string, string>;
  },
  outputLanguage: OutputLanguage = 'EN',
  onChunk: (chunk: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: unknown) => void
): Promise<void> {
  try {
    const response = await fetch('/api/narrative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userData, outputLanguage }),
    });

    if (!response.ok) {
      throw new Error(`Narrative API error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    onDone(fullText);

  } catch (err) {
    onError(err);
  }
}

// ─── Legacy wrapper (kept for backward compatibility) ─────────────────────────

export async function analyzeExperience(
  userData: {
    intakeText: string;
    age?: string;
    seenDoctorBefore: boolean;
    doctorFindings?: string;
    interviewAnswers?: Record<string, string>;
  },
  uiLanguage: OutputLanguage = 'EN',
  outputLanguage: OutputLanguage = 'EN'
): Promise<AnalysisResult> {
  return analyzeStructured(userData, uiLanguage, outputLanguage);
}
