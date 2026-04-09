import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getApiKey, validateUserData } from './_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  let apiKey;
  try {
    apiKey = getApiKey();
  } catch (err: any) {
    return res.status(500).json({ error: `API key error: ${err.message}` });
  }

  const { userData } = req.body;
  if (!validateUserData(userData)) {
    return res.status(400).json({ error: 'Invalid user data' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `Respond with a simple JSON: {"test": "success", "age": "${userData.age || 'unknown'}"}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return res.status(200).json({ message: 'API key works', response: text });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: `Gemini error: ${err.message}` });
  }
}
