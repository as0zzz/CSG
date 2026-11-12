"""Initial prototype schema."""
from alembic import op
from app.db import Base
from app import models  # noqa

revision = '001'
down_revision = None


def upgrade():
    op.execute('CREATE EXTENSION IF NOT EXISTS postgis')
    Base.metadata.create_all(bind=op.get_bind())


def downgrade():
    Base.metadata.drop_all(bind=op.get_bind())
