# Official release hosting

> Updated: 2026-10-13
> Scope: Public PH-R.COM artifact hosting and static release information

The author authorized official-site deployment and dual-source version discovery on 2026-10-13.
[Product scope](../product-boundary.md#windows-delivery-and-amf-updates-user-ruling-2026-10-11),
[distribution architecture](../architecture/windows-distribution.md) and
[version policy](versioning.md) retain authority over payloads, trust and release identity.

## Public paths

| URL | Purpose |
| --- | --- |
| `https://ph-r.com/projects/vua/` | Detailed Chinese project information, delivered/planned capabilities and installer entry |
| `https://ph-r.com/vua/downloads/` | Current online/offline installer choices and installation/update instructions |
| `https://ph-r.com/vua/releases/v<VERSION>/` | Immutable versioned public artifacts and release download page |
| `https://ph-r.com/vua/releases/latest/vua-release.json` | Original authenticated release envelope for installed clients |
| `https://ph-r.com/vua/releases/latest/latest.json` | Small informational version record for legacy ZIP/development notifications |

The informational record contains `schemaVersion: 1`, `product: VUA`, `tag_name`, `html_url`,
AMF version, public source commit, signed-envelope digest and public asset name/length/digest/URL
rows. Only `tag_name` and optional `html_url` participate in legacy version comparison. It is not
an installation authority; only the authenticated complete inventory may authorize payloads.

## Prepare and publish

1. Build, verify and publish the exact release through the ordinary protected-PR/release process.
   Keep its source/tag/manifest/artifact identity immutable. A server mirror does not create a
   replacement release or authorize a client version bump.
2. Stage only the seven public assets: online/offline NSIS installers, host/AMF packs,
   `vua-release.json`, `release-manifest.json` and `SHA256SUMS.txt`. Never upload the whole build
   directory, `build.json`, profiles, evidence, paid materials or signing/GitHub credentials.
3. Run `node apps/desktop/scripts/prepare-official-release.mjs <public-release-directory> <new-output-directory>`.
   It verifies the shipped Ed25519 anchor before interpreting the payload, checks publication
   SHA-256 values, pack lengths/digests and source identity, and copies the existing bytes unchanged.
   The generated output includes a version directory, download page/styles, the small same-origin
   copy-button script and `project-vua.html`.
   Existing output paths fail rather than being overwritten. Project copy separates current
   features from automatic editing and Recipe work marked "开发中".
4. Transfer to a private server staging directory, then recheck every public file's length and
   SHA-256. Put a complete new version directory under the owned `/var/www/vua/releases/` root.
   Do not change an already-published file in place. Signing stays on the publishing machine.
5. In the existing PH-R.COM HTTPS server block, include
   [the scoped static Nginx locations](../../apps/desktop/distribution/ph-r-locations.conf).
   Preserve the existing website, APIs, TLS and security headers. Install
   [the complete response-header set](../../apps/desktop/distribution/ph-r-headers.conf) as
   `/etc/nginx/snippets/vua-site-security.conf`: sibling portal-location headers are not inherited,
   and a location's `add_header` also replaces server-level headers on the Ubuntu baseline.
   Caching uses `expires` separately. Styles are external same-origin files to respect `style-src 'self'`.
   Test Nginx before reload; keep recoverable configuration/project-page backups.
6. Verify versioned downloads publicly before switching the owned `releases/latest` relative
   symlink atomically to the complete version directory. Latest metadata and the download page
   require revalidation (`Cache-Control: no-cache`); versioned files use long-lived caching.
   Static misses return 404 instead of the portal's HTML fallback. Packs support identity-encoded
   byte ranges with exact 206/Content-Range/lengths for incremental transfer.
7. Verify the public signature, installer digest, metadata and pack ranges; inspect project and
   download pages. Keep raw server configuration and machine/test records private. Track only
   sanitized conclusions here. Website rollback restores its scoped configuration/page backup;
   it does not delete published payloads or force installed users to downgrade.

Future signed packs include versioned official and GitHub URLs for the same bytes. Their digest
and compatibility checks remain in the native helper; the website cannot select arbitrary code.
GitHub retains the canonical release record and alternative download source.
Keep the signed v0.1 envelope's `releaseUrl` canonical to GitHub so the published v0.6.7 Main can
accept future targets. The new helper exposes the official version page when the official feed
supplied the selected authenticated inventory; otherwise it retains the canonical GitHub page.
The unsigned informational `latest.json` may link the official version page independently.

## Transport and page usability

The author's later 2026-10-13 request authorized suitable website/server improvements. The
existing HTTPS virtual hosts now negotiate HTTP/2 while retaining HTTP/1.1. Enable the syntax
appropriate to the deployed Nginx version, test configuration before a graceful reload, then
verify both protocols with certificate validation intact. This changes transport, not backend
API or release identity. No extra database/cache service is required by this static mirror.

The download location compresses HTML/CSS and the small JavaScript/text resources with gzip and
`Vary: Accept-Encoding`. Versioned packs and release inventories retain identity encoding and
their existing range behavior. A controlled HTTPS/HTTP2 range sample returned the exact 1,024
original bytes with 206; stylesheet transfer was 685 bytes with gzip in that check. These are
scoped measurements, not a whole-install bandwidth-saving claim.

The project hero directly links the online installer, with separate installation choices and
anchors for features, planned AMF work, first use and updates. Optional same-origin JavaScript
copies only fixed official installer URLs or displayed SHA-256 values after a button click.
It never reads the clipboard or sends its contents anywhere; a denied clipboard write explains
how to copy the link or visible text manually. Downloads and verification text work without it.

## Current delivery and migration

The current mirror is **v0.6.7**, source `71c989f85f8bed950d7e3cebfa6557078035065f`, AMF **0.1.0**.
Its signed-envelope SHA-256 is `297a17c5d339e9ba60ff2fc12ad2dd1b0ce604ecc745a1cf1da92bc1ebb5b64e`.
All seven remote file identities were checked; the public online installer matched the complete
original digest, and host/AMF/offline byte-range responses matched the original local samples.
The detailed project page and installer entry are live. The release key was not uploaded.

The new working-tree helper checked the live official inventory successfully while GitHub was
blocked only in that isolated test process. Both normal and blocked checks reported the same
authenticated target, compatible installed AMF 0.1.0 and zero changed bytes. This is controlled
check evidence, not a clean-machine install or a newer public AMF update. The existing v0.6.7
installer's embedded helper and pack-source declarations remain GitHub-only. Users acquire
dual-source behavior once through a subsequent host installer; do not repackage v0.6.7 under
the same tag or replace its signed metadata to imply this change is already delivered.
