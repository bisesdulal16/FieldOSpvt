import { NextRequest, NextResponse } from 'next/server';
import { runZAIASR } from '@/lib/zai-cli';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audio_base64, language } = body;

    if (!audio_base64) {
      return NextResponse.json(
        { success: false, error: 'audio_base64 is required' },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const text = await runZAIASR(audio_base64);
    const elapsed = Date.now() - startTime;
    const wordCount = text ? text.split(/\s+/).length : 0;

    return NextResponse.json({
      success: true,
      data: {
        text,
        word_count: wordCount,
        language_detected: language || 'auto',
        processing_time_ms: elapsed,
        confidence: 'high',
      },
      timestamp: Math.floor(Date.now() / 1000),
      disclaimer: 'Transcription is AI-generated. Officer must review before saving.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Transcription failed';
    console.error('[Voice AI] Transcribe error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
