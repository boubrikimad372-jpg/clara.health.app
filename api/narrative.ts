import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';

// ─── Language helpers ─────────────────────────────────────────────────────────
const OUTPUT_LANG_NAMES: Record<string, string> = {
  EN: 'English',
  AR: 'Arabic',
  HI: 'Hindi',
  UR: 'Urdu',
};

const FIRST_PERSON_STARTERS: Record<string, string> = {
  EN: 'I feel / My pain started / I noticed',
  AR: 'أشعر بـ / بدأ ألمي منذ / لاحظتُ أن',
  HI: 'मुझे महसूस हो रहा है / मेरा दर्द शुरू हुआ / मैंने देखा',
  UR: 'مجھے محسوس ہو رہا ہے / میرا درد شروع ہوا / میں نے محسوس کیا',
};

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userData, outputLanguage = 'EN' } = req.body;

    if (!userData?.intakeText) {
      return res.status(400).json({ error: 'intakeText is required' });
    }

    const langName = OUTPUT_LANG_NAMES[outputLanguage] || 'English';
    const starters = FIRST_PERSON_STARTERS[outputLanguage] || FIRST_PERSON_STARTERS['EN'];

    const prompt = `
You are Clara — a medical communication assistant writing a patient's personal clinical statement.

TASK: Write a detailed first-person clinical narrative (150–200 words) in ${langName}.

STRICT RULES:
- Write ONLY in ${langName}.
- Use FIRST PERSON exclusively. Use phrases like: ${starters}
- NEVER use "The patient", "She feels", "The user", or any third-person reference.
- Write as if YOU ARE the patient speaking directly to her doctor.
- Be descriptive, specific, and emotionally precise.
- Include: symptom onset, location, character of pain, aggravating/relieving factors, associated symptoms.
${outputLanguage === 'AR' ? '- Add English medical terms in brackets for clinical precision.' : ''}

PATIENT DATA:
- Age: ${userData.age || 'Not provided'}
- Initial description: "${userData.intakeText}"
- Medical history: ${userData.seenDoctorBefore
      ? `Has seen a doctor. Findings: "${userData.doctorFindings || 'None'}"`
      : 'No prior doctor visit.'}
- Detailed answers: ${JSON.stringify(userData.interviewAnswers || {})}

RESPOND WITH ONLY the narrative text. No labels, no JSON, no headers, no preamble.
`;

    const ai = new GoogleGenAI({ apiKey });

    // ─── إعداد الـ streaming response ────────────────────────────────────────
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    for await (const chunk of stream) {
      const text = chunk.text ?? '';
      if (text) {
        res.write(text);
      }
    }

    res.end();

  } catch (err: any) {
    console.error('narrative error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
    res.end();
  }
}
