"""Durable knowledge requests, recipes and indexed transcript retrieval."""
from alembic import op
import sqlalchemy as sa

revision = "f30103"
down_revision = "f30102"
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False)]


def upgrade():
    op.create_table("knowledge_questions",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("question", sa.Text(), nullable=False),
        sa.Column("project", sa.String(128), nullable=False, index=True), sa.Column("job_ids_json", sa.Text(), nullable=False),
        sa.Column("model", sa.String(128), nullable=False), sa.Column("status", sa.String(16), nullable=False),
        sa.Column("sources_json", sa.Text(), nullable=False), sa.Column("items_json", sa.Text(), nullable=False),
        sa.Column("retrieval_count", sa.Integer(), nullable=False), sa.Column("error", sa.Text()), *timestamps())
    op.create_table("document_recipes",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("name", sa.String(128), nullable=False),
        sa.Column("project", sa.String(128), nullable=False, index=True), sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("model", sa.String(128), nullable=False), sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("automatic", sa.Boolean(), nullable=False), sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False), *timestamps())
    op.create_table("recipe_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("recipe_id", sa.String(36), sa.ForeignKey("document_recipes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("transcription_jobs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("ai_documents.id", ondelete="SET NULL")),
        sa.Column("payload_json", sa.Text(), nullable=False), sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error", sa.Text()), sa.UniqueConstraint("recipe_id", "job_id", name="uq_recipe_job"), *timestamps())
    op.execute("CREATE VIRTUAL TABLE transcript_search USING fts5(segment_id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')")
    op.execute("INSERT INTO transcript_search(segment_id, text) SELECT id, text FROM transcript_segments")
    op.execute("CREATE TRIGGER transcript_search_insert AFTER INSERT ON transcript_segments BEGIN INSERT INTO transcript_search(segment_id,text) VALUES(new.id,new.text); END")
    op.execute("CREATE TRIGGER transcript_search_delete AFTER DELETE ON transcript_segments BEGIN DELETE FROM transcript_search WHERE segment_id=old.id; END")
    op.execute("CREATE TRIGGER transcript_search_update AFTER UPDATE OF text ON transcript_segments BEGIN DELETE FROM transcript_search WHERE segment_id=old.id; INSERT INTO transcript_search(segment_id,text) VALUES(new.id,new.text); END")


def downgrade():
    for trigger in ("insert", "delete", "update"):
        op.execute(f"DROP TRIGGER transcript_search_{trigger}")
    op.execute("DROP TABLE transcript_search")
    for name in ("recipe_runs", "document_recipes", "knowledge_questions"):
        op.drop_table(name)
