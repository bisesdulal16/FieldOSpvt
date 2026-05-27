import { NextRequest, NextResponse } from 'next/server';
import { runZAIChat } from '@/lib/zai-cli';

const ASK_SYSTEM = `You are "FieldOS Assistant", an AI helper for microfinance field officers in Nepal.
You help officers with questions about their daily work — but you NEVER make decisions for them.

Available data context (provided with each question):
- Today's due clients and their overdue status
- Pending sync items count
- Promise-to-pay due today
- Client history and visit records
- Branch policies and collection targets

Rules:
- Be concise and actionable
- Use Nepali Rupee (NPR) for amounts
- Use Nepali names and places as provided
- If asked about loan approval, interest rates, or policy changes → redirect to branch manager
- NEVER suggest approving loans, waiving payments, or adjusting amounts
- NEVER suggest disciplinary actions
- Flag any client hardship or risk situations
- If data is not available, say "Data not available — check after sync"
- Keep responses under 100 words unless detailed explanation is needed
- AI output is advisory only — officer must verify and act independently
- Always end with "⚡ AI suggestion only — verify before acting." when providing actionable advice.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, context, conversation_history } = body;

    if (!question) {
      return NextResponse.json(
        { success: false, error: 'question is required' },
        { status: 400 }
      );
    }

    // Build full prompt with context and history
    const promptParts: string[] = [];

    if (context && typeof context === 'object') {
      promptParts.push(
        `[FieldOS Data Context]\n${JSON.stringify(context, null, 2)}\n\n` +
        'Please use this data to answer my question.'
      );
    }

    if (Array.isArray(conversation_history)) {
      for (const msg of conversation_history.slice(-6)) {
        const roleLabel = msg.role === 'user' ? 'Previous question' : 'Previous answer';
        promptParts.push(`[${roleLabel}]: ${msg.content || ''}`);
      }
    }

    promptParts.push(question);
    const fullPrompt = promptParts.join('\n\n');

    const startTime = Date.now();
    const answer = await runZAIChat(fullPrompt, ASK_SYSTEM);
    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      data: {
        answer: answer.trim(),
        processing_time_ms: elapsed,
        disclaimer: 'AI-generated response — verify information before acting.',
      },
      timestamp: Math.floor(Date.now() / 1000),
      disclaimer: 'AI-generated response — verify information before acting.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI assistant error';
    console.error('[Voice AI] Ask error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
