"""Hierarchical feedback — the pilot's star feature (PILOT_SCOPE_V2.md §3).

Feedback is submitted against a real thing (a tool/task/client/process), then
rolls UP the org hierarchy: officer -> branch manager / monitoring -> head office.
`FeedbackEvent` is the append-only trail (created/ack/escalated/status_change).

Timestamps are stored as ISO strings at seconds precision (String(30)) to match
the codebase's Postgres-safe convention — use the nepal_time helpers to fill them.
"""
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import String, Integer, Text, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SubjectType(str, PyEnum):
    TOOL = "tool"          # a screen/module/app the feedback is about
    TASK = "task"          # a specific task/workflow
    CLIENT = "client"      # something about a member/client
    PROCESS = "process"    # an operational process
    GENERAL = "general"


class FeedbackCategory(str, PyEnum):
    BUG = "bug"
    TIME_SINK = "time_sink"    # the headline signal for the consolidation thesis
    REQUEST = "request"
    PRAISE = "praise"
    BLOCKER = "blocker"


class FeedbackStatus(str, PyEnum):
    OPEN = "open"
    ACK = "ack"
    IN_REVIEW = "in_review"
    RESOLVED = "resolved"
    WONT_FIX = "wont_fix"


class VisibilityScope(str, PyEnum):
    BRANCH = "branch"        # visible within the author's branch
    UP_CHAIN = "up_chain"    # escalated — visible to the parent in the ops chain
    ORG = "org"              # org-wide (campaign answers, HO-directed)


class FeedbackEventAction(str, PyEnum):
    CREATED = "created"
    ACK = "ack"
    COMMENTED = "commented"
    ESCALATED = "escalated"
    STATUS_CHANGE = "status_change"
    ROUTED = "routed"


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Nepal-time submission stamp (business date/time). String per CLAUDE.md convention.
    submitted_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    author_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    author_role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Denormalized for fast branch rollup (§3) — the author's branch at submit time.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)

    subject_type: Mapped[str] = mapped_column(String(20), nullable=False, default=SubjectType.GENERAL.value)
    subject_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)  # which module/app/task
    category: Mapped[str] = mapped_column(String(20), nullable=False, default=FeedbackCategory.REQUEST.value)
    severity: Mapped[int] = mapped_column(Integer, nullable=False, default=3)  # 1..5

    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_ne: Mapped[str | None] = mapped_column(Text, nullable=True)
    voice_note_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=FeedbackStatus.OPEN.value)
    visibility_scope: Mapped[str] = mapped_column(String(20), nullable=False, default=VisibilityScope.BRANCH.value)

    # Optional link to a campaign this feedback answers (§B9). Nullable = spontaneous.
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("feedback_campaigns.id"), nullable=True)

    events = relationship("FeedbackEvent", back_populates="feedback",
                          order_by="FeedbackEvent.id", cascade="all, delete-orphan")


class FeedbackEvent(Base):
    """Append-only audit/rollup trail for a Feedback item (§3)."""
    __tablename__ = "feedback_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    at: Mapped[str | None] = mapped_column(String(30), nullable=True)  # nepal-time
    feedback_id: Mapped[int] = mapped_column(ForeignKey("feedback.id"), nullable=False, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # For ROUTED/ESCALATED: who/what it was routed to (a user id or role).
    routed_to: Mapped[str | None] = mapped_column(String(60), nullable=True)

    feedback = relationship("Feedback", back_populates="events")


class FeedbackCampaign(Base):
    """A prompt HO pushes down a level; answers aggregate by position (§B9).

    Built here (not later) because it's the clearest demo of the feedback-first
    thesis. Answers are just Feedback rows with campaign_id set.
    """
    __tablename__ = "feedback_campaigns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_ne: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Which role level the campaign targets (e.g. "field_officer"). Null = everyone.
    target_role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_open: Mapped[bool] = mapped_column(default=True, nullable=False)
    opened_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    closed_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
