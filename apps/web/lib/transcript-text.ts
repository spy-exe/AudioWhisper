export function replaceTranscriptText(text: string, query: string, replacement: string) {
  if (!query) return text;
  const escaped = Array.from(query, (character) => "\\^$.*+?()[]{}|".includes(character) ? "\\" + character : character).join("");
  return text.replace(new RegExp(escaped, "gi"), () => replacement);
}
