from datetime import datetime
from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    """Mixin that adds id, created_at, updated_at columns to models."""
    # These are overridden by actual mapped_column in concrete models
    pass
