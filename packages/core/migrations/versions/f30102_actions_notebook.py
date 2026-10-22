"""Durable actions and source-linked notebook entries."""
from alembic import op
import sqlalchemy as sa

revision = "f30102"
down_revision = "f30101"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("action_tasks",
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text(), nullable=False), sa.Column("project", sa.String(128), nullable=False, index=True),
        sa.Column("status", sa.String(16), nullable=False, index=True), sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("assignee", sa.String(256)), sa.Column("due_date", sa.String(10)), sa.Column("due_label", sa.String(256)),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("transcription_jobs.id", ondelete="SET NULL")),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("ai_documents.id", ondelete="SET NULL")),
        sa.Column("import_key", sa.String(96), unique=True), sa.Column("sources_json", sa.Text(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False), sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("notebook_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("transcription_jobs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("title", sa.String(512), nullable=False), sa.Column("body", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False), sa.Column("sources_json", sa.Text(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False), sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("notebook_entries")
    op.drop_table("action_tasks")
