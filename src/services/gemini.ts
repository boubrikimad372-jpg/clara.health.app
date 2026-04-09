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

interface UserData {
  intakeText: string;
  age?: string;
  seenDoctorBefore: boolean;
  doctorFindings?: string;
  interviewAnswers?: Record<string, string>;
}

// ─── CALL 1: Structured JSON ──────────────────────────────────────────────────

export async function analyzeStructured(
  userData: UserData,
  uiLanguage: OutputLanguage = 'EN',
  outputLanguage: OutputLanguage = 'EN'
): Promise<AnalysisResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userData, uiLanguage, outputLanguage }),
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Invalid response from server');
  }

  if (!response.ok) {
    const err = data as { error?: string };
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return data as AnalysisResult;
}

// ─── CALL 2: Streaming narrative ──────────────────────────────────────────────

export async function streamNarrative(
  userData: UserData,
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
      let errorMessage = `Narrative server error: ${response.status}`;
      try {
        const errBody = await response.json() as { error?: string };
        if (errBody.error) errorMessage = errBody.error;
      } catch {
        // use default message
      }
      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text) {
          fullText += text;
          onChunk(text);
        }
      }
    } finally {
      reader.releaseLock();
    }

    onDone(fullText);

  } catch (err: unknown) {
    onError(err);
  }
}

// ─── Legacy wrapper ───────────────────────────────────────────────────────────

export async function analyzeExperience(
  userData: UserData,
  uiLanguage: OutputLanguage = 'EN',
  outputLanguage: OutputLanguage = 'EN'
): Promise<AnalysisResult> {
  return analyzeStructured(userData, uiLanguage, outputLanguage);
}
