import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import {
  generateHash,
  getFromCache,
  setInCache,
  makeCacheKey,
} from "@/lib/cache";
import { callGeminiWithFallback } from "@/lib/gemini-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mode = formData.get("mode") as string | null;

    // ===== تحققات أساسية على الملف =====
    if (!file) {
      return NextResponse.json({ error: "لم يتم رفع أي ملف" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "الملف يجب أن يكون بصيغة PDF" },
        { status: 400 }
      );
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "حجم الملف يتجاوز 10 ميجا" },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // ===== توليد بصمة الملف للـ cache =====
    const fileHash = generateHash(fileBuffer);
    const operation = mode === "quiz" ? "pdf-quiz" : "pdf-extract";
    const cacheKey = makeCacheKey(operation, fileHash);

    // ===== التحقق من الـ cache أولاً =====
    const cached = getFromCache<object>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // ===== عدّ الصفحات برمجياً =====
    let numPages = 0;
    try {
      const pdfDoc = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: false,
      });
      numPages = pdfDoc.getPageCount();
    } catch (pdfError: unknown) {
      const errMsg = (pdfError as Error)?.message || "";
      console.error("خطأ في قراءة PDF:", errMsg);

      if (errMsg.toLowerCase().includes("encrypted")) {
        return NextResponse.json(
          { error: "الملف محمي بكلمة سر. الرجاء رفع ملف غير محمي." },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "الملف تالف أو غير صالح. الرجاء رفع ملف PDF سليم." },
        { status: 400 }
      );
    }

    if (numPages === 0) {
      return NextResponse.json(
        { error: "الملف لا يحتوي على صفحات" },
        { status: 400 }
      );
    }

    if (numPages > 10) {
      return NextResponse.json(
        {
          error: `الملف يحتوي على ${numPages} صفحة. الحد الأقصى المسموح به 10 صفحات.`,
        },
        { status: 400 }
      );
    }

    const base64Data = fileBuffer.toString("base64");

    // ============================================================
    // الوضع 1: توليد الاختبار مباشرة من PDF
    // ============================================================
    if (mode === "quiz") {
      const prompt = `أنت معلم خبير. اقرأ هذا الملف وولّد اختباراً من 10 أسئلة اختيار من متعدد بناءً على محتواه.

قواعد مهمة:
- ولّد 10 أسئلة بالضبط
- كل سؤال له 4 خيارات
- إجابة واحدة صحيحة فقط لكل سؤال
- استخدم نفس لغة المحتوى (عربي أو إنجليزي)
- نوّع بين أسئلة الفهم والتطبيق والتحليل
- اجعل الخيارات الخاطئة منطقية ومُقنعة
- لكل سؤال، اكتب شرحاً واضحاً
- إذا كان الملف لا يحتوي على نص كافٍ لتوليد أسئلة (مثلاً صور فقط)، أرجع: {"error": "NO_TEXT_CONTENT"}

أرجع النتيجة بصيغة JSON:
{
  "questions": [
    {
      "question": "نص السؤال",
      "options": ["خيار1", "خيار2", "خيار3", "خيار4"],
      "correctAnswer": 0,
      "explanation": "شرح الإجابة"
    }
  ]
}

correctAnswer رقم من 0 إلى 3.`;

      const responseText = await callGeminiWithFallback(
        [
          { inlineData: { data: base64Data, mimeType: "application/pdf" } },
          { text: prompt },
        ],
        {
          generationConfig: { responseMimeType: "application/json" },
        }
      );

      let quizData;
      try {
        quizData = JSON.parse(responseText);
      } catch {
        return NextResponse.json(
          { error: "حدث خطأ في معالجة الاستجابة. حاول مرة أخرى." },
          { status: 500 }
        );
      }

      if (quizData.error === "NO_TEXT_CONTENT") {
        return NextResponse.json(
          {
            error:
              "الملف لا يحتوي على نص كافٍ (قد يكون صوراً ممسوحة ضوئياً). الرجاء رفع ملف يحتوي على نص قابل للقراءة.",
          },
          { status: 400 }
        );
      }

      if (!quizData.questions || !Array.isArray(quizData.questions)) {
        return NextResponse.json(
          { error: "تعذّر توليد الأسئلة من هذا الملف. حاول بمحتوى آخر." },
          { status: 500 }
        );
      }

      const response = { ...quizData, numPages };
      setInCache(cacheKey, response);

      return NextResponse.json(response);
    }

    // ============================================================
    // الوضع 2 (الافتراضي): استخراج النص فقط
    // ============================================================
    const text = (
      await callGeminiWithFallback([
        { inlineData: { data: base64Data, mimeType: "application/pdf" } },
        {
          text: `استخرج كل النص من هذا الملف بدقة. اكتب النص العربي متصلاً.
إذا كان الملف لا يحتوي على نص قابل للاستخراج (صور ممسوحة ضوئياً فقط)، اكتب فقط: NO_TEXT_CONTENT`,
        },
      ])
    ).trim();

    if (text === "NO_TEXT_CONTENT") {
      return NextResponse.json(
        {
          error:
            "الملف لا يحتوي على نص قابل للاستخراج (قد يكون صوراً ممسوحة ضوئياً).",
        },
        { status: 400 }
      );
    }

    if (!text || text.length < 50) {
      return NextResponse.json(
        {
          error:
            "لم نتمكن من استخراج نص كافٍ من الملف. تأكد أن الملف يحتوي على نص قابل للقراءة.",
        },
        { status: 400 }
      );
    }

    const response = { text, numPages };
    setInCache(cacheKey, response);

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("خطأ في معالجة PDF:", error);
    const err = error as { status?: number; message?: string };

    if (err?.status === 503) {
      return NextResponse.json(
        { error: "كل نماذج Google مزدحمة حالياً. حاول بعد دقيقتين." },
        { status: 503 }
      );
    }

    if (err?.status === 429) {
      return NextResponse.json(
        { error: "تم تجاوز الحد المسموح. انتظر دقيقة وحاول مرة أخرى." },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "حدث خطأ غير متوقع أثناء معالجة الملف. حاول مرة أخرى." },
      { status: 500 }
    );
  }
}