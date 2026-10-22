"""Conversation analytics computed only from persisted segments: nothing is estimated or inferred."""
import json
import re
from collections import Counter, defaultdict

from audiowhisper_core.text import fold_text

DEFAULT_LOW_CONFIDENCE = 0.6
_WORD = re.compile(r"\w+(?:[-'’]\w+)*", re.UNICODE)

_STOPWORDS_PT = """
a à ao aos as às até com como da das de dela dele deles do dos e é ela elas ele eles em entre era essa
esse esta está estão este eu foi for há isso isto já la lá lhe mais mas me mesmo meu minha muito na
nas não nem no nos nós num numa o os ou para pela pelas pelo pelos por porque pra qual quando que quem
se sem ser seu sua são só também te tem têm tinha tu tua um uma umas uns vai você vocês vou né tá aí
então assim aqui ali gente coisa tipo bem bom boa sim agora ainda depois antes onde sobre cada todo toda
todos todas outro outra outros outras ter fazer faz feito vamos vai vão pode posso podemos acho sei
estava estou estamos ser sendo foram será seria tudo nada algo alguém dá dar ver vê ficar fica
""".split()
_STOPWORDS_EN = """
a an and are as at be been but by can could did do does for from had has have he her his how i if in
into is it its just like me my no not of on or our she so some than that the their them then there
these they this to too up us was we were what when where which who will with would you your yeah okay
ok um uh oh know think going get got really right well also about all any been more one out very
""".split()
STOPWORDS = frozenset(fold_text(word) for word in _STOPWORDS_PT + _STOPWORDS_EN)


def words_in(text: str) -> list[str]:
    return _WORD.findall(text or "")


def _union_seconds(intervals: list[tuple[float, float]]) -> float:
    total, current_start, current_end = 0.0, None, None
    for start, end in sorted(intervals):
        if current_end is None or start > current_end:
            if current_end is not None:
                total += current_end - current_start
            current_start, current_end = start, end
        else:
            current_end = max(current_end, end)
    if current_end is not None:
        total += current_end - current_start
    return total


def _word_probabilities(segment) -> list[float]:
    raw = getattr(segment, "words_json", None)
    if not raw:
        return []
    try:
        return [w["probability"] for w in json.loads(raw) if w.get("probability") is not None]
    except (ValueError, TypeError, KeyError):
        return []


def keywords(segments, limit: int = 12) -> list[dict]:
    counts: Counter[str] = Counter()
    spellings: dict[str, Counter[str]] = defaultdict(Counter)
    for segment in segments:
        for word in words_in(segment.text):
            key = fold_text(word)
            if len(key) < 3 or key.isdigit() or key in STOPWORDS:
                continue
            counts[key] += 1
            spellings[key][word if word.isupper() and len(word) > 1 else word.lower()] += 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    return [{"term": spellings[key].most_common(1)[0][0], "count": count} for key, count in ranked if count > 1]


def transcript_stats(segments, speakers: dict | None = None, duration_seconds: float | None = None,
                     threshold: float = DEFAULT_LOW_CONFIDENCE, buckets: int = 48) -> dict:
    segments = sorted(segments, key=lambda s: (s.start, getattr(s, "segment_index", 0)))
    speakers = speakers or {}
    duration = max(duration_seconds or 0.0, max((s.end for s in segments), default=0.0))
    intervals = [(float(s.start), float(max(s.end, s.start))) for s in segments]
    speech_seconds = _union_seconds(intervals)
    word_counts = [len(words_in(s.text)) for s in segments]
    word_count = sum(word_counts)

    per_speaker: dict[str | None, dict] = {}
    runs: list[dict] = []
    for segment, words in zip(segments, word_counts):
        length = max(0.0, segment.end - segment.start)
        entry = per_speaker.setdefault(segment.speaker_id, {"segments": 0, "words": 0, "speech_seconds": 0.0})
        entry["segments"] += 1
        entry["words"] += words
        entry["speech_seconds"] += length
        if runs and runs[-1]["speaker_id"] == segment.speaker_id:
            runs[-1]["end"] = max(runs[-1]["end"], segment.end)
        else:
            runs.append({"speaker_id": segment.speaker_id, "start": segment.start, "end": segment.end})
    assigned_total = sum(entry["speech_seconds"] for entry in per_speaker.values()) or 1.0
    longest_by_speaker: dict[str | None, float] = defaultdict(float)
    for run in runs:
        longest_by_speaker[run["speaker_id"]] = max(longest_by_speaker[run["speaker_id"]], run["end"] - run["start"])
    speaker_rows = []
    for speaker_id, entry in per_speaker.items():
        minutes = entry["speech_seconds"] / 60
        speaker_rows.append({
            "speaker_id": speaker_id,
            "name": speakers.get(speaker_id, speaker_id) if speaker_id else "Não identificado",
            "segments": entry["segments"],
            "words": entry["words"],
            "speech_seconds": round(entry["speech_seconds"], 2),
            "share": round(entry["speech_seconds"] / assigned_total, 4),
            "longest_turn_seconds": round(longest_by_speaker[speaker_id], 2),
            "words_per_minute": round(entry["words"] / minutes, 1) if minutes > 0 else None,
        })
    speaker_rows.sort(key=lambda row: (-row["speech_seconds"], row["name"]))
    longest = max(runs, key=lambda run: run["end"] - run["start"], default=None)

    low = [s for s in segments if s.confidence is not None and s.confidence < threshold]
    probabilities = [p for s in segments for p in _word_probabilities(s)]

    activity: list[float] = []
    bucket_seconds = 0.0
    if duration > 0:
        count = max(1, min(buckets, int(duration)))
        bucket_seconds = duration / count
        covered = [0.0] * count
        for start, end in intervals:
            first = min(count - 1, int(start / bucket_seconds))
            last = min(count - 1, int(end / bucket_seconds))
            for index in range(first, last + 1):
                lo, hi = index * bucket_seconds, (index + 1) * bucket_seconds
                covered[index] += max(0.0, min(end, hi) - max(start, lo))
        activity = [round(min(1.0, value / bucket_seconds), 3) for value in covered]

    speech_minutes = speech_seconds / 60
    return {
        "segment_count": len(segments),
        "word_count": word_count,
        "duration_seconds": round(duration, 2),
        "speech_seconds": round(speech_seconds, 2),
        "silence_seconds": round(max(0.0, duration - speech_seconds), 2),
        "words_per_minute": round(word_count / speech_minutes, 1) if speech_minutes > 0 else None,
        "speaker_turns": max(0, len(runs) - 1) if any(s.speaker_id for s in segments) else 0,
        "speakers": speaker_rows,
        "longest_turn": {
            "speaker_id": longest["speaker_id"],
            "name": speakers.get(longest["speaker_id"], longest["speaker_id"]) if longest["speaker_id"] else "Não identificado",
            "start": longest["start"], "end": longest["end"],
            "seconds": round(longest["end"] - longest["start"], 2),
        } if longest else None,
        "questions": sum(1 for s in segments if s.text.strip().endswith("?")),
        "low_confidence": {
            "threshold": threshold,
            "segments": len(low),
            "segment_ids": [s.id for s in low[:200]],
            "words": sum(1 for p in probabilities if p < threshold),
            "words_total": len(probabilities),
        },
        "keywords": keywords(segments),
        "activity": activity,
        "activity_bucket_seconds": round(bucket_seconds, 3),
    }
