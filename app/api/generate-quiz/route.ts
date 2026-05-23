import { NextRequest, NextResponse } from "next/server";
import {
  generateHash,
  getFromCache,
  setInCache,
  makeCacheKey,
} from "@/lib/cache";
import { callGeminiWithFallback } from "@/lib/gemini-client";

export async function POST(request: NextRequest) {
  console.log("🔵 وصل الطلب للـ API");
  console.log("🔑 المفتاح موجود؟", !!process.env.GEMINI_API_KEY);

  try {
    const { notes, forceRegenerate } = await request.json();

    if (!notes || notes.trim().length < 100) {
      return NextResponse.json({ error: "النص قصير جداً" }, { status: 400 });
    }

    // قص النص لو طويل جداً
    const MAX_CHARS = 30000;
    const truncatedNotes =
      notes.length > MAX_CHARS ? notes.substring(0, MAX_CHARS) : notes;

    if (notes.length > MAX_CHARS) {
      console.log(`✂️ تم قص النص من ${notes.length} إلى ${MAX_CHARS} حرف`);
    }

    // ===== توليد بصمة النص للـ cache =====
    const textHash = generateHash(truncatedNotes);
    const cacheKey = makeCacheKey("text-quiz", textHash);

    // ===== التحقق من الـ cache (إلا إذا المستخدم طلب إعادة توليد) =====
    if (!forceRegenerate) {
      const cached = getFromCache<object>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    const prompt = `You are an expert teacher. Read the content below and generate a 10-question multiple-choice quiz.

🔴 LANGUAGE RULE — THIS IS THE MOST IMPORTANT RULE, READ IT FIRST:
- Detect the PRIMARY language of the study content provided below.
- If the content is primarily English → write the ENTIRE quiz (every question, every option, every explanation) in English.
- If the content is primarily Arabic → write the ENTIRE quiz in Arabic.
- Match the content's language EXACTLY. NEVER translate the content into a different language.
- Keep technical terms, scientific names, and proper nouns in their ORIGINAL language. If the content is Arabic but contains an English scientific term, keep that term in English inside the Arabic question and answer.
- The language of these instructions has NOTHING to do with the output language. Output language depends ONLY on the content below.

قواعد مهمة (Important rules):
- ولّد 10 أسئلة بالضبط (generate exactly 10 questions)
- كل سؤال له 4 خيارات (4 options per question)
- إجابة واحدة صحيحة فقط لكل سؤال (only one correct answer)
- الأسئلة مستندة فقط على المحتوى المُقدَّم (base questions only on the provided content)
- نوّع بين أسئلة الفهم والتطبيق والتحليل (vary between comprehension, application, and analysis)
- اجعل الخيارات الخاطئة منطقية ومُقنعة (make wrong options plausible)
- لكل سؤال، اكتب شرحاً واضحاً (write a clear explanation for each)

Return the result as JSON in exactly this structure:
{
  "questions": [
    {
      "question": "question text",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "correctAnswer": 0,
      "explanation": "explanation of the correct answer"
    }
  ]
}

Note: correctAnswer is a number from 0 to 3 representing the index of the correct answer.

المحتوى (Content):
"""
${truncatedNotes}
"""`;

    const responseText = await callGeminiWithFallback(prompt, {
      generationConfig: { responseMimeType: "application/json" },
    });

    let quizData;
    try {
      quizData = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { error: "حدث خطأ في معالجة الاستجابة. حاول مرة أخرى." },
        { status: 500 }
      );
    }

    if (!quizData.questions || !Array.isArray(quizData.questions)) {
      throw new Error("صيغة الاستجابة غير صحيحة");
    }

    // حفظ النتيجة في الـ cache (فقط إذا لم يكن forceRegenerate)
    if (!forceRegenerate) {
      setInCache(cacheKey, quizData);
    }

    return NextResponse.json(quizData);
  } catch (error: unknown) {
    console.error("❌ خطأ في توليد الاختبار:");
    console.error(error);

    const errorObj = error as { status?: number; message?: string };

    if (errorObj?.status === 503) {
      return NextResponse.json(
        {
          error:
            "كل نماذج Google مزدحمة حالياً. الرجاء المحاولة بعد دقيقتين.",
        },
        { status: 503 }
      );
    }

    if (errorObj?.status === 429) {
      return NextResponse.json(
        { error: "تم تجاوز الحد المسموح. انتظري دقيقة وحاولي مرة أخرى." },
        { status: 429 }
      );
    }

    const errorMessage = errorObj?.message || "خطأ غير معروف";
    return NextResponse.json(
      { error: `حدث خطأ: ${errorMessage}` },
      { status: 500 }
    );
  }
}