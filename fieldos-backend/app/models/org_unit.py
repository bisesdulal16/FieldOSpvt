from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import String, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class OrgUnitType(str, PyEnum):
    """The geographic axis of the org matrix (see PILOT_SCOPE_V2.md §2).

    `region` exists in the schema so the CBS join-key grammar
    (branch.center.group.member) parses cleanly later, but the pilot seeds
    only ho -> branch -> center (no region tier — decision 2026-07-23).
    """
    HO = "ho"
    REGION = "region"
    BRANCH = "branch"
    CENTER = "center"


class OrgUnit(Base):
    """A node in the geographic org tree.

    This is what lets an audit/head_office user with `data_scope=org|region`
    resolve to a real subtree of branches/centers, rather than the single
    `User.branch_id` FK which only expresses "sits at one branch".

    `code` mirrors the CBS `.`-delimited join key (branch.center.group.member)
    so importing CBS reports can BUILD this tree instead of hand-entering it.
    A branch node carries code "9999", a center "9999.999", etc.
    """
    __tablename__ = "org_units"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default=OrgUnitType.BRANCH.value)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_ne: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # CBS `.`-delimited join key for this node (e.g. branch "0042", center "0042.001").
    # Unique so an import upsert can match on it. Nullable for hand-created HO roots.
    code: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("org_units.id"), nullable=True, index=True)
    # Link a branch-type OrgUnit back to the existing Branch row when one exists,
    # so we don't fork "branch" into two tables. Nullable: HO/center nodes have none.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)

    parent = relationship("OrgUnit", remote_side=[id], back_populates="children")
    children = relationship("OrgUnit", back_populates="parent")
