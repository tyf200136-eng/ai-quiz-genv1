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

    const prompt = `أنت معلم خبير. اقرأ المحتوى التالي وولّد اختباراً من 10 أسئلة اختيار من متعدد.

قواعد مهمة:
- ولّد 10 أسئلة بالضبط
- كل سؤال له 4 خيارات
- إجابة واحدة صحيحة فقط لكل سؤال
- الأسئلة مستندة فقط على المحتوى المُقدَّم
- استخدم نفس لغة المحتوى (عربي أو إنجليزي)
- نوّع بين أسئلة الفهم والتطبيق والتحليل
- اجعل الخيارات الخاطئة منطقية ومُقنعة
- لكل سؤال، اكتب شرحاً واضحاً لماذا الإجابة الصحيحة صحيحة

أرجع النتيجة بصيغة JSON بهذا الشكل تماماً:
{
  "questions": [
    {
      "question": "نص السؤال",
      "options": ["الخيار الأول", "الخيار الثاني", "الخيار الثالث", "الخيار الرابع"],
      "correctAnswer": 0,
      "explanation": "شرح لماذا الإجابة الصحيحة"
    }
  ]
}

ملاحظة: correctAnswer هو رقم من 0 إلى 3 يمثل فهرس الإجابة الصحيحة.

المحتوى:
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