"""Add transcript bookmarks (Studio 2.1)."""
from alembic import op
import sqlalchemy as sa

revision = "f3b021"
down_revision = "e2a010"
branch_labels = None
depends_on = None


def upgrade():
    # Explicit columns, never the live model metadata: a later model change must not alter what
    # this revision creates (e2a010 builds its tables from the models, so it can't be reused here).
    if "bookmarks" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "bookmarks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("transcription_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("segment_id", sa.String(36), sa.ForeignKey("transcript_segments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("start", sa.Float(), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("color", sa.String(16), nullable=False, server_default="amber"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bookmarks_job_id", "bookmarks", ["job_id"])


def downgrade():
    op.drop_index("ix_bookmarks_job_id", table_name="bookmarks")
    op.drop_table("bookmarks")
