# Retained library records and generated versions

> Document version: ADR
> Status: Accepted — user rulings (2026-10-08)
> Scope: N5 local-file removal and managed re-download

Deleting selected VUA-managed local files keeps the BOOTH catalog entry, warehouse/copy
identities, provenance observations and saved Recipe/selection-draft references. The library
shows missing files; a later managed re-download can restore the same copy identity. Removal
of a catalog record is a separate operation and is not authorized by a local-file deletion.

Show the actual selected physical files and affected saved references before asking the user
to confirm deletion. Failed or unreadable reference queries are not evidence of no references.
Unresolved reference shapes remain explicit. Partial results and interrupted operations stay
visible, and interrupted deletion never resumes implicitly.

When a managed re-download changes an original's content fingerprint, keep earlier generated
VPM files and mark them as superseded. They do not prove generation from the new original;
the current original needs a new generation. An unchanged fingerprint does not invalidate
the generated output. Existing documents, approved plans and content-pinned references are
not automatically rewritten. Recipe v0.3 entry references and content-pinned production
records remain distinct; this ruling does not invent a final Recipe format.

Implementation: [library maintenance v0.1](../protocols/library-maintenance-v0.1.md),
[managed replacement](library-download-replacement.md) and [library view](../protocols/library-view-v0.1.md).
N5 acceptance remains in the [N sequence](../development-outline.md#n5-audit-and-redo-material-management).
