"use client";

import { useState } from "react";

type Question = {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
};

type Screen = "input" | "quiz" | "results";

export default function Home() {
  // حالات عامة
  const [screen, setScreen] = useState<Screen>("input");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);

  // حالات رفع PDF
  const [isUploading, setIsUploading] = useState(false);
  const [pdfInfo, setPdfInfo] = useState<string>("");

  // حالات الاختبار
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswers, setUserAnswers] = useState<number[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  // رفع PDF واستخراج النص
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setPdfInfo("");
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/extract-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "فشل رفع الملف");
      }

      setNotes(data.text);
      setPdfInfo(`✓ تم استخراج النص من ${file.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "حدث خطأ";
      setError(message);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  // توليد الاختبار من النص
  // forceRegenerate=true عند ضغط زر "إعادة بأسئلة جديدة" لتجاوز الـ cache
  const handleGenerate = async (forceRegenerate = false) => {
    setError("");

    if (notes.trim().length < 100) {
      setError("الرجاء إدخال نص لا يقل عن 100 حرف");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, forceRegenerate }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "حدث خطأ");
      }

      setQuestions(data.questions);
      setCurrentQuestion(0);
      setUserAnswers([]);
      setSelectedOption(null);
      setScreen("quiz");
    } catch (err) {
      const message = err instanceof Error ? err.message : "حدث خطأ";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // اختيار إجابة
  const handleSelectOption = (index: number) => {
    setSelectedOption(index);
  };

  // الانتقال للسؤال التالي أو النتائج
  const handleNext = () => {
    if (selectedOption === null) return;

    const newAnswers = [...userAnswers, selectedOption];
    setUserAnswers(newAnswers);

    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedOption(null);
    } else {
      setScreen("results");
    }
  };

  // حساب النتيجة
  const calculateScore = () => {
    return userAnswers.filter(
      (answer, i) => answer === questions[i].correctAnswer
    ).length;
  };

  // إعادة الاختبار بأسئلة جديدة (مع تجاوز الـ cache)
  const handleRetake = () => {
    handleGenerate(true); // forceRegenerate = true
  };

  // البدء من جديد بمحتوى مختلف
  const handleNewQuiz = () => {
    setScreen("input");
    setNotes("");
    setQuestions([]);
    setUserAnswers([]);
    setCurrentQuestion(0);
    setSelectedOption(null);
    setError("");
    setPdfInfo("");
  };

  // ============== شاشة الإدخال ==============
  if (screen === "input") {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-bold text-slate-800 dark:text-white mb-3">
              مولّد الاختبارات الذكي
            </h1>
            <p className="text-slate-600 dark:text-slate-300 text-lg">
              الصق ملاحظاتك واحصل على اختبار من 10 أسئلة فوراً
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 md:p-8">
            <label className="block text-slate-700 dark:text-slate-200 font-semibold mb-3">
              ملاحظاتك الدراسية
            </label>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="الصق ملاحظاتك هنا... (100 حرف على الأقل)"
              className="w-full h-64 p-4 border-2 border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 transition resize-none"
              dir="auto"
              disabled={isLoading}
            />

            <div className="flex justify-between items-center mt-2 text-sm text-slate-500">
              <span>{notes.length} حرف</span>
              <span>الحد الأدنى: 100 حرف</span>
            </div>

            <div className="flex items-center my-6">
              <div className="flex-1 border-t border-slate-300 dark:border-slate-600"></div>
              <span className="px-3 text-sm text-slate-500">
                أو ارفع ملف PDF
              </span>
              <div className="flex-1 border-t border-slate-300 dark:border-slate-600"></div>
            </div>

            <div className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900/50">
              <label className="block text-slate-700 dark:text-slate-200 font-semibold mb-3">
                📄 ارفع ملف PDF (10 صفحات كحد أقصى)
              </label>
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePdfUpload}
                disabled={isUploading || isLoading}
                className="block w-full text-sm text-slate-600 dark:text-slate-300
                           file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                           file:bg-blue-600 file:text-white file:font-semibold
                           hover:file:bg-blue-700 file:cursor-pointer
                           disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {isUploading && (
                <p className="mt-3 text-sm text-blue-600 dark:text-blue-400">
                  جاري استخراج النص من الملف...
                </p>
              )}
              {pdfInfo && (
                <p className="mt-3 text-sm text-green-600 dark:text-green-400">
                  {pdfInfo}
                </p>
              )}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg">
                {error}
              </div>
            )}

            <button
              onClick={() => handleGenerate(false)}
              disabled={isLoading || isUploading}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 rounded-xl transition shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
            >
              {isLoading
                ? "جارٍ توليد الأسئلة... (10-20 ثانية)"
                : "توليد الاختبار"}
            </button>
          </div>

          <p className="text-center text-slate-500 dark:text-slate-400 text-sm mt-8">
           Crafted by Taif 2026
          </p>
        </div>
      </main>
    );
  }

  // ============== شاشة الاختبار ==============
  if (screen === "quiz") {
    const question = questions[currentQuestion];
    const progress = ((currentQuestion + 1) / questions.length) * 100;

    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2 text-slate-700 dark:text-slate-200 font-semibold">
              <span>
                السؤال {currentQuestion + 1} من {questions.length}
              </span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 md:p-8">
            <h2
              className="text-xl md:text-2xl font-bold text-slate-800 dark:text-white mb-6 leading-relaxed"
              dir="auto"
            >
              {question.question}
            </h2>

            <div className="space-y-3">
              {question.options.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectOption(index)}
                  className={`w-full text-right p-4 rounded-xl border-2 transition ${
                    selectedOption === index
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-300"
                  }`}
                  dir="auto"
                >
                  <span className="font-semibold ml-2">
                    {["أ", "ب", "ج", "د"][index]}.
                  </span>
                  {option}
                </button>
              ))}
            </div>

            <button
              onClick={handleNext}
              disabled={selectedOption === null}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 rounded-xl transition shadow-lg disabled:cursor-not-allowed"
            >
              {currentQuestion < questions.length - 1
                ? "السؤال التالي"
                : "إنهاء الاختبار"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ============== شاشة النتائج ==============
  const score = calculateScore();
  const passed = score >= 7;
  const wrongAnswers = questions
    .map((q, i) => ({ ...q, userAnswer: userAnswers[i], index: i }))
    .filter((q) => q.userAnswer !== q.correctAnswer);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-6 text-center">
          <div
            className={`text-7xl mb-4 ${
              passed ? "text-green-500" : "text-orange-500"
            }`}
          >
            {passed ? "🎉" : "💪"}
          </div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">
            {passed ? "أحسنت!" : "حاول مرة أخرى"}
          </h1>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            {passed ? "نجحت في الاختبار" : "لم تحقق درجة النجاح"}
          </p>
          <div className="text-6xl font-bold mb-2">
            <span className={passed ? "text-green-600" : "text-orange-600"}>
              {score}
            </span>
            <span className="text-slate-400">/{questions.length}</span>
          </div>
        </div>

        {wrongAnswers.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 md:p-8 mb-6">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">
              مراجعة الإجابات الخاطئة
            </h2>
            <div className="space-y-4">
              {wrongAnswers.map((q) => (
                <div
                  key={q.index}
                  className="border-r-4 border-red-400 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg"
                >
                  <p
                    className="font-semibold text-slate-800 dark:text-white mb-3"
                    dir="auto"
                  >
                    السؤال {q.index + 1}: {q.question}
                  </p>
                  <p
                    className="text-red-700 dark:text-red-300 mb-2"
                    dir="auto"
                  >
                    <span className="font-semibold">إجابتك:</span>{" "}
                    {q.options[q.userAnswer]}
                  </p>
                  <p
                    className="text-green-700 dark:text-green-300 mb-3"
                    dir="auto"
                  >
                    <span className="font-semibold">الإجابة الصحيحة:</span>{" "}
                    {q.options[q.correctAnswer]}
                  </p>
                  <p
                    className="text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 p-3 rounded"
                    dir="auto"
                  >
                    <span className="font-semibold">الشرح:</span>{" "}
                    {q.explanation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-3">
          <button
            onClick={handleRetake}
            disabled={isLoading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 rounded-xl transition shadow-lg disabled:cursor-not-allowed"
          >
            {isLoading ? "جارٍ التوليد..." : "🔄 إعادة بأسئلة جديدة"}
          </button>
          <button
            onClick={handleNewQuiz}
            className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-4 rounded-xl transition shadow-lg"
          >
            ✨ اختبار جديد
          </button>
        </div>
      </div>
    </main>
  );
}