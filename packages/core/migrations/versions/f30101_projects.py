"""Project context, preserving existing workspace names."""
from alembic import op
import sqlalchemy as sa

revision = "f30101"
down_revision = "e2a010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("projects", sa.Column("name", sa.String(128), primary_key=True),
                    sa.Column("description", sa.Text(), nullable=False), sa.Column("color", sa.String(16), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.execute("INSERT INTO projects (name, description, color, created_at, updated_at) "
               "SELECT DISTINCT project, '', 'blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM workspace_items WHERE project != ''")


def downgrade():
    op.drop_table("projects")
