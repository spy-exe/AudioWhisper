from types import SimpleNamespace

import pytest

from audiowhisper_core.document_exports import document_blocks, inline_runs
from audiowhisper_core.exports import safe_filename_stem
from audiowhisper_core.schemas import SegmentUpdateIn, TranscriptionSettingsIn
from audiowhisper_core.stats import keywords, transcript_stats, words_in
from audiowhisper_core.text import find_folded, fold_text, fold_with_map, snippet


def seg(text, start, end, speaker=None, confidence=0.9, words_json=None, id=None, index=0):
    return SimpleNamespace(id=id or f"{start}-{end}", text=text, start=start, end=end, speaker_id=speaker,
                           confidence=confidence, words_json=words_json, segment_index=index)


@pytest.mark.parametrize("raw,expected", [("Reunião", "reuniao"), ("AÇÃO", "acao"), ("Straße", "strasse"),
                                          ("ﬁnal", "final"), ("", ""), (None, None)])
def test_fold_text(raw, expected):
    assert fold_text(raw) == expected


def test_matches_map_back_to_the_original_text_even_when_folding_changes_length():
    text = "A Straße de São Paulo"
    folded, positions = fold_with_map(text)
    assert len(folded) == len(positions) and folded.startswith("a strasse")
    start, end = find_folded(text, "sao paulo")
    assert text[start:end] == "São Paulo"
    start, end = find_folded(text, "STRASSE")
    assert text[start:end] == "Straße"
    assert find_folded(text, "   ") is None and find_folded(text, "lisboa") is None


def test_snippets_cut_at_word_boundaries_with_ellipses():
    text = " ".join(f"palavra{i}" for i in range(40)) + " orçamento aprovado " + " ".join(f"fim{i}" for i in range(40))
    result = snippet(text, "ORCAMENTO", radius=30)
    assert result["match"] == "orçamento"
    assert result["before"].startswith("…") and result["after"].endswith("…")
    assert not result["before"][1:].startswith(" ") and "palavra" in result["before"]
    assert snippet("curto orçamento", "orcamento") == {"before": "curto ", "match": "orçamento", "after": ""}
    assert snippet("nada", "x") is None


def test_words_keywords_and_stopwords():
    assert words_in("Ex-diretora d'água, 3 vezes!") == ["Ex-diretora", "d'água", "3", "vezes"]
    result = keywords([seg("O backup do servidor falhou; o backup volta amanhã.", 0, 1),
                       seg("API e Backup: a API caiu também. 2026 2026", 1, 2)])
    assert result[:2] == [{"term": "backup", "count": 3}, {"term": "API", "count": 2}]
    assert all(entry["count"] > 1 for entry in result)
    assert not any(entry["term"] in ("que", "the", "2026") for entry in result)


def test_transcript_stats_measure_only_what_was_said():
    segments = [
        seg("Bom dia, tudo bem?", 0, 4, "A", 0.95, '[{"word": "Bom", "start": 0, "end": 1, "probability": 0.3}]', "s1", 0),
        seg("Tudo ótimo, vamos começar.", 4, 10, "B", 0.5, None, "s2", 1),
        seg("Primeiro item é o orçamento.", 10, 14, "A", 0.8, None, "s3", 2),
        seg("Concordo.", 13, 15, "A", None, None, "s4", 3),
    ]
    stats = transcript_stats(segments, {"A": "Ana"}, duration_seconds=30, threshold=0.6, buckets=6)
    assert stats["segment_count"] == 4 and stats["word_count"] == 14
    assert stats["speech_seconds"] == 15 and stats["silence_seconds"] == 15 and stats["duration_seconds"] == 30
    assert stats["words_per_minute"] == 56.0
    assert stats["questions"] == 1 and stats["speaker_turns"] == 2
    ana, bruno = stats["speakers"]
    assert (ana["name"], ana["segments"], ana["words"], ana["speech_seconds"]) == ("Ana", 3, 10, 10)
    assert bruno["name"] == "B" and bruno["share"] == round(6 / 16, 4)
    assert ana["longest_turn_seconds"] == 5
    assert stats["longest_turn"]["speaker_id"] == "B" and stats["longest_turn"]["seconds"] == 6
    assert stats["low_confidence"] == {"threshold": 0.6, "segments": 1, "segment_ids": ["s2"], "words": 1, "words_total": 1}
    assert len(stats["activity"]) == 6 and stats["activity_bucket_seconds"] == 5
    assert stats["activity"][:3] == [1.0, 1.0, 1.0] and stats["activity"][3:] == [0, 0, 0]


def test_stats_handle_empty_and_unassigned_transcripts():
    empty = transcript_stats([], {}, None)
    assert empty["word_count"] == 0 and empty["words_per_minute"] is None and empty["longest_turn"] is None
    assert empty["activity"] == [] and empty["speakers"] == []
    unassigned = transcript_stats([seg("Sem falante", 0, 2)], {}, 2)
    assert unassigned["speakers"][0]["name"] == "Não identificado" and unassigned["speaker_turns"] == 0
    broken_words = transcript_stats([seg("x", 0, 1, words_json="não é json")], {}, 1)
    assert broken_words["low_confidence"]["words_total"] == 0


@pytest.mark.parametrize("title,expected", [
    ("Reunião: Q4/2026", "Reuniao Q42026"), ("gravação.mp3", "gravacao"), ("../../etc/passwd", "etcpasswd"),
    ("Plano v2.1 final", "Plano v2.1 final"), ("", "transcricao"), (None, "transcricao"), ("???", "transcricao"),
    ("a" * 200, "a" * 80),
])
def test_safe_filename_stem(title, expected):
    assert safe_filename_stem(title) == expected


def test_document_blocks_turn_tables_and_bold_into_structure():
    blocks = document_blocks("# Título\n\n| Campo | Valor |\n|---|---|\n| Idioma | pt |\n\n## Seção\n- **[00:01]** item\ntexto")
    assert blocks == [("title", "Título"), ("blank", ""), ("field", "**Idioma:** pt"), ("blank", ""),
                      ("heading", "Seção"), ("bullet", "**[00:01]** item"), ("paragraph", "texto")]
    assert inline_runs("**A** e **B**!") == [("A", True), (" e ", False), ("B", True), ("!", False)]
    assert inline_runs("sem negrito") == [("sem negrito", False)]


def test_transcription_settings_normalization():
    settings = TranscriptionSettingsIn(model_name="small", language="  ", initial_prompt="  nomes:\n Ana ", hotwords="")
    assert settings.language is None and settings.initial_prompt == "nomes: Ana" and settings.hotwords is None
    assert TranscriptionSettingsIn(model_name="small", language="pt-BR").language == "pt-BR"
    assert TranscriptionSettingsIn().model_dump()["device"] == "cuda"
    with pytest.raises(ValueError):
        TranscriptionSettingsIn(language=12)
    with pytest.raises(ValueError):
        SegmentUpdateIn(text="x", start=5, end=4)
    assert SegmentUpdateIn(text="x", start=4).end is None
