"""Add behavioral sessions and append-only events without changing existing works."""
from alembic import op
from app.models import TraceSession, TraceEvent

revision = '002'
down_revision = '001'


def upgrade():
    TraceSession.__table__.create(bind=op.get_bind(), checkfirst=True)
    TraceEvent.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    TraceEvent.__table__.drop(bind=op.get_bind(), checkfirst=True)
    TraceSession.__table__.drop(bind=op.get_bind(), checkfirst=True)
