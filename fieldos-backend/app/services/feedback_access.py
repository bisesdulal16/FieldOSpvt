"""Feedback access + anonymity rules (PILOT_SCOPE_V2.md §7).

The load-bearing rule of the whole feedback-first thesis:

  * A **branch manager** sees the feedback body/category/branch but NOT who
    wrote it — so officers can flag their own manager's process honestly.
  * **Audit/Monitoring** and **Head Office** DO see the author (integrity /
    abuse control).

Enforcement lives HERE, in the serializer, not in the UI — a branch-manager
response must never carry `author_user_id`/`author_role`/author name, even by
accident. There is a test that asserts exactly this.

Also provides `department_can_see_identity()` and the scope predicate used by
the router to decide which feedback rows a viewer may list at all.
"""
from app.models.user import Department, DataScope


# Departments allowed to see the author's identity on feedback.
_IDENTITY_VISIBLE_DEPARTMENTS = {Department.AUDIT.value, Department.HEAD_OFFICE.value}


def department_can_see_identity(user) -> bool:
    """True iff this viewer's department may see WHO submitted feedback.

    Branch managers (operations) may not; audit + head_office may.
    Admin/IT is deliberately excluded — it is walled off from operational
    content entirely (it should not be listing feedback at all).
    """
    return getattr(user, "department", None) in _IDENTITY_VISIBLE_DEPARTMENTS


def serialize_feedback(fb, viewer, *, author_name: str | None = None) -> dict:
    """Serialize one Feedback row for `viewer`, applying the anonymity rule.

    When the viewer may NOT see identity, author_user_id / author_role /
    author_name are omitted entirely (not nulled-in-place-with-a-hint — omitted)
    and an `anonymous: True` flag is set so the UI can label it.
    """
    base = {
        "id": fb.id,
        "submitted_at": fb.submitted_at,
        "branch_id": fb.branch_id,
        "subject_type": fb.subject_type,
        "subject_ref": fb.subject_ref,
        "category": fb.category,
        "severity": fb.severity,
        "body_text": fb.body_text,
        "body_ne": fb.body_ne,
        "voice_note_ref": fb.voice_note_ref,
        "status": fb.status,
        "visibility_scope": fb.visibility_scope,
        "campaign_id": fb.campaign_id,
    }
    if department_can_see_identity(viewer):
        base["author_user_id"] = fb.author_user_id
        base["author_role"] = fb.author_role
        if author_name is not None:
            base["author_name"] = author_name
        base["anonymous"] = False
    else:
        # Branch-manager (and any non-identity dept) view: author stripped.
        base["anonymous"] = True
    return base


def viewer_scope_filter(viewer):
    """Return (scope, branch_id) describing which feedback `viewer` may list.

    - own    : only feedback they authored (field officers)
    - branch : all feedback in their branch (branch manager / operations)
    - org    : all feedback everywhere (audit, head_office)

    The router turns this into a SQLAlchemy WHERE clause. Kept as data (not a
    query) so it is unit-testable without a DB.
    """
    scope = getattr(viewer, "data_scope", DataScope.OWN.value)
    return scope, getattr(viewer, "branch_id", None)
