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
      const prompt = `You are an expert teacher. Read this file and generate a 10-question multiple-choice quiz based on its content.

🔴 LANGUAGE RULE — THIS IS THE MOST IMPORTANT RULE, READ IT FIRST:
- Detect the PRIMARY language of the file's content.
- If the file is primarily English → write the ENTIRE quiz (every question, every option, every explanation) in English.
- If the file is primarily Arabic → write the ENTIRE quiz in Arabic.
- Match the file's language EXACTLY. NEVER translate the content into a different language.
- Keep technical terms, scientific names, and proper nouns in their ORIGINAL language. If the file is Arabic but contains an English scientific term, keep that term in English inside the Arabic question and answer.
- The language of these instructions has NOTHING to do with the output language. Output language depends ONLY on the file's content.

قواعد مهمة (Important rules):
- ولّد 10 أسئلة بالضبط (generate exactly 10 questions)
- كل سؤال له 4 خيارات (4 options per question)
- إجابة واحدة صحيحة فقط لكل سؤال (only one correct answer)
- نوّع بين أسئلة الفهم والتطبيق والتحليل (vary between comprehension, application, and analysis)
- اجعل الخيارات الخاطئة منطقية ومُقنعة (make wrong options plausible)
- لكل سؤال، اكتب شرحاً واضحاً (write a clear explanation for each)
- إذا كان الملف لا يحتوي على نص كافٍ لتوليد أسئلة (مثلاً صور فقط)، أرجع: {"error": "NO_TEXT_CONTENT"}

Return the result as JSON:
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

Note: correctAnswer is a number from 0 to 3.`;

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
          text: `Extract ALL text from this file accurately and completely.
- Preserve the text in its ORIGINAL language exactly as it appears. Do NOT translate anything.
- If the text is Arabic, keep it as continuous, connected Arabic text.
- If the file has no extractable text (scanned images only), respond with only: NO_TEXT_CONTENT`,
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