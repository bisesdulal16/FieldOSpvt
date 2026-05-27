import { NextRequest, NextResponse } from 'next/server';
import { runZAIChat } from '@/lib/zai-cli';

const CLEANUP_SYSTEM_EN = `You are a text cleanup assistant for a microfinance field officer app in Nepal.
You clean up voice-to-text transcriptions that may contain filler words, false starts, mixed Nepali/English text, and grammatical errors.

Rules:
1. Preserve the ORIGINAL MEANING exactly — do not add information that wasn't said
2. Fix obvious grammar and spelling errors
3. Remove filler words (um, uh, ah, hmm, like) and false starts
4. Keep Nepali text in Nepali script
5. Keep numbers and financial terms (NPR, amounts, percentages) exactly as spoken
6. Keep proper nouns (client names, places) exactly as spoken
7. If the text is already clean, return it as-is
8. Return ONLY the cleaned text, no explanation`;

const CLEANUP_SYSTEM_NE = CLEANUP_SYSTEM_EN + '\n9. The text is primarily in Nepali — preserve Nepali script and grammar';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, language = 'ne' } = body;

    if (!text) {
      return NextResponse.json(
        { success: false, error: 'text is required' },
        { status: 400 }
      );
    }

    const systemPrompt = language === 'ne' ? CLEANUP_SYSTEM_NE : CLEANUP_SYSTEM_EN;
    const prompt = `Clean up this voice note:\n\n"${text}"`;

    const startTime = Date.now();
    const cleaned = await runZAIChat(prompt, systemPrompt);
    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      data: {
        original: text,
        cleaned: cleaned.trim(),
        processing_time_ms: elapsed,
      },
      timestamp: Math.floor(Date.now() / 1000),
      disclaimer: 'Text cleanup is AI-generated. Officer must review before saving.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Text cleanup failed';
    console.error('[Voice AI] Cleanup error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
