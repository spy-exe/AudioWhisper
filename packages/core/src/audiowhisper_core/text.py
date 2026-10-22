"""Accent- and case-insensitive text helpers shared by search, library filters and analytics."""
import unicodedata


def fold_text(value: str | None) -> str | None:
    """Fold for comparison: "Reunião" and "REUNIAO" become the same key."""
    if value is None:
        return None
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def fold_with_map(text: str) -> tuple[str, list[int]]:
    """Folded text plus, for each folded character, the index of the original character.

    Folding can change length (ligatures, "ß" -> "ss"), so positions found in the folded text are
    mapped back through this table instead of being reused directly on the original."""
    folded, positions = [], []
    for index, character in enumerate(text):
        for piece in fold_text(character):
            folded.append(piece)
            positions.append(index)
    return "".join(folded), positions


def find_folded(text: str, query: str) -> tuple[int, int] | None:
    """Original-text (start, end) span of the first accent-insensitive match, or None."""
    needle = fold_text(query.strip())
    if not needle:
        return None
    folded, positions = fold_with_map(text)
    at = folded.find(needle)
    if at < 0:
        return None
    return positions[at], positions[at + len(needle) - 1] + 1


def snippet(text: str, query: str, radius: int = 70) -> dict | None:
    """A short excerpt around the first match, cut at word boundaries."""
    span = find_folded(text, query)
    if span is None:
        return None
    start, end = span
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    if left > 0:
        space = text.find(" ", left, start)
        left = space + 1 if space != -1 else left
    if right < len(text):
        space = text.rfind(" ", end, right)
        right = space if space != -1 else right
    return {
        "before": ("…" if left > 0 else "") + text[left:start],
        "match": text[start:end],
        "after": text[end:right] + ("…" if right < len(text) else ""),
    }
