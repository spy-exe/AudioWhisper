"""Add Studio workspace, local intelligence and recoverable live sessions."""
from alembic import op
import sqlalchemy as sa

revision = "e2a010"
down_revision = "cbd483f45ca8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("transcript_segments", sa.Column("speaker_id", sa.String(64), nullable=True))
    # The metadata is shared with the worker, so these additive tables have one owner.
    from audiowhisper_core.models import WorkspaceItem, AIDocument, DocumentShare, DocumentDelivery, LiveSession, LiveChunk
    for model in (WorkspaceItem, AIDocument, DocumentShare, DocumentDelivery, LiveSession, LiveChunk):
        model.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for table in ("live_chunks", "live_sessions", "document_deliveries", "document_shares", "ai_documents", "workspace_items"):
        op.drop_table(table)
    op.drop_column("transcript_segments", "speaker_id")
