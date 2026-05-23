// Utility مشترك لاستدعاء Gemini مع آلية fallback تلقائية
// لو فشل النموذج الأساسي بسبب ضغط، نحاول نموذج بديل

import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// قائمة النماذج بترتيب الأولوية (الأقوى أولاً)
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

type GenerationConfig = {
  responseMimeType?: string;
};

type CallOptions = {
  generationConfig?: GenerationConfig;
  maxRetries?: number;
  delayMs?: number;
};

/**
 * استدعاء Gemini مع آلية retry + fallback تلقائي
 * - يحاول كل نموذج 3 مرات قبل ما ينتقل للنموذج التالي
 * - يعمل fallback فقط عند أخطاء 503 (ضغط)
 */
export async function callGeminiWithFallback(
  content: Parameters<GenerativeModel["generateContent"]>[0],
  options: CallOptions = {}
): Promise<string> {
  const { generationConfig, maxRetries = 3, delayMs = 2000 } = options;

  let lastError: unknown = null;

  // نمر على كل نموذج بالترتيب
  for (let modelIndex = 0; modelIndex < MODELS.length; modelIndex++) {
    const modelName = MODELS[modelIndex];
    const isLastModel = modelIndex === MODELS.length - 1;

    console.log(`🤖 محاولة باستخدام النموذج: ${modelName}`);

    const model = genAI.getGenerativeModel({
      model: modelName,
      ...(generationConfig && { generationConfig }),
    });

    // نحاول maxRetries مرة مع النموذج الحالي
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await model.generateContent(content);
        const text = result.response.text();

        if (modelIndex > 0) {
          console.log(`✅ نجح مع النموذج البديل: ${modelName}`);
        }

        return text;
      } catch (error: unknown) {
        const err = error as { status?: number };
        lastError = error;
        const isLastAttempt = attempt === maxRetries - 1;
        const isOverloaded = err.status === 503;
        const isRateLimit = err.status === 429;
        const isRetryable = isOverloaded || isRateLimit;

        // لو الخطأ غير قابل للإعادة، نوقف فوراً
        if (!isRetryable) {
          throw error;
        }

        // لو هذي آخر محاولة مع هذا النموذج
        if (isLastAttempt) {
          // لو فيه نموذج بديل ومشكلة ضغط، ننتقل له
          if (isOverloaded && !isLastModel) {
            console.log(
              `⚠️ النموذج ${modelName} مزدحم. التحويل للنموذج البديل...`
            );
            break; // اخرج من حلقة المحاولات وانتقل للنموذج التالي
          }
          // لو ما فيه نموذج بديل، ارمي الخطأ
          throw error;
        }

        // إعادة المحاولة مع نفس النموذج
        const waitTime = delayMs * Math.pow(2, attempt);
        console.log(
          `⏳ محاولة ${attempt + 1} فشلت (${err.status}). إعادة بعد ${waitTime}ms...`
        );
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }
  }

  // لو وصلنا هنا، يعني كل النماذج فشلت
  throw lastError || new Error("فشلت كل النماذج");
}