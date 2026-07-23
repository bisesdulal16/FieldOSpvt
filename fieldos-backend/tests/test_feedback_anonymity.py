"""Anonymity invariant for hierarchical feedback (PILOT_SCOPE_V2.md §7).

THE RULE UNDER TEST: a branch manager must NEVER receive the author's identity
on a feedback item; audit and head_office must. This is the whole reason
feedback-first has value (officers can flag their own manager honestly), so it
gets a dedicated, DB-free unit test on the serializer itself.
"""
from types import SimpleNamespace

from app.models.user import Department, DataScope
from app.services.feedback_access import (
    serialize_feedback,
    department_can_see_identity,
    viewer_scope_filter,
)

# Author-identifying keys that must never leak to a non-privileged viewer.
IDENTITY_KEYS = {"author_user_id", "author_role", "author_name"}


def _fb():
    return SimpleNamespace(
        id=1, submitted_at="2026-07-23T10:00:00+05:45", branch_id=1,
        subject_type="tool", subject_ref="collect_screen", category="time_sink",
        severity=4, body_text="Too many taps", body_ne=None, voice_note_ref=None,
        status="open", visibility_scope="branch", campaign_id=None,
        author_user_id=42, author_role="field_officer",
    )


def _viewer(dept, scope=DataScope.BRANCH.value, branch_id=1):
    return SimpleNamespace(department=dept, data_scope=scope, branch_id=branch_id)


def test_branch_manager_never_sees_author():
    out = serialize_feedback(_fb(), _viewer(Department.OPERATIONS.value),
                             author_name="Ram Bahadur Shah")
    # Not present at all — omitted, not nulled.
    assert IDENTITY_KEYS.isdisjoint(out.keys()), f"identity leaked: {out}"
    assert out["anonymous"] is True
    # ...but the substance is still there — the manager can act on it.
    assert out["body_text"] == "Too many taps"
    assert out["category"] == "time_sink"


def test_audit_sees_author():
    out = serialize_feedback(_fb(), _viewer(Department.AUDIT.value, DataScope.ORG.value),
                             author_name="Ram Bahadur Shah")
    assert out["author_user_id"] == 42
    assert out["author_role"] == "field_officer"
    assert out["author_name"] == "Ram Bahadur Shah"
    assert out["anonymous"] is False


def test_head_office_sees_author():
    out = serialize_feedback(_fb(), _viewer(Department.HEAD_OFFICE.value, DataScope.ORG.value))
    assert out["author_user_id"] == 42
    assert out["anonymous"] is False


def test_admin_it_is_not_identity_privileged():
    # admin_it is walled off from operational content; if it ever sees feedback,
    # it must NOT be an identity-privileged viewer.
    assert department_can_see_identity(_viewer(Department.ADMIN_IT.value)) is False


def test_can_see_identity_predicate():
    assert department_can_see_identity(_viewer(Department.AUDIT.value)) is True
    assert department_can_see_identity(_viewer(Department.HEAD_OFFICE.value)) is True
    assert department_can_see_identity(_viewer(Department.OPERATIONS.value)) is False


def test_scope_filter_shape():
    scope, branch_id = viewer_scope_filter(_viewer(Department.OPERATIONS.value,
                                                   DataScope.BRANCH.value, branch_id=7))
    assert scope == "branch" and branch_id == 7
    scope, _ = viewer_scope_filter(_viewer(Department.AUDIT.value, DataScope.ORG.value))
    assert scope == "org"
