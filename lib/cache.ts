// In-Memory Cache بسيط لتقليل استهلاك توكنز Gemini
// يخزّن النتائج مؤقتاً في ذاكرة السيرفر

import crypto from "crypto";

type CacheEntry = {
  data: unknown;
  expiresAt: number;
};

// Map مشترك لكل الـ API routes
const cache = new Map<string, CacheEntry>();

// مدة الصلاحية: ساعة واحدة (3600 ثانية)
const TTL_MS = 60 * 60 * 1000;

// حد أقصى لعدد العناصر المخزّنة (حماية من امتلاء الذاكرة)
const MAX_ENTRIES = 100;

/**
 * توليد بصمة (hash) فريدة من محتوى الملف أو النص
 */
export function generateHash(content: Buffer | string): string {
  const hash = crypto.createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/**
 * استرجاع نتيجة من الـ cache (إذا موجودة وصالحة)
 */
export function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key);

  if (!entry) return null;

  // إذا انتهت صلاحيتها، احذفها
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  console.log(`✅ Cache HIT للمفتاح: ${key.substring(0, 12)}...`);
  return entry.data as T;
}

/**
 * تخزين نتيجة في الـ cache
 */
export function setInCache(key: string, data: unknown): void {
  // إذا وصلنا للحد الأقصى، احذف أقدم عنصر
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  cache.set(key, {
    data,
    expiresAt: Date.now() + TTL_MS,
  });

  console.log(
    `💾 Cache SET للمفتاح: ${key.substring(0, 12)}... (الحجم الحالي: ${cache.size})`
  );
}

/**
 * توليد مفتاح cache يجمع نوع العملية مع البصمة
 * مثلاً: "pdf-extract:abc123..." أو "pdf-quiz:abc123..." أو "text-quiz:abc123..."
 */
export function makeCacheKey(operation: string, hash: string): string {
  return `${operation}:${hash}`;
}