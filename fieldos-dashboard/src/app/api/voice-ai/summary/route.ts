import { NextRequest, NextResponse } from 'next/server';
import { runZAIChat } from '@/lib/zai-cli';

const SUMMARY_SYSTEM = `You are a visit summary assistant for FieldOS Nepal, a microfinance field officer app.
Generate a concise, professional visit summary from the officer's voice/text notes.

The summary should include:
1. Key topics discussed (2-3 bullet points)
2. Client's current situation/reason for visit
3. Any commitments made (payment promises, follow-up dates)
4. Action items for the officer

Rules:
- Be concise (max 150 words)
- Use professional language
- Preserve financial details (amounts, dates) exactly
- Flag any concerns (hardship, default risk, disputes)
- Use Nepali names and places as given
- If notes are in Nepali, keep the summary in Nepali
- AI output is advisory only — officer must review and approve
- Format: Plain text with bullet points using "•"`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { notes, client_name, visit_purpose, officer_name } = body;

    if (!notes) {
      return NextResponse.json(
        { success: false, error: 'notes is required' },
        { status: 400 }
      );
    }

    const contextParts = [
      `Client: ${client_name || 'Not specified'}`,
      `Visit purpose: ${visit_purpose || 'Not specified'}`,
      `Officer: ${officer_name || 'Field Officer'}`,
      `Notes: ${notes}`,
    ];
    const prompt = contextParts.join('\n');

    const startTime = Date.now();
    const summary = await runZAIChat(prompt, SUMMARY_SYSTEM);
    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      data: {
        summary: summary.trim(),
        processing_time_ms: elapsed,
        disclaimer: 'AI-generated summary — officer must review before saving.',
      },
      timestamp: Math.floor(Date.now() / 1000),
      disclaimer: 'AI-generated summary — officer must review before saving.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Summary generation failed';
    console.error('[Voice AI] Summary error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
