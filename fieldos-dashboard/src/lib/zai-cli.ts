import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Extracts a JSON object from stdout that may contain
 * non-JSON prefix/suffix lines (e.g. CLI initialization messages).
 * Finds the outermost `{ ... }` block and parses it.
 */
function extractJSON(stdout: string): Record<string, unknown> | null {
  const jsonStart = stdout.indexOf('{');
  const jsonEnd = stdout.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  const jsonStr = stdout.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Runs `z-ai chat` CLI and returns the assistant's content string.
 * Handles CLI initialization messages prepended to stdout.
 */
export async function runZAIChat(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const result = await execFileAsync(
    'z-ai',
    ['chat', '--prompt', prompt, '--system', systemPrompt],
    { maxBuffer: 1024 * 1024, timeout: 60000 }
  );

  const data = extractJSON(result.stdout);
  if (data) {
    const choices = data.choices as Array<{
      message?: { content?: string };
    }> | undefined;
    return choices?.[0]?.message?.content || '';
  }

  // Fallback: return trimmed stdout if JSON extraction failed
  return result.stdout.trim();
}

/**
 * Runs `z-ai asr` CLI and returns the transcribed text string.
 * Handles CLI initialization messages prepended to stdout.
 */
export async function runZAIASR(audioBase64: string): Promise<string> {
  const result = await execFileAsync(
    'z-ai',
    ['asr', '--base64', audioBase64],
    { maxBuffer: 1024 * 1024, timeout: 60000 }
  );

  const data = extractJSON(result.stdout);
  if (data) {
    return (data.text as string) || '';
  }

  // Fallback: return trimmed stdout if JSON extraction failed
  return result.stdout.trim();
}
