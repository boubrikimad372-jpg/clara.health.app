import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

// نسخة مبسطة من getApiKey بدون الاعتماد على _shared مؤقتاً
function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY غير موجود في البيئة');
  return key;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // السماح بـ CORS للاختبار
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. التحقق من المفتاح
    let apiKey;
    try {
      apiKey = getApiKey();
    } catch (err: any) {
      return res.status(500).json({ error: `خطأ في المفتاح: ${err.message}` });
    }

    // 2. تحضير البيانات من الطلب
    const { userData } = req.body;
    if (!userData || !userData.intakeText) {
      return res.status(400).json({ error: 'البيانات غير كاملة: intakeText مطلوب' });
    }

    // 3. إنشاء عميل Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // 4. إرسال طلب بسيط جداً للاختبار
    const prompt = `رد فقط بـ JSON: {"status": "ok", "age": "${userData.age || 'غير محدد'}"}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // 5. إرجاع الرد
    return res.status(200).json({ 
      success: true, 
      message: 'API يعمل بنجاح',
      geminiResponse: text 
    });

  } catch (err: any) {
    console.error('خطأ في الـ API:', err);
    return res.status(500).json({ 
      error: `فشل الطلب: ${err.message || 'خطأ غير معروف'}`,
      stack: err.stack // للمساعدة في التصحيح
    });
  }
                                   }
