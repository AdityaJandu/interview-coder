export function normalizeMCQAnswer(answerText: string): string[] {
  const cleaned = answerText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 0 ? [cleaned] : [];
}
