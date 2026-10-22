import csv
import io
import json
import zipfile
from urllib.parse import unquote

SEGMENTS = [
    ("Bom dia a todos.", 0.0, 2.0, {"speaker": "S1", "confidence": 0.91}),
    ("Use <b> & veja", 2.5, 4.0, {"speaker": "S2"}),
    ("   ", 4.0, 4.5),
    ("=SOMA(A1:A2)", 9.0, 10.0, {"speaker": "S1"}),
]


def _export(client, job_id, fmt, **options):
    created = client.post(f"/api/jobs/{job_id}/exports", json={"formats": [fmt], **options})
    assert created.status_code == 200, created.text
    return client.get(f"/api/exports/{created.json()[0]['id']}/download")


def test_subtitles_carry_speakers_skip_empty_cues_and_escape_vtt(client, make_completed_job):
    job = make_completed_job(SEGMENTS, speakers={"S1": "Ana", "S2": "Bruno <TI>"})
    srt = _export(client, job["job_id"], "srt").text
    assert "Ana: Bom dia a todos." in srt
    assert srt.count("-->") == 3
    assert srt.splitlines()[0] == "1" and "\n3\n" in srt
    vtt = _export(client, job["job_id"], "vtt").text
    assert "<v Bruno &lt;TI&gt;>Use &lt;b&gt; &amp; veja" in vtt
    assert vtt.count("-->") == 3
    plain = _export(client, job["job_id"], "srt", include_speakers=False).text
    assert "Ana:" not in plain and "Bom dia a todos." in plain


def test_txt_and_markdown_group_by_speaker_turn_and_include_bookmarks(client, make_completed_job):
    job = make_completed_job(SEGMENTS, speakers={"S1": "Ana", "S2": "Bruno"}, title="Comitê")
    client.post(f"/api/jobs/{job['job_id']}/bookmarks", json={"start": 2.5, "label": "Ponto-chave", "note": "rever"})
    txt = _export(client, job["job_id"], "txt").text
    assert txt.split("\n\n")[:2] == ["Ana: Bom dia a todos.", "Bruno: Use <b> & veja"]
    markdown = _export(client, job["job_id"], "markdown").text
    assert markdown.startswith("# Comitê")
    assert "## Marcadores" in markdown and "- **[00:00:02]** Ponto-chave · rever" in markdown
    assert "**[00:00:00] Ana:** Bom dia a todos." in markdown
    no_time = _export(client, job["job_id"], "markdown", include_timestamps=False).text
    assert "**Ana:** Bom dia a todos." in no_time


def test_json_and_csv_exports(client, make_completed_job):
    job = make_completed_job(SEGMENTS, speakers={"S1": "Ana"})
    client.post(f"/api/jobs/{job['job_id']}/bookmarks", json={"start": 9, "label": "Fórmula"})
    payload = _export(client, job["job_id"], "json").json()
    assert payload["speakers"] == {"S1": "Ana"}
    assert payload["segments"][0]["speaker"] == "Ana" and payload["segments"][1]["speaker"] == "S2"
    assert payload["bookmarks"][0]["label"] == "Fórmula"

    response = _export(client, job["job_id"], "csv")
    assert response.headers["content-type"].startswith("text/csv")
    assert response.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0] == ["indice", "inicio", "fim", "inicio_hhmmss", "falante", "texto", "confianca", "editado"]
    assert rows[1][:6] == ["0", "0.000", "2.000", "00:00:00", "Ana", "Bom dia a todos."]
    assert rows[1][6] == "0.910" and rows[1][7] == "não"
    assert rows[4][5] == "'=SOMA(A1:A2)"  # neutralized so spreadsheets don't evaluate it


def test_downloads_are_named_after_the_recording(client, make_completed_job):
    job = make_completed_job([("Texto", 0, 1)], title="Reunião de Orçamento: Q4/2026")
    response = _export(client, job["job_id"], "markdown")
    disposition = response.headers["content-disposition"]
    assert 'filename="Reuniao de Orcamento Q42026.md"' in disposition
    assert unquote(disposition.split("filename*=UTF-8''")[1]) == "Reuniao de Orcamento Q42026.md"
    untitled = make_completed_job([("Texto", 0, 1)], name="gravação final.mp3")
    assert 'filename="gravacao final.txt"' in _export(client, untitled["job_id"], "txt").headers["content-disposition"]


def test_bundle_zips_every_format_without_storing_exports(client, make_completed_job, settings):
    job = make_completed_job(SEGMENTS, speakers={"S1": "Ana"}, title="Pacote")
    response = client.get(f"/api/jobs/{job['job_id']}/exports/bundle")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="Pacote.zip"' in response.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert sorted(archive.namelist()) == sorted(f"Pacote.{ext}" for ext in ("pdf", "docx", "txt", "md", "json", "srt", "vtt", "csv"))
    assert archive.read("Pacote.pdf").startswith(b"%PDF")
    assert json.loads(archive.read("Pacote.json"))["segments"][0]["speaker"] == "Ana"
    assert not (settings.exports_dir / job["job_id"]).exists()

    subset = client.get(f"/api/jobs/{job['job_id']}/exports/bundle", params=[("formats", "srt"), ("formats", "srt"), ("formats", "csv")])
    assert sorted(zipfile.ZipFile(io.BytesIO(subset.content)).namelist()) == ["Pacote.csv", "Pacote.srt"]
    assert client.get(f"/api/jobs/{job['job_id']}/exports/bundle", params={"formats": "mp3"}).status_code == 422


def test_bundle_requires_text_and_an_existing_job(client, make_completed_job):
    empty = make_completed_job([])
    response = client.get(f"/api/jobs/{empty['job_id']}/exports/bundle")
    assert response.status_code == 409
    assert client.get("/api/jobs/nao-existe/exports/bundle").status_code == 404


def test_export_request_validation(client, make_completed_job):
    job = make_completed_job([("Texto", 0, 1)])
    assert client.post(f"/api/jobs/{job['job_id']}/exports", json={"formats": []}).status_code == 422
    assert client.post(f"/api/jobs/{job['job_id']}/exports", json={"formats": ["exe"]}).status_code == 422
    deduped = client.post(f"/api/jobs/{job['job_id']}/exports", json={"formats": ["txt", "txt"]})
    assert len(deduped.json()) == 1


def test_pdf_and_docx_render_accented_titles(client, make_completed_job):
    job = make_completed_job([("Ação imediata — revisão", 0, 1)], title="Ata · São Paulo")
    pdf = _export(client, job["job_id"], "pdf")
    assert pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
    docx = _export(client, job["job_id"], "docx")
    assert zipfile.ZipFile(io.BytesIO(docx.content)).read("word/document.xml").decode().count("Ação imediata") == 1
