import json
import re
import unicodedata

from sqlalchemy import Float, String, select, text
from sqlalchemy.exc import IntegrityError

from audiowhisper_core.models import RecipeRun


def normalized_words(value):
    value = "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))
    return re.findall(r"\w+", value)


def indexed_matches(query, question=False):
    if question:
        stop = set("a o as os de da do das dos e em um uma que quem como qual quais quando onde foi foram sobre para por se ao aos na no nas nos com ou houve decidido decidiu decisao decisoes resuma resumo principais explique mostre me".split())
        words = [word for word in dict.fromkeys(normalized_words(query)) if len(word) > 1 and word not in stop][:20]
        expression = " OR ".join('"' + word.replace('"', '""') + '"' for word in words)
    else:
        expression = '"' + query.strip().replace('"', '""') + '"*'
    if not expression or not normalized_words(query):
        return None
    return text("SELECT segment_id, bm25(transcript_search) AS rank FROM transcript_search WHERE transcript_search MATCH :expression").bindparams(
        expression=expression).columns(segment_id=String, rank=Float).subquery()


def ensure_recipe_run(db, recipe, job_id):
    run = db.scalar(select(RecipeRun).where(RecipeRun.recipe_id == recipe.id, RecipeRun.job_id == job_id))
    if run:
        return run, False
    payload = {key: getattr(recipe, key) for key in ("name", "kind", "model", "instruction")}
    try:
        with db.begin_nested():
            run = RecipeRun(recipe_id=recipe.id, job_id=job_id, payload_json=json.dumps(payload, ensure_ascii=False))
            db.add(run)
            db.flush()
        return run, True
    except IntegrityError:
        return db.scalar(select(RecipeRun).where(RecipeRun.recipe_id == recipe.id, RecipeRun.job_id == job_id)), False
