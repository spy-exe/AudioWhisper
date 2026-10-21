from types import SimpleNamespace
import pytest
from audiowhisper_core.intelligence import EvidenceOutput, OllamaProvider, document_markdown, validate_evidence


def test_generated_actions_preserve_unknown_fields_and_reject_invented_citations():
    segments = [SimpleNamespace(id="s1", text="Precisamos revisar os backups amanhã.")]
    output = EvidenceOutput.model_validate({"items": [{"kind": "action", "text": "Revisar os backups", "source_segment_ids": ["s1"], "evidence_quotes": ["revisar os backups"], "assignee": "Ana", "due_date": "20/10"}]})
    result = validate_evidence(output, segments)
    assert result.items[0].assignee is None
    assert result.items[0].due_date is None
    output.items[0].source_segment_ids = ["inventado"]
    with pytest.raises(ValueError, match="referência"):
        validate_evidence(output, segments)


def test_mismatched_quotes_are_not_accepted():
    segments = [SimpleNamespace(id="s1", text="Podemos avaliar a proposta.")]
    output = EvidenceOutput.model_validate({"items": [{"kind": "decision", "text": "Aprovado", "source_segment_ids": ["s1"], "evidence_quotes": ["Aprovamos a proposta"]}]})
    with pytest.raises(ValueError, match="citação"):
        validate_evidence(output, segments)


def test_ollama_schema_only_allows_references_from_the_current_transcript(monkeypatch):
    segment = SimpleNamespace(id="7ecb619a-5ee5-4bc4-bd7d-77fda8ace8a3", text="Revisar os backups.", start=0, speaker_id=None)
    provider = OllamaProvider("http://localhost:11434")

    def respond(path, payload=None):
        if path == "/api/tags":
            return {"models": [{"name": "test:local"}]}
        schema = payload["format"]["$defs"]["EvidenceSelection"]["properties"]
        assert schema["source_segment_ids"]["items"]["enum"] == [segment.id]
        assert "evidence_quotes" not in schema
        return {"message": {"content": '{"items": [{"kind": "action", "text": "Revisar os backups", "source_segment_ids": ["' + segment.id + '"]}]}'}}

    monkeypatch.setattr(provider, "_request", respond)
    output = provider.generate("test:local", "actions", "", [segment], {})
    assert output.items[0].source_segment_ids == [segment.id]
    assert output.items[0].evidence_quotes == [segment.text]


def test_quotes_are_copied_from_exact_sources_instead_of_generated_by_the_model(monkeypatch):
    import json
    segments = [
        SimpleNamespace(id="s1", text=" Precisamos revisar os backups…\nsem perder os registros. ", start=0, speaker_id=None),
        SimpleNamespace(id="s2", text="Carlos prepara o relatório até sexta-feira.", start=3, speaker_id=None),
    ]
    provider = OllamaProvider("http://localhost:11434")
    monkeypatch.setattr(provider, "models", lambda: ["test:local"])
    monkeypatch.setattr(provider, "_request", lambda *args: {"message": {"content": json.dumps({"items": [{
        "kind": "action", "text": "Revisar backups e preparar relatório", "source_segment_ids": ["s1", "s2", "s1"],
        "assignee": "Carlos", "due_date": "sexta-feira",
    }]})}})
    item = provider.generate("test:local", "actions", "", segments, {}).items[0]
    assert item.source_segment_ids == ["s1", "s2"]
    assert item.evidence_quotes == [segment.text for segment in segments]
    assert (item.assignee, item.due_date) == ("Carlos", "sexta-feira")


def test_grounding_rejects_unknown_sources_even_if_model_bypasses_the_schema(monkeypatch):
    provider = OllamaProvider("http://localhost:11434")
    monkeypatch.setattr(provider, "models", lambda: ["test:local"])
    monkeypatch.setattr(provider, "_request", lambda *args: {"message": {"content": '{"items": [{"kind":"summary","text":"Uma afirmação","source_segment_ids":["inventado"]}]}'}})
    with pytest.raises(ValueError, match="referência"):
        provider.generate("test:local", "summary", "", [SimpleNamespace(id="s1", text="Fonte real", start=0, speaker_id=None)], {})


def test_many_short_segments_are_batched_by_full_payload_without_dropping_sources():
    from audiowhisper_core.intelligence import evidence_batches, evidence_source
    import json
    segments = [SimpleNamespace(id=f"{i:08d}-1111-2222-3333-444444444444", text="Sim.", start=i, speaker_id=None) for i in range(200)]
    batches = evidence_batches(segments, {})
    assert len(batches) > 1
    assert [segment.id for batch in batches for segment in batch] == [segment.id for segment in segments]
    for batch in batches:
        cost = sum(len(json.dumps(evidence_source(s, {}), ensure_ascii=False).encode("utf-8")) + len(json.dumps(s.id).encode("utf-8")) + 16 for s in batch)
        assert cost <= 14000


def test_readable_documents_use_timestamps_instead_of_internal_source_ids():
    source_id = "7ecb619a-5ee5-4bc4-bd7d-77fda8ace8a3"
    segment = SimpleNamespace(id=source_id, start=3712.9)
    items = [{"kind": "action", "text": "Revisar os backups", "source_segment_ids": [source_id], "assignee": None, "due_date": None}]
    markdown = document_markdown("actions", items, [segment])
    assert "Fontes: 01:01:52" in markdown
    assert source_id not in markdown
    assert "Não identificado na conversa" in markdown


@pytest.mark.parametrize("field,value", [("assignee", "Ana"), ("due_date", "20")])
def test_partial_words_or_numbers_do_not_establish_assignees_or_deadlines(field, value):
    segment = SimpleNamespace(id="s1", text="Precisamos de uma revisão semanal em 2026.")
    output = EvidenceOutput.model_validate({"items": [{
        "kind": "action", "text": "Revisar os backups", "source_segment_ids": ["s1"],
        "evidence_quotes": ["revisão semanal"], field: value,
    }]})
    validated = validate_evidence(output, [segment])
    assert getattr(validated.items[0], field) is None


def test_complete_assignees_and_literal_deadlines_are_preserved():
    segment = SimpleNamespace(id="s1", text="Ana vai revisar os backups até sexta-feira.")
    output = EvidenceOutput.model_validate({"items": [{
        "kind": "action", "text": "Revisar os backups", "source_segment_ids": ["s1"],
        "evidence_quotes": ["revisar os backups"], "assignee": "Ana", "due_date": "sexta-feira",
    }]})
    item = validate_evidence(output, [segment]).items[0]
    assert (item.assignee, item.due_date) == ("Ana", "sexta-feira")
