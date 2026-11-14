# GLB and VRM metadata inspection v0.1

> Document version: 0.1.0
> Status: Candidate
> Owner: AMF
> Updated: 2026-11-14
> Schemas: [request](../../schemas/glb-inspection/v0.1/request.schema.json), [result](../../schemas/glb-inspection/v0.1/result.schema.json), [vectors](../../schemas/glb-inspection/v0.1/vectors.json)

This Candidate face inspects `.glb` and `.vrm` binary glTF 2.0 artifacts already stored inside
VUA's local warehouse (`library.inspectGlb`) — both standalone files and `.glb`/`.vrm` members
inside unexpanded `.zip` archives — without launching Unity, writing temporary files to disk, or
reading binary geometry/texture buffers into memory. It distinguishes **VRM 1.0 (`VRMC_vrm`)**,
legacy **VRM 0.x (`VRM`)**, and general **glTF 2.0 (`.glb`)** files, extracts geometry, material,
texture, secondary-motion, humanoid bone, scene-bounds, and embedded license metadata, and helps
players identify VRM assets that require conversion (for example via `VRM Converter for VRChat`)
before VRChat Avatar assembly.

## Safety and streaming bounds

1. **Warehouse-contained artifacts only**: callers pass either `productId` (`booth:<digits>`) or
   `entryId` (`warehouseItemId`), never a filesystem path. Only regular non-symlink files verified
   inside the canonical warehouse root by `PresenceCheck` are opened.
2. **Header + JSON chunk streaming only (standalone and `.zip` members)**:
   - Reads the 12-byte GLB header (`magic == 0x46546C67`, `version == 2`) and the 8-byte Chunk 0
     header (`chunkType == 0x4E4F534A` JSON).
   - For unexpanded `.zip` copies (those without an `expanded/<copyId>/<member>` copy already
     registered), scans at most `4,096` central-directory entries, skips directories, symlinks and
     encrypted members, and streams at most `20 + 16 MiB` of each `.glb`/`.vrm` entry (`sourceKind:
     "zip_member"`, `containerFileName: "<archive>.zip"`).
   - Refuses JSON chunks larger than `16 MiB` as `invalid_glb` and never reads Chunk 1 (`BIN`
     geometry/texture payload), keeping inspection fast and memory-bounded even on `100+ MiB`
     avatars.
   - Inspects at most `64` `.glb`/`.vrm` items per query and sets `truncated: true` when more exist
     or when a `.zip` exceeds `4,096` entries.
3. **Path redaction**: `fileName` and `containerFileName` expose only warehouse-relative names,
   never host filesystem paths.

## Operation

| Method | Kind | Params | Result |
| --- | --- | --- | --- |
| `library.inspectGlb` | query | `{ schemaVersion: "0.1", productId }` XOR `{ schemaVersion: "0.1", entryId }` | `GlbInspectionResultV01` |

## Extracted glTF / VRM metrics (`0.1.0`)

- **Format (`format`)**: `vrm_1_0` (`extensions.VRMC_vrm`), `vrm_0_x` (`extensions.VRM`), `glb_2_0`
  (valid glTF 2.0 binary without VRM extensions), or `invalid_glb`.
- **Geometry (`contentSummary`)**: `meshCount`, `primitiveCount`, deterministic `triangleEstimate`
  from index or `POSITION` accessor counts, `skinCount`, `nodeCount`, and `animationCount`.
- **Materials & textures (`materialSummary`, `textureSummary`)**: total materials, `KHR_materials_unlit`
  and `VRMC_materials_mtoon` / VRM 0.x MToon counts, plus embedded vs external-URI image counts so
  broken non-self-contained `.glb` exports are surfaced before import.
- **Secondary motion (`secondaryMotion`)**: `VRMC_springBone` / VRM 0.x `secondaryAnimation` joint
  counts, `VRMC_node_constraint` node counts, and `VRMC_vrm.expressions` / VRM 0.x BlendShape group
  counts.
- **Humanoid VRM metadata (`vrm`)**: embedded title, version, authors, license URL/permissions,
  `hasHumanoidHeadBone`, `hasFullBodyBones` (15 core humanoid bones), `hasToeBones` (`leftToes` +
  `rightToes`), and `headBoneHeightMeters` (scene-space `Y` of the `head` bone node in `[0, 10]` m).
- **Scene bounds (`boundsMeters`)**: computed by traversing the active glTF scene's node hierarchy
  (`matrix` column-major `4x4` or `translation` / `rotation` / `scale` TRS, bounded to `128` depth
  and `16,384` node visits) and transforming each mesh primitive `POSITION` accessor's `[min, max]`
  3D bounding-box corners into root scene meters (`min`, `max`, `size`).

## Document changelog

- 0.1.0 (2026-11-14): introduce pure-Rust streaming `.glb` and `.vrm` (`VRMC_vrm` 1.0 and legacy VRM 0.x) metadata inspection over standalone warehouse files and unexpanded `.zip` members.
