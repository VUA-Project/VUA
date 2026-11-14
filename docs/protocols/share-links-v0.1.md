# Share links v0.1

> Document version: 0.1.2
> Status: Candidate
> Updated: 2026-11-14
> Owner: AMF / Hosting

An explicitly published Recipe declaration or BOOTH product selection is public under a
content-derived code. No account, asset upload, catalogue, search, tracking or social feature is
provided. Purchase sessions, materials and reproduction stay local under the
[product boundary](../product-boundary.md#stable-product-principles). The desktop's reviewed
publication and receiving UI belong to separate slices.

## Documents and validation

The service accepts the closed share schemas for [Recipe v0.4](../../schemas/amf-recipe/v0.4/share.schema.json),
[v0.5](../../schemas/amf-recipe/v0.5/share.schema.json) and [v0.6](../../schemas/amf-recipe/v0.6/share.schema.json), plus
[selection-share v0.1](../../schemas/selection-share/v0.1/share.schema.json). Dispatch uses
`kind: "vua.selection"` for selections and `formatVersion` for each kind. Unknown kinds,
versions and fields are refused without coercing, stripping or defaulting submitted values.
Recipe validation also uses the existing `@vua/contracts` semantic guard: material/source
coverage, reference integrity and v0.5 product agreement must hold.

A product selection has this shape:

```json
{
  "kind": "vua.selection",
  "formatVersion": "0.1",
  "title": "Avatar materials",
  "products": [
    { "productId": "1000000", "shopName": "Synthetic shop", "variantName": "Coat" }
  ]
}
```

There are 1–64 products. IDs are canonical positive BOOTH decimal strings, 1–20 digits, without
leading zeroes, matching Recipe source IDs. Titles are nonblank, 1–120 Unicode characters;
optional non-null shop and variant text is at most 512 characters, matching selection-draft
text limits. Controls U+0000–001F and U+007F–009F are refused in these text fields. Product
order and repeated variant selections are preserved. There are no path, file or hash fields.
These are display facts supplied by a publisher, not independently verified shop attribution.

The UTF-8 request body is at most 65,536 bytes, including whitespace. The canonical result
must also fit that limit. JSON value depth is at most 32, counting the root as 1. Invalid UTF-8,
unpaired Unicode surrogates, duplicate decoded object keys, non-finite numbers, invalid JSON
and malformed references are refused. Schema validation reads bundled files without networking.

## Canonicalization and code

1. Canonicalize the entire submitted document using [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785).
   Preserve array order and Unicode strings without normalization. Sort object names by UTF-16
   code units, including integer-looking names; serialize numbers using ECMAScript JSON rules.
2. Hash the UTF-8 canonical bytes with SHA-256.
3. Take the first 60 bits, most significant bit first: the first 15 hexadecimal digest digits.
4. Divide into twelve 5-bit values, most significant group first, and index
   `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Preserve leading zero groups. The result is exactly
   twelve uppercase ASCII characters, with no checksum or padding.

Clients recompute the code from the returned document before using it. The service never
overwrites different content on a truncated-hash collision: publishing then returns 409
`code_collision`. A code is an identifier, not an authentication credential or an authenticity
signature. Player titles participate in the code even though the web page omits them.

Cross-client golden vectors are in
[`services/recipe-links/test-vectors/codes.json`](../../services/recipe-links/test-vectors/codes.json).
Each includes the complete declaration, exact canonical text, full digest and expected code:

| Vector | Code |
| --- | --- |
| Recipe v0.4 | `3P3J7H0EGWP1` |
| Recipe v0.5 with fit and shop | `NF5MQDQ4N075` |
| Recipe v0.6 with Avatar Optimizer | `QTET2ZW9J8FD` |
| Product selection | `4X82FFD451H4` |
| Unicode product selection | `N5JWEY1QS9V2` |

The four fixture documents have ASCII property names and ordinary finite numbers; their
expected values were generated independently with Python sorted JSON and SHA-256. The Node
consumer additionally exercises RFC primitive serialization, UTF-16 ordering, integer-looking
keys and invalid Unicode, which Python sorted JSON alone does not generally implement as JCS.

## HTTP interface

The configured public origin is HTTPS, by default `https://ph-r.com`. It has no path, user
information, query or fragment. Incoming Host/forwarded-host fields never determine returned
links. Paths `/r/` and `/R/`, and ASCII code case, are interchangeable. The Node handler also
accepts API-path case variants and optional trailing slashes. No CORS access is enabled.

| Request | Success | Meaning |
| --- | --- | --- |
| `POST /api/shares` | 201 new / 200 existing | JSON declaration; returns `{code, url, deleteToken}` |
| `GET /api/shares/{code}` | 200 | Exact canonical JSON, `Content-Type: application/json; charset=utf-8` |
| `DELETE /api/shares/{code}` | 204 | `Authorization: Bearer <deleteToken>` removes that publication claim |
| `GET /r/{code}` | 200 | Localized material list |

POST requires `Content-Type: application/json` (an optional charset parameter is permitted).
Every successful publication, including duplicate content, creates a new random 256-bit
base64url withdrawal credential. The response must be retained locally by the publishing
client and has `Cache-Control: no-store`. The service stores only its SHA-256 hash. There is
no credential recovery. Do not put a credential in a URL.

Withdrawal consumes just that credential. Other publishers' claims keep the same document
available. Removing the last claim deletes the document; subsequent origin reads return 404.
Wrong, missing, previously consumed or wrong-code credentials return 403, including for an
already-absent code. Republishing previously removed content reuses its deterministic code
with fresh credentials; earlier credentials remain invalid. Concurrent mutations serialize per
code. No update-in-place endpoint exists.

Successful JSON reads carry a full-content ETag and
`Cache-Control: public, max-age=0, must-revalidate`: clients may retain bytes long term but must
revalidate reuse, so withdrawal is observed. A matching live ETag returns 304; an absent
document returns 404 even with an old ETag. Material pages, errors and withdrawal receipts
are not cached. Already downloaded copies cannot be recalled. HEAD has GET's status and headers
without a body. No automatic retries are performed by this service.

Errors are JSON `{ "error": "stable_code", "message": "English explanation" }`:

| Status | Code | Trigger |
| --- | --- | --- |
| 400 / 415 | `invalid_declaration` | Invalid document/encoding/depth or unsupported content type |
| 413 | `too_large` | Request or canonical bytes exceed 64 KiB |
| 429 | `rate_limited` | Source limit or bounded limiter capacity; includes `Retry-After` seconds |
| 404 | `not_found` | Absent/invalid code or route |
| 403 | `forbidden` | Withdrawal credential is not valid |
| 405 | `method_not_allowed` | Unsupported method; includes `Allow` |
| 409 | `code_collision` | Stored canonical bytes differ under the same code |
| 503 | `capacity_exceeded` | 4,096 independent claims already retain this document |
| 503 | `unavailable` | Storage failure; existing bytes are preserved |

## Rate limits and privacy

The default is 20 POST attempts per source IP in a sliding hour, including invalid attempts.
`PUBLISHES_PER_HOUR` configures 1–1,000 attempts. At most 10,000 hashed source/day buckets are
retained; a full limiter refuses new buckets rather than evicting live protections.

An independent cryptographic salt rotates at UTC midnight. Only daily HMAC-SHA-256 source
keys and expiring attempt timestamps are kept, in memory. Previous-day salts remain only for
the overlapping hour, preserving the limit across midnight; expired buckets are deleted.
There is no durable IP, access log or analytics database. A process restart resets these
ephemeral limits; this deployment is one process. Multiple hosts would need an explicit shared
abuse-counter design, not independent round-robin instances over one directory.

The Node adapter binds only to `127.0.0.1`. It always overwrites the internal source header.
With `TRUST_PROXY=1`, only a loopback peer may supply one valid `X-Real-IP`, which the configured
proxy must replace with its actual remote address. Untrusted peers cannot override their
identity with forwarding headers. IPv4-mapped IPv6 and expanded IPv6 spellings normalize before
hashing. The supplied proxy examples disable share-route access logs and do not cache receipts.

## Material page

`Accept-Language` quality values select Japanese, English, Simplified Chinese, Traditional
Chinese or Korean; the fallback is English. Traditional tags/regions include Hant, TW, HK and
MO. Responses carry `Content-Language` and `Vary: Accept-Language`.

Both document kinds list their BOOTH products as `https://booth.pm/ja/items/<id>`, with optional
escaped shop/variant text. Repeated Recipe products collapse for display only. A Recipe adds an
assembly-plan label. Neither kind displays the player's title anywhere in HTML. A purchase
notice explains that recipients need their own materials, followed by `vua://share/<CODE>` and
the official VUA download-page link. There is no fetching of product metadata.

The page uses system fonts, no scripts, external resources, cookies or tracking. Its `<head>`
includes `noindex,nofollow,noarchive` plus localized text-only OpenGraph (`og:type`, `og:site_name`,
`og:title`, `og:description`) and Twitter (`twitter:card=summary`) preview tags derived strictly
from item count and static localized copy, omitting player-supplied titles and external image URLs.
Its inline stylesheet is allowed by an exact CSP hash; other sources, framing, base changes and
forms are blocked. All display strings are HTML-escaped. Layout supports narrow mobile screens,
keyboard focus and system light/dark preference. Generated translations await native review.

## Storage and deployment

[`ShareStore`](../../services/recipe-links/src/storage.ts) separates the HTTP handler from memory
and local-directory implementations. Directory storage has one private JSON record per code,
with canonical bytes and credential hashes; records use a synced temporary file and atomic
rename. Files are mode 0600 and the dedicated directory 0700 on Unix. Corrupt/oversized records
fail closed without replacement. Use a single writer process and a consistent private backup.
The service never stores images, uploaded files, purchase rights or paid material content.

[The service README](../../services/recipe-links/README.md) owns configuration, systemd,
standalone Caddy automatic HTTPS, integration with the existing Nginx site, backup and rollback.
Adding a standalone Caddy listener to occupied ports 80/443 is not part of this change.
Production installation and real phone/desktop end-to-end acceptance remain author actions.

## Document changelog

- 0.1.2 (2026-11-14): add privacy-safe text-only OpenGraph/Twitter preview meta tags and `noarchive` robot directive to `materialPage`, never exposing player-supplied titles or external image links.
- 0.1.1 (2026-11-14): add `recipe-v06` (`QTET2ZW9J8FD`) cross-client golden vector in `codes.json` and `schemas/share-links/v0.1/code-vectors.json`.
- 0.1.0 (2026-10-28): Candidate service, selection format, golden vectors and Node implementation.
