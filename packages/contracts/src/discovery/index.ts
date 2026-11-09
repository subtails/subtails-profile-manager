import { z } from 'zod';
import { consoleSelectionSchema, type ContentRating } from '@subtails/contracts/primitives';
import {
  evidenceAssetRefSchema,
  evidenceFactValueSchema,
  evidenceModalityEnum,
} from '@subtails/contracts/evidence';

// ===========================================================================
// @subtails/contracts/discovery — Discovery Engine contracts (Story 7.1 scaffold)
//
// SCOPE: this is a SCAFFOLD-ONLY namespace. The schemas below are intentionally
// permissive stubs that exist to unblock downstream stories — the real request /
// response / event shapes are tightened in:
//   • 7.3 — Signal Service (signalWriteRequestSchema)
//   • 7.4 — Next-Move selection (nextMoveResponseSchema)
//   • 8.3 — explainable reasons (reasonPayloadSchema factor codes)
// Mirrors the Zod-schema + inferred-type shape of the other contracts namespaces
// (see packages/contracts/src/library/index.ts).
// ===========================================================================

// ---------------------------------------------------------------------------
// Reason factor codes — the shared enum the frontend localizes (UX-DR6 / D8).
// These are STABLE machine codes used in logic + persistence; the user-facing
// label for each code is resolved through next-intl on the client. Do NOT
// localize the code value itself.
// ---------------------------------------------------------------------------

// PHASE-1 CANONICAL VOCABULARY (Story 7.4): the codes below are the stable,
// committed factor codes. The non-taste-hook codes this story's engine emits are:
//   • 'highly_rated'    → the acclaim hook (game_ratings)        — guaranteed fallback
//   • 'free'            → the free hook (offers price 0/null or subscription-included)
//   • 'on_subscription' → the Game Pass hook (user_subscriptions × memberships)
//   • 'in_your_library' → the optional owned "play what you have" nudge
// The remaining codes ('genre_match' / 'similar_players' / 'recently_trending' /
// 'short_to_finish') are scaffolded UX-flavored codes kept for forward-compat — they
// are NOT emitted in phase 1. Story 8.3 EXTENDS this enum with the taste-rung codes
// (e.g. 'liked_trait', 'fits_length') — extend, never rename, so persisted codes stay
// stable. Do NOT localize the code value itself (UX-DR6 / D8 — client maps code → copy).
// Story 8.3 EXTENDS this enum with the TASTE-RUNG codes (APPENDED — never rename or
// reorder a committed code; persisted codes must stay stable):
//   • 'liked_trait' → a SPECIFIC matched facet the model is confident on. MULTIPLE
//     entries carry the facet-granular "because" ("fast, story-driven 2D roguelikes"),
//     each with `data: { dimension, label }` — NOT a single coarse genre (UX-DR12).
//   • 'fits_length' → the taste matches the player's preferred play length (the §5
//     sketch's length factor), emitted when the length dimension is held.
export const reasonFactorCodeEnum = z.enum([
  'genre_match',
  'similar_players',
  'recently_trending',
  'short_to_finish',
  'in_your_library',
  'highly_rated',
  'free',
  'on_subscription',
  // --- Story 8.3 taste-rung codes (appended) ---
  'liked_trait',
  'fits_length',
  // --- Story 9.6 taste-widening code (appended) ---
  // 'widened_taste' → this suggestion comes from a region the model just WIDENED into
  // because an unexpected "yes" on a Wildcard/Bridge item pulled that region toward the
  // player's core (FR-15). Emitted when the served taste suggestion sits in a
  // newly-widened band. The client localizes it (D8 — no backend prose); the "branching
  // out"/"wildcards" copy lives in `play.item.reason.widened_taste` across all locales.
  'widened_taste',
  // --- Story 9.7 closed-loop hypothesis-validation code (appended) ---
  // 'probing_hypothesis' → this card is a TARGETED VALIDATION PROBE: the model suspects a
  // preference shift (a pending hypothesis) and is actively CHECKING it before committing the
  // shift's aging decay (D14). Emitted only when the served card IS a probe. The client localizes
  // it (D8 — no backend prose); `data` may name the probed `{ dimension, subject }`. The plain
  // "checking a hunch"/"making sure" copy lives in `play.item.reason.probing_hypothesis` across all
  // locales. APPENDED — never rename or reorder a committed code so persisted codes stay stable.
  'probing_hypothesis',
  // --- price-honesty code (APPENDED last, 2026-08-29) ---
  // 'price_unknown' → the free hook served this game because an offer exists for it, but that
  // offer records NO price. It is NOT a claim that the game is free. The two were conflated:
  // every `price IS NULL` candidate was emitted as 'free' and rendered "Free to play", which on
  // production covered 75,383 of the hook's 75,419 eligible games — a claim nothing supported,
  // on essentially every card served while the subscription and acclaim rungs were empty.
  // Emitted ONLY when no offer for the game says free; a genuinely free offer (price '0' or
  // subscription-included) still emits 'free'. The client localizes it (D8).
  'price_unknown',
]);

export type ReasonFactorCode = z.infer<typeof reasonFactorCodeEnum>;

// ---------------------------------------------------------------------------
// Reason RUNG (Story 8.3) — the confidence-routing decision (architecture §5).
// The suggestion's TYPE is routed by how confident the authoritative taste model
// is: nothing-known → the 7.4 non-taste-hook ladder; coarse → a disambiguating
// A/B move; confident → a taste-explained pick. `behavioral` is RESERVED in the
// enum (engagement-driven routing) but NOT wired in 8.3.
// ---------------------------------------------------------------------------
export const reasonRungEnum = z.enum([
  'non_taste_hook',
  'disambiguation',
  'taste',
  'behavioral',
]);

export type ReasonRung = z.infer<typeof reasonRungEnum>;

// The per-factor payload for a `liked_trait` factor: the SPECIFIC matched facet at
// `{ dimension, label }` granularity (e.g. `{ dimension: 'pace', label: 'fast' }`).
// The client localizes BOTH the factor code AND the trait label (D8 — no backend
// prose). A tightened optional schema for type-safety; the base `data` stays the
// permissive `z.unknown().nullish()` so other factors' payloads are unaffected.
export const likedTraitDataSchema = z.object({
  dimension: z.string(),
  label: z.string(),
});

export type LikedTraitData = z.infer<typeof likedTraitDataSchema>;

// ---------------------------------------------------------------------------
// Reason payload — an explainable suggestion's "why" (stub; tightened in 8.3).
// A list of weighted factor codes the client turns into localized copy.
// ---------------------------------------------------------------------------

export const reasonFactorSchema = z.object({
  code: reasonFactorCodeEnum,
  weight: z.number().min(0).max(1),
  // Optional per-factor payload — the acclaim hook attaches `{ score }`, the
  // subscription hook `{ serviceId }`. The phase-1 renderer needs only `code`;
  // `data` is forward-compat context (8.3 §5 sketch: data:{score}/data:{serviceId}).
  data: z.unknown().nullish(),
});

// Story 8.3 EXTENDS this payload with the routing decision. `rung` + `confidence`
// are OPTIONAL ADDITIVE fields so the live 7.4 `{ factors: [...] }` payload stays
// valid (backward-compat — `nextMoveResponseSchema.reason` points here, so the
// existing engine + route tests keep passing). The reason still emits NO prose —
// the frontend maps codes (+ `liked_trait` `{ dimension, label }`) → localized copy.
export const reasonPayloadSchema = z.object({
  factors: z.array(reasonFactorSchema),
  /** The confidence-routing rung (Story 8.3). Optional for 7.4 backward-compat. */
  rung: reasonRungEnum.optional(),
  /**
   * The routing confidence scalar in [0,1] (Story 8.3). Optional for backward-compat. Taste Engine
   * Story 2.4: this is the routed mode's CERTAINTY (how much the engine KNOWS, AD-5) — never the
   * agreement ratio (how CONSISTENT the evidence is). No schema change: certainty is already in
   * `[0,1]`, the same range the agreement ratio occupied.
   */
  confidence: z.number().min(0).max(1).optional(),
});

export type ReasonFactor = z.infer<typeof reasonFactorSchema>;
export type ReasonPayload = z.infer<typeof reasonPayloadSchema>;

// ---------------------------------------------------------------------------
// Taste Information Matrix — evidence contract types (Story 1.1 / FR-1 / IM-6).
//
// The structured, client-localizable, PROSE-FREE evidence contract every producer
// (packages/discovery's evidence-matrix + selector, Epic 2) and the client (Epic 4
// card renderer) share. This story authors TYPES ONLY — no engine/route/DB change,
// no i18n key (see Dev Notes "What this story IS").
//
// THE ASYMMETRY (read before touching this block): `modality` / `character` /
// `resolvedBy` / the fact `unit` are the SYSTEM's own vocabulary — CLOSED, pinned,
// append-only enums, mirroring the `reasonFactorCodeEnum` convention above (:47-:75).
// `EvidenceFacet.dimension` / `.label` are the TAG NET's vocabulary — OPEN free
// strings, mirroring `likedTraitDataSchema` (:99), because the tag net grows at
// RUNTIME (seed migrations, machine/crowd labels, the SteamSpy sweep) and typing
// them against `tagDimensionEnum` (:1266) would make a brand-new dimension
// unparseable until a contract redeploy — exactly the IM-14 regression this
// initiative exists to prevent. Do NOT reach for `tagDimensionEnum` here.
// ---------------------------------------------------------------------------

// The open-layer modality a node/dimension is presumed to favor absent a more
// specific signal (IM-14's per-dimension default table, encoded by Story 1.2's
// `recipeFor`). APPEND-ONLY, same persistence rule as `evidenceModalityEnum` (`@subtails/contracts/evidence`).
export const evidenceCharacterEnum = z.enum(['visual', 'kinetic', 'quantitative', 'textual']);
export type EvidenceCharacter = z.infer<typeof evidenceCharacterEnum>;

// HOW a recipe's modality was chosen — feeds the IM-14 curation telemetry / IM-12
// `demand_kind: 'curation'` signal. APPEND-ONLY, same persistence rule as above.
export const evidenceResolvedByEnum = z.enum([
  'explicit',
  'node_character',
  'dimension_default',
  'safe_default',
]);
export type EvidenceResolvedBy = z.infer<typeof evidenceResolvedByEnum>;

// The demand-ledger's OWN closed vocabulary (Story 5.1, FR-6/IM-12). APPEND-ONLY, same
// persistence rule as `evidenceModalityEnum`/`evidenceResolvedByEnum` above: these are stable
// machine codes PERSISTED to `evidence_demand` — never rename, reorder, or remove a committed
// member; append only.
//
// `evidenceDemandKindEnum` — the TWO ways a served facet can fail to reach Proven and still be
// worklist-worthy: `'extraction'` (a genuine catalog gap — no binding, or a degraded/unusable
// one; Story 5.1 emits this) and `'curation'` (a binding exists but a coherence/producer decision
// fell back to `safe_default`; Story 1.5 emits this — NOT this story, see the scope fence). The
// two kinds key SEPARATE `evidence_demand` rows for the same facet (D4) and are NEVER ranked
// against each other — `readTopExtractionDemand` below hard-filters to `'extraction'` only.
export const evidenceDemandKindEnum = z.enum(['extraction', 'curation']);
export type EvidenceDemandKind = z.infer<typeof evidenceDemandKindEnum>;

// `evidenceMissRungEnum` — the three sub-Proven rungs of IM-11's ladder
// (`Candidate | GeneralMedia | Enrich`), named in snake_case for persistence. `'proven'` is
// DELIBERATELY NOT a member — a Proven serve is not demand, so there is nothing for it to name
// here. Story 5.1 writes `miss_rung = NULL` on every row it emits (the rung is 5.2's ladder
// OUTPUT, and the serve path cannot compute it today without the media + candidate-tier reads
// that are 5.2's scope); Story 5.2 begins writing real members into the SAME rows, no migration,
// no fossil enum member (D4).
export const evidenceMissRungEnum = z.enum(['candidate', 'general_media', 'enrich']);
export type EvidenceMissRung = z.infer<typeof evidenceMissRungEnum>;

// The facet an evidence payload is evidencing — mirrors `likedTraitDataSchema`
// (:99-:102) at `{ dimension, label }` granularity so the 4.1 "evidence matches the
// shown reason" join holds. `dimension`/`label` stay FREE STRINGS (see the
// asymmetry note above) — never `tagDimensionEnum` — so a never-enumerated
// dimension parses with no contract redeploy (IM-14); the shipped engine already
// emits `dimension: 'length'` / `'playLength'` facets
// (`packages/discovery-engine/src/suggestion-routing.ts:346`), neither a registry member.
// `nodeId` is `.optional()` per IM-3 — producers must OMIT it rather than send
// `null` (`...(nodeId != null ? { nodeId } : {})`) so the resolver's type is
// `number | undefined` — letting the IM-15 resolver read a node's evidence-character
// when present, and letting a flat (non-node) facet parse without it.
export const evidenceFacetSchema = z
  .object({
    dimension: z.string(),
    label: z.string(),
    nodeId: z.number().int().positive().optional(),
  })
  .strict();
export type EvidenceFacet = z.infer<typeof evidenceFacetSchema>;

// The resolved plan for evidencing one facet — authored here; Story 1.2's total
// `recipeFor` is the function that RETURNS this shape from a facet + node context.
// `fallback` is an ORDERED, possibly-empty chain of `EvidenceModality` to try if the
// primary `modality` has no asset; EXHAUSTING it means "text-only card" — the
// ABSENT-payload state, which is why `'text'` is not a modality member (see above).
// `count` is the optional screenshot count `N`. The character→modality seed map
// (visual⇒screenshot(N), kinetic⇒trailer, quantitative⇒fact,
// textual/unknown⇒screenshot(N)→text) that PRODUCES a recipe's values is Story 1.2's
// concern (`packages/discovery/evidence-matrix.ts`) — never re-literalled here (IM-1/AD-7).
export const evidenceRecipeSchema = z
  .object({
    modality: evidenceModalityEnum,
    character: evidenceCharacterEnum,
    count: z.number().int().positive().optional(),
    fallback: z.array(evidenceModalityEnum),
    resolvedBy: evidenceResolvedByEnum,
  })
  .strict();
export type EvidenceRecipe = z.infer<typeof evidenceRecipeSchema>;

// The evidence attached to (eventually) a `NextMoveResponse` game move — OPTIONAL-
// ADDITIVE, wired by Story 4.1 (NOT this story — see Dev Notes), mirroring the
// `reason.rung`/`reason.confidence` (:128-:131) and `reachSuggestion` (:256)
// optional-additive precedents: absent ⇒ today's text-only card, backward-compatible.
// PROSE-FREE (D8/AD-8): `.strict()` so a free-form field (`title`, `caption`, `text`,
// `description`, `because`) is REJECTED — the client maps machine tokens to copy.
//
// `assets` vs `factValue` (see Dev Notes for the full reasoning — pin this ONE way):
//   - `assets` is the ordered list of resolved refs for EVERY modality, so IM-17's
//     single `selectEvidenceForFacet` (Story 2.3) returns `{ tier, assets }`
//     uniformly across screenshot/trailer/fact with no per-modality translation
//     step. A fact payload carries `assets: [{ kind: 'fact', value, unit }]` —
//     exactly one ref.
//   - `factValue` is a convenience MIRROR of that same ref's `{ value, unit }`,
//     present iff `modality === 'fact'`, so the card renderer (4.3) and the
//     `play.evidence.fact.*` copy (1.4) read one field instead of type-narrowing
//     the asset union at render time.
//   - Producers DERIVE `factValue` from the fact ref; they never author the two
//     independently. Story 2.2's table mirrors the same split (`asset_refs` jsonb +
//     `fact_value`/`fact_unit` columns), so the row→payload projection is a direct
//     copy in both directions.
//
// Modality↔content COHERENCE is a producer obligation, NOT enforced here by a
// `.refine()`/`.superRefine()` (packages/contracts uses zero zod effects today —
// see Dev Notes "Coherence is the producer's job"): `modality: 'fact'` ⇒
// `factValue` present AND `assets` holds exactly the one `{ kind: 'fact' }` ref it
// was derived from; `'screenshot'`/`'trailer'` ⇒ `assets` non-empty image/video
// refs and `factValue` absent. IM-17 puts that judgment in exactly one place —
// `selectEvidenceForFacet` (Story 2.3) — so it is not enforced twice.
export const evidencePayloadSchema = z
  .object({
    facet: evidenceFacetSchema,
    modality: evidenceModalityEnum,
    assets: z.array(evidenceAssetRefSchema),
    factValue: evidenceFactValueSchema.optional(),
    resolvedBy: evidenceResolvedByEnum,
  })
  .strict();
export type EvidencePayload = z.infer<typeof evidencePayloadSchema>;

// taste-information-matrix Story 5.2 (AC7, D8) — the wire shape for the TWO below-Proven
// coverage-ladder rungs the client can actually render media for. `evidenceMissRungEnum` already
// names all three sub-Proven rungs, but `'enrich'` carries no asset (there is nothing to show) and
// so never reaches the wire — only `'candidate'`/`'general_media'` do. `facet` is present IFF
// `rung === 'candidate'` (the ONE rung with a real, non-null facet — see `EvidenceLadderResolution`
// in `@subtails/discovery`'s `evidence-ladder.ts`); `asQuestion` mirrors that same discriminant
// (D3: Candidate's second collection action, reaching the client so 5.3's prompt becomes
// eligible). `.strict()`, PROSE-FREE (D8/AD-8) — same no-free-text-field posture as
// `evidencePayloadSchema` above: no `title`, no `caption`, no `because`. `assets.min(1)` — a
// would-be media rung with zero assets is `enrich` at the resolver, never reaches this schema
// (AC1.3). This story attaches nothing else: no component, no CSS, no copy (AC7.5) — rendering is
// Story 5.3's surface.
export const evidenceLadderPayloadSchema = z
  .object({
    rung: z.enum(['candidate', 'general_media']),
    facet: evidenceFacetSchema.optional(),
    modality: evidenceModalityEnum,
    assets: z.array(evidenceAssetRefSchema).min(1),
    asQuestion: z.literal(true).optional(),
  })
  .strict();
export type EvidenceLadderPayload = z.infer<typeof evidenceLadderPayloadSchema>;

// ---------------------------------------------------------------------------
// Signal write request — a single taste-discovery preference signal (Story 7.3).
//
// Mapped 1:1 to the `preference_signals` columns the CLIENT supplies (everything
// except `userId` (session), `id`/`createdAt` (DB-defaulted), `source` (DB
// default 'swipe' unless overridden), and `context` (reserved-v2 — left null in
// phase 1)). Realizes FR-7 (unified signal log) + FR-8 (implicit latency signal).
// ---------------------------------------------------------------------------

// Response-type vocabulary (architecture §4.1). STABLE machine codes used in
// logic + persistence — the user-facing label for each is resolved through
// next-intl on the client; do NOT localize the code value itself. `'played'` is
// reserved for v2 and is intentionally NOT part of this set.
export const responseTypeEnum = z.enum([
  'like',
  'dislike',
  'rank',
  'score',
  'select',
  'skip',
  'unknown',
]);

export type ResponseType = z.infer<typeof responseTypeEnum>;

export const signalWriteRequestSchema = z.object({
  // What is being rated (e.g. 'game', 'genre', 'mood').
  dimension: z.string(),
  // The thing rated. For a game-card swipe: subjectType='game', subjectId=<gameId>.
  subjectType: z.string(),
  subjectId: z.string(),
  // The player's response (stable machine code; see responseTypeEnum).
  responseType: responseTypeEnum,
  // jsonb payload — e.g. a score/rank object; nullable.
  value: z.unknown().nullish(),
  // FR-8 implicit signal — client-measured ms from item-shown to response.
  latencyMs: z.number().int().nonnegative().max(2147483647).nullish(),
  // Ephemeral client-issued session id (no FK); nullable.
  sessionId: z.string().uuid().nullish(),
  // jsonb — what was on screen when the signal was produced; nullable.
  shownContext: z.unknown().nullish(),
  // This-or-That pairwise comparison id (unused until 8.10; accept it now).
  comparisonId: z.string().nullish(),
  gameKey: z.string().nullish(),
  // DB default 'swipe' applies when omitted; accept a client override.
  source: z.string().nullish(),
  // The CSRF token travels in the body (canonical pattern — see merge/confirm).
  // The SERVICE must never persist this.
  csrfToken: z.string(),
});

export type SignalWriteRequest = z.infer<typeof signalWriteRequestSchema>;

export const signalWriteResponseSchema = z.object({
  ok: z.boolean(),
  id: z.number().int().optional(),
  /** True when an immutable estimated-playtime answer already won this identity. */
  alreadyRecorded: z.boolean().optional(),
});

export type SignalWriteResponse = z.infer<typeof signalWriteResponseSchema>;

// ---------------------------------------------------------------------------
// Next-move response — the engine's next suggested move (Story 7.4, phase 1).
//
// Phase 1 ("always-a-next-move via non-taste hooks only", architecture §10) ALWAYS
// returns a suggestion: a concrete candidate game + a non-null structured reason.
// Taste-engine Story 5.3 (AD-13) adds the ONE exception: when the player has seen,
// owned or suppressed every rated game, the engine resolves the typed TERMINAL
// variant (`{ kind: 'terminal', cause: 'pool_exhausted' }`, `.strict()`, machine
// metadata only — AD-8/D8) rather than a served move. `isNextMoveTerminal` is the
// single, exported predicate every consumer (route, client, harness) uses to tell
// the two apart; none re-derives the discrimination. So both fields are REQUIRED and
// non-null (this is the always-a-next-move contract — AC #1/#4). The route validates
// its own response against this schema before it leaves, guarding the guarantee.
//
// `gameTitle` / `gameSlug` / `gameImageUrl` are minimal presentational context the
// selection query already has in hand (it joins `games` to read the candidate row),
// carried so the client can render the card without a second round-trip. They are
// kept optional so the engine's contract does not force an extra read if a hook ever
// lacks them. `gameImageUrl` is the cover art (the canonical app-wide
// `attributes->>'coverImageUrl'` scalar) — a SCALAR extraction, not the heavy
// `attributes` blob, so it adds no meaningful egress.
//
// The move "mode" the header anticipated is realized as ADDITIVE union variants that
// EXTEND this shape without reshaping it: the node move (Story 5.12 drill-down) and the
// minigame surface (Epic 8, `surface: 'minigame-spec'`) each append a variant while the
// game move — and the exported `NextMoveResponse` type — stay byte-for-byte. Still later
// (Story 8.3): confidence routing acting on the `reason` rung to EMIT a minigame; 8.2
// only makes the response ABLE to carry the surface, it never constructs one.
// ---------------------------------------------------------------------------

// The GAME move — the shipped, phase-1 variant. UNCHANGED: `gameId` stays REQUIRED and every existing
// caller (the engine hooks, the /next route, the play surface, the wishlist gate) keeps seeing exactly
// this shape. `NextMoveResponse` is inferred from THIS sub-schema, so the type is byte-for-byte as
// before — no existing consumer of `move.gameId` reshapes.
// Story 9.2 — the engine-emitted REACH-WIDENING SUGGESTION. A machine-only signal (`.strict()`,
// no prose, no target step) the engine sets when the warm taste path detects a redundancy rut
// (`redundancySkipped >= REACH_SUGGESTION_MIN_REDUNDANT` and the session is not already wide).
// The CLIENT computes the wider step from its live reach state; the engine only reports the reason.
export const reachSuggestionSchema = z.object({ reason: z.literal('redundancy_rut') }).strict();

export type ReachSuggestion = z.infer<typeof reachSuggestionSchema>;

// tag-net-expansion-10-13-followup-adhoc-recompute-budget (AC2.6/AC2.7) — the two ADDITIVE
// timeout-race fields, appended to all THREE move variants below (this one + the node move + the
// minigame move) via the same `z.literal(true).optional()` pattern Story 8.3 used for
// `reason.rung`/`reason.confidence`. `z.literal(true).optional()`, NEVER `z.boolean()`: a `false`
// value would ADD a key to every fast (unchanged) response and break the byte-identity AC1.2
// requires. Absent = today's shape.
/** Present ONLY when the adhoc recompute outran the foreground budget. Absent = today's shape. */
const tasteModelUpdatingField = { tasteModelUpdating: z.literal(true).optional() };
/** Present ONLY alongside `tasteModelUpdating`, and ONLY when the request opted into `&notify=1` —
 *  confirms the notify-me request was received (vs silently dropped) so the client UI can settle. */
const notifyOnReadyAcceptedField = { notifyOnReadyAccepted: z.literal(true).optional() };

export const nextMoveGameMoveSchema = z.object({
  gameId: z.number().int(),
  reason: reasonPayloadSchema,
  gameTitle: z.string().optional(),
  gameSlug: z.string().optional(),
  // Cover art for the card (the `attributes->>'coverImageUrl'`-and-fallbacks scalar).
  // Nullish: a game may have no image, and the card renders a neutral placeholder.
  gameImageUrl: z.string().nullish(),
  // Story 9.2 — OPTIONAL-ADDITIVE (mirrors the 8.3 `rung`/`confidence` precedent above): the warm
  // taste path attaches this when a redundancy rut warrants offering to widen reach. Optional so the
  // live 7.4/8.3 response stays valid and old clients simply ignore it (backward-compat).
  reachSuggestion: reachSuggestionSchema.optional(),
  // Taste Information Matrix Story 4.1 (FR-4/IM-6) — OPTIONAL-ADDITIVE, GAME MOVE ONLY (mirrors the
  // `reachSuggestion` precedent immediately above): the serve-path resolver
  // (`@subtails/discovery`'s `resolveEvidenceForMove`) attaches this when the served game carries a
  // `game_evidence_bindings` row for the reason's headline trait facet. Absent = today's text-only
  // card, byte-for-byte backward-compatible — the node move and the minigame move are NOT touched,
  // since neither serves a game, so neither can carry a game's evidence.
  evidence: evidencePayloadSchema.optional(),
  // taste-information-matrix Story 5.2 (FR-5, AC7.2, D8) — OPTIONAL-ADDITIVE, GAME MOVE ONLY,
  // same precedent as `evidence` immediately above: the serve-path coverage ladder
  // (`@subtails/discovery`'s `resolveEvidenceLadder`) attaches this for the two below-Proven rungs
  // that carry real media (`candidate`/`general_media`). Absent = today's shape: a `proven` serve
  // keeps using `evidence` unchanged, and `enrich`/`suppressed` add no key at all — every existing
  // response stays byte-identical. The node move and the minigame move are NOT touched, mirroring
  // `evidence`'s own game-move-only scope.
  evidenceLadder: evidenceLadderPayloadSchema.optional(),
  ...tasteModelUpdatingField,
  ...notifyOnReadyAcceptedField,
});

// The NODE / CONCEPT move — Story 5.12's depth-first drill-down auto-deepen variant (the "move mode"
// this header always anticipated as a later EXTENSION). It carries MACHINE METADATA ONLY: the tag-net
// child `nodeId`, the taste `dimension`, and the node's existing `labelKey` (Story 5.3's `tag-nodes`
// i18n key — so NO new user-facing string). The client localizes `labelKey`; the backend emits no
// prose (D8). It is DISTINGUISHED from the game move by the presence of `nodeId` (vs `gameId`), so the
// union below resolves each variant unambiguously WITHOUT reshaping the game move.
export const nextMoveNodeMoveSchema = z.object({
  nodeId: z.number().int(),
  dimension: z.string(),
  labelKey: z.string(),
  reason: reasonPayloadSchema,
  ...tasteModelUpdatingField,
  ...notifyOnReadyAcceptedField,
});

// The cold-start MINIGAME SPEC — the CANONICAL, single-source zod schema for the broad-question
// surfaces. It carries STABLE machine tokens ONLY (concept keys, mode/facet/pole ids) — never localized
// copy — so the client resolves every label via next-intl at render time and this contract stays
// locale-free (NO new i18n key). `@subtails/discovery` re-derives its `MinigameSpec` from THIS
// schema (legal layer direction — contracts is the lower package; discovery imports it), so the wire spec
// and the producer spec are ONE definition that cannot drift.
//
// THE FOUR STATIC kinds (Genre Rush / How-You-Play / Would-You-Rather / Deal-Breakers) carry meta tokens
// only. Story 8.4 ADDS three CATALOG-BACKED kinds (This-or-That / Vibe Check / Draft-Your-5) that carry
// per-game DATA the catalog producers select — a game `label` is the catalog `games.title`, a PROPER NOUN
// carried VERBATIM (there is no localized form of a game title, so it is NOT an i18n key — NFR-4); an
// `imageUrl` is a sanctioned media ref (a targeted `attributes` art scalar / a cleared curated node
// image). The extension is purely ADDITIVE to the discriminated union: the four static variants stay
// byte-for-byte, so every existing parity/engine test passes unedited.

/**
 * One This-or-That option (Story 8.4) — mirrors the client `PairOption` (`pair-choice.tsx:24`). `id` is
 * a stable machine id (the catalog game id as text — the pairwise winner→`subjectId` / loser→`comparisonId`
 * the shipped `buildPairChoiceSignal` writes); `label` is the catalog `games.title` (a proper noun carried
 * verbatim, NOT an i18n key); `imageUrl` is an OPTIONAL targeted cover/screenshot art scalar for the
 * mini-card (nullish — a game may have no cleared image and the card renders a neutral placeholder).
 */
export const pairOptionSpecSchema = z.object({
  id: z.string(),
  label: z.string(),
  imageUrl: z.string().nullish(),
});

export type PairOptionSpec = z.infer<typeof pairOptionSpecSchema>;

/**
 * Taste Engine Story 10.3 (D2, AD-14) — one FOREST-GENERATED option: a live `game_tag_nodes` row's
 * `id` (`nodeId`, the pairwise winner/loser subject and the concept-commit subject) plus its
 * `label_key` (the i18n nested key the client resolves via `tTagNodes(labelKey)`, codegen-written in
 * all 8 locales for every node — fact 6, no hand gate). This is the SAME `nodeId` + `labelKey` shape
 * `labelVote` and `buildNodeMove` already carry — never a re-hardcoded pole/concept token (§9.1).
 */
export const tagNodeOptionSpecSchema = z.object({
  nodeId: z.number(),
  labelKey: z.string(),
});

export type TagNodeOptionSpec = z.infer<typeof tagNodeOptionSpecSchema>;

/**
 * One Draft-Your-5 option (Story 8.4) — mirrors the client `DraftOption` (`draft-your-five.tsx:28`).
 * `id` is the catalog game id as text (the pick's `subjectId`); `label` is the catalog `games.title`
 * carried verbatim; `imageUrl` is the OPTIONAL cover art scalar.
 */
export const draftOptionSpecSchema = z.object({
  id: z.string(),
  label: z.string(),
  imageUrl: z.string().nullish(),
});

export type DraftOptionSpec = z.infer<typeof draftOptionSpecSchema>;

// ===========================================================================
// THE CANONICAL TAG-NET DIMENSION VOCABULARY (taste-profile Story 5.3 — TN-2).
//
// `game_tag_nodes.dimension` is the ONE canonical facet vocabulary the whole
// tag-net feature reads. This contract is its SINGLE SOURCE OF TRUTH: the reviewed
// seed (`packages/db/src/seed/game-tag-nodes.seed.ts`) re-exports the two lists below
// under the same `CANONICAL_TAG_DIMENSIONS` / `TASTE_NARROWABLE_TAG_DIMENSIONS` names, so
// there is exactly ONE authored copy of the set in the repo (a db guard asserts the
// seed's re-export IS this list, so the two can never drift).
//
// IT IS A ZOD ENUM / TS UNION, NOT A POSTGRES ENUM. `game_tag_nodes.dimension` is
// `text` BY DESIGN (spine §Data model, same posture as `user_preference_freshness.field_key`
// and `content_filter_attestations.from_level`): the closed set lives here, in application
// code, and NO migration ever encodes it. This story makes zero schema/migration change.
//
// RECONCILIATION — this set reconciles the two divergent SHIPPED namespaces into one:
//   • `game_labels.dimension` (`mood | art_style | mechanic | theme | tag`) and
//   • the discovery curated trait words, `CURATED_TRAIT_LABEL_OVERLAY`
//     (`genre | pace | narrative | artStyle | mood | length`).
//   Casing: the camelCase `artStyle` collapses to the snake_case `art_style` (one canonical
//   spelling — `game_labels` is authoritative). Store tags: the flat `'tag'` pseudo-dimension is
//   COLLAPSED — store tags are classified into real dimensions by the Job-B classifier (5.6), so
//   `tag` is never a node/canonical dimension. `narrative` and `length` are content-level writable
//   facets that stay in the curated overlay; they are NOT tag-net forest dimensions in v1
//   (the 5.1 spike validated narrowability only for mechanic/art_style/mood/theme).
//
// THE INVARIANT THIS VOCABULARY BACKS: a node-carrying `game_labels` row's `dimension` MUST equal
// its node's `dimension`. The Job-B classifier (5.6) emits INTO this vocabulary; enforcement of the
// row↔node dimension match lands downstream (5.4 FK + 5.6 classifier), NOT in this contract.
//
// APPEND-ONLY: the values mirror the seed's shipped, guard-proven reality. Growth happens ONLY
// through a `/tag-net-refresh` round's codegen (the operator-approved path, TNX-3/TNX-4) — never
// a hand edit here; shrinking or reordering is forbidden outright (the seed's forest-integrity +
// stable-id guards are mutation-proven against the registered values).
// Kept as plain string literals so `@subtails/contracts` stays dependency-free (no `@subtails/db`
// import) — exactly like `FIELD_KEYS` / `FIELD_KEY_COLUMNS` above.
//
// HOISTED ABOVE `minigameSpecSchema` (Taste Information Matrix Story 2.5, AC10). This block
// used to live ~900 lines below the minigame spec block, after `z.enum(...)` for `labelVote`'s
// `dimension` had already run at module-evaluation time — so making that literal DERIVE from
// `CANONICAL_TAG_DIMENSIONS` in place would have been a temporal-dead-zone `ReferenceError` on
// import, invisible to `tsc` (a `const` is not readable before its own declaration executes, and
// referencing an export before its defining statement has run throws at RUNTIME, not compile time).
// The block is self-contained (plain string literals, no imports of its own), so hoisting it is
// mechanical — every comment carried verbatim, no semantic change.
// ---------------------------------------------------------------------------

// The registered dimensions — the live, OPEN registry (engineering-invariants §9.1): the set is
// data, grown by `/tag-net-refresh` rounds, of arbitrary size; these are the axes registered so
// far, not a design cap. A refresh round's codegen appends here (TNX-3); consumers iterate this
// tuple and must tolerate members that did not exist when they were written.
export const tagDimensionEnum = z.enum([
  'soundtrack',
  'setting',
  'play_mode',
  'perspective',
  'narrative',
  'challenge',
  'business_model',
  'mechanic',
  'art_style',
  'mood',
  'theme',
  'genre',
  'pace',
]);

export type TagDimension = z.infer<typeof tagDimensionEnum>;

// The iterable canonical set (the enum's option tuple) — the ONE authored copy the seed
// re-exports and every downstream reader draws from. Mirrors the `FIELD_KEYS` shape above.
export const CANONICAL_TAG_DIMENSIONS = tagDimensionEnum.options;

// The TASTE-NARROWABLE subset (engineering-invariants §9.2; tag-net-integration §2 R7): the
// dimensions the taste ENGINE may narrow (drill down) into via `resolveNodeForMode`. This gates
// ONLY the engine's inference — child nodes may exist under ANY registered dimension (their
// existence is governed by the round's human review + the forest-integrity guard, never by this
// enum), and the filter/browse/typeahead surfaces read node existence, indifferent to this flag.
// Membership is an explicitly-ratified per-dimension operator decision (a 5.1-measurement PASS is
// necessary evidence, never sufficient); a dimension not listed here — including every newly
// minted axis — defaults to NOT narrowable. Seeded from the four dimensions that passed the 5.1
// spike; re-tested by tag-net-expansion Story 10.6.
export const tasteNarrowableTagDimensionEnum = z.enum(['mechanic', 'art_style', 'mood', 'theme']);

export type TasteNarrowableTagDimension = z.infer<typeof tasteNarrowableTagDimensionEnum>;

export const TASTE_NARROWABLE_TAG_DIMENSIONS = tasteNarrowableTagDimensionEnum.options;

// ---------------------------------------------------------------------------
// Steam preferences Story 3.1 (CAP-8, FR-20/FR-23, AD-8) — the Insight Check move's vocabularies and
// spec. HOISTED ABOVE `minigameSpecSchema` for the same temporal-dead-zone reason as the block above:
// the union evaluates these at module load. Plain `z.enum` values with no imports of their own.
// ---------------------------------------------------------------------------

/**
 * The four contradiction classes the engine can ask about (FR-24): three game-subject classes read
 * off the ledger and the snapshot, one axis-subject class (a Declared Exclusion against a strong
 * positive in-app signal on the same axis). Candidate generation (Story 3.2) stamps one of these on
 * `steam_preference_resolutions.contradiction_class`.
 */
export const steamContradictionClassSchema = z.enum([
  'substantial_playtime_dismissal',
  'dismissed_and_wishlisted',
  'dismissed_and_followed',
  'declared_exclusion_vs_positive',
]);
export type SteamContradictionClass = z.infer<typeof steamContradictionClassSchema>;

export const steamGameContradictionClassSchema = steamContradictionClassSchema.extract([
  'substantial_playtime_dismissal',
  'dismissed_and_wishlisted',
  'dismissed_and_followed',
]);
export const steamAxisContradictionClassSchema = steamContradictionClassSchema.extract([
  'declared_exclusion_vs_positive',
]);

/**
 * The settled outcome a GAME-subject Insight Check can record (`steam_preference_resolutions.resolution`).
 * Every member maps to one distinct meaning for the model: `finished_it` and `played_elsewhere` mean
 * the player is done with the game (it stops being suggested, its qualities still count);
 * `gave_up` and `not_for_me` are the player's own refusal; `still_want_it` retracts the dismissal.
 * A decline is NOT a resolution: it moves the ledger state to `declined` and writes no outcome.
 */
export const steamGameResolutionSchema = z.enum([
  'finished_it',
  'played_elsewhere',
  'gave_up',
  'not_for_me',
  'still_want_it',
]);
export type SteamGameResolution = z.infer<typeof steamGameResolutionSchema>;

/**
 * The settled outcome an AXIS-subject Insight Check can record: the player keeps the exclusion, or
 * says the axis is fine for them after all.
 */
export const steamAxisResolutionSchema = z.enum(['keep_avoiding', 'open_to_it']);
export type SteamAxisResolution = z.infer<typeof steamAxisResolutionSchema>;

/** Every value `steam_preference_resolutions.resolution` may hold, across both subject types. */
export const steamResolutionValueSchema = z.union([steamGameResolutionSchema, steamAxisResolutionSchema]);
export type SteamResolutionValue = z.infer<typeof steamResolutionValueSchema>;

/**
 * The VERBATIM transcription of the record's own Steam dismissal reason code
 * (`steam_preference_resolutions.dismissal_reason`) — **NOT a Resolved Meaning**. `played_elsewhere`
 * appears in BOTH this vocabulary and {@link steamResolvedMeaningSchema}, and they name two
 * different facts: a reason code is what Steam itself stored on the dismissal; a meaning is what
 * the ownership + playtime join CONCLUDED from it (a reason-`0` dismissal can resolve to
 * `disliked`, `exhausted`, `unplayed_residue`, or `unresolved`, never just "not interested").
 * `unknown` covers a reason code outside `{0, 2}` on a subject the ledger still stamps (game
 * subjects only reach the ledger via a resolved meaning, so this member exists for forward
 * completeness rather than a Phase B write path).
 */
export const steamDismissalReasonSchema = z.enum(['not_interested', 'played_elsewhere', 'unknown']);
export type SteamDismissalReason = z.infer<typeof steamDismissalReasonSchema>;

/**
 * The Insight Check spec payload (AD-8): `kind: 'insightCheck'` is one member of the minigame union,
 * internally discriminated by `subject.subjectType` (mirrors the ledger's `subject_type`). Both
 * variants carry STRUCTURED evidence only (the client builds the sentence, inherited AD-8/D8) and an
 * `answers` list of distinct resolutions for that subject type, plus `canDecline: true`: a decline
 * is always offered, never a forced guess (FR-23).
 *
 *   - game: title-shown (FR-21), so it carries `title` and an optional `coverUrl` (the library image the
 *     served move resolves; absent when the game has none).
 *   - axis: the excluded axis is the subject; `nodeId`/`labelKey` mirror `genreRush`'s forest-node
 *     identity, with the count of strong positive in-app signals that contradict the exclusion.
 */
export const insightCheckGameSubjectSchema = z.object({
  subjectType: z.literal('game'),
  appid: z.string(),
  gameId: z.number().int(),
  title: z.string(),
  coverUrl: z.string().optional(),
  evidence: z.object({
    contradictionClass: steamGameContradictionClassSchema,
    dismissalReason: steamDismissalReasonSchema,
    playtimeMinutes: z.number().int().nonnegative().nullable(),
  }),
  answers: z.array(steamGameResolutionSchema).min(2).readonly(),
  canDecline: z.literal(true),
});

export const insightCheckAxisSubjectSchema = z.object({
  subjectType: z.literal('axis'),
  nodeId: z.number().int(),
  labelKey: z.string(),
  evidence: z.object({
    contradictionClass: steamAxisContradictionClassSchema,
    positiveSignalCount: z.number().int().nonnegative(),
  }),
  answers: z.array(steamAxisResolutionSchema).min(2).readonly(),
  canDecline: z.literal(true),
});

export const insightCheckSubjectSchema = z.discriminatedUnion('subjectType', [
  insightCheckGameSubjectSchema,
  insightCheckAxisSubjectSchema,
]);
export type InsightCheckSubject = z.infer<typeof insightCheckSubjectSchema>;

/**
 * steam-preferences Story 3.4: the Insight Check settle request. The client names ONLY the subject it
 * was shown (a game's Steam appid, an axis node id) and the player's answer, or `decline`. Evidence,
 * the catalog game id, the node and every weight come from the ledger, never from this body. The
 * answer vocabulary is per subject type, so a game answer on an axis subject is a validation error.
 * `csrfToken` is the double-submit token the route checks outside the test env.
 */
export const INSIGHT_CHECK_DECLINE_ANSWER = 'decline' as const;
export const insightCheckSettleRequestSchema = z.discriminatedUnion('subjectType', [
  z.object({
    subjectType: z.literal('game'),
    appid: z.string().regex(/^\d{1,12}$/),
    answer: z.union([steamGameResolutionSchema, z.literal(INSIGHT_CHECK_DECLINE_ANSWER)]),
    csrfToken: z.string(),
  }),
  z.object({
    subjectType: z.literal('axis'),
    nodeId: z.number().int().positive(),
    answer: z.union([steamAxisResolutionSchema, z.literal(INSIGHT_CHECK_DECLINE_ANSWER)]),
    csrfToken: z.string(),
  }),
]);
export type InsightCheckSettleRequest = z.infer<typeof insightCheckSettleRequestSchema>;

/** The settle route's success body: what the call did. `already_settled` writes nothing. */
export const insightCheckSettleResponseSchema = z.object({
  status: z.enum(['settled', 'declined', 'already_settled']),
});
export type InsightCheckSettleResponse = z.infer<typeof insightCheckSettleResponseSchema>;

export const minigameSpecSchema = z.discriminatedUnion('kind', [
  // Taste Engine Story 10.3 (D2, AD-14) — a Genre Rush concept is now a FOREST NODE under the
  // registered `genre` dimension (`move-content.ts`'s `buildConceptContent`), never a hand-listed
  // `conceptKey` token. `nodeId`/`labelKey` mirror `tagNodeOptionSpecSchema` (kept flat, not nested,
  // matching `labelVote`'s existing flat style in this same union).
  z.object({ kind: z.literal('genreRush'), nodeId: z.number(), labelKey: z.string() }),
  z.object({ kind: z.literal('howYouPlay'), modes: z.array(z.string()).readonly() }),
  // Taste Engine Story 10.3 (D2, AD-14) — a Would-You-Rather pair is now TWO SIBLING FOREST NODES
  // under `dimension` (`move-content.ts`'s `buildAbPairContent`), never the deleted
  // `WOULD_YOU_RATHER_COLD_PAIRS` pole-token table. `dimension` stays the registered dimension the
  // pair trades (any `CANONICAL_TAG_DIMENSIONS` member, open per §9.1 — never narrowed to the old
  // four-entry table).
  z.object({
    kind: z.literal('wouldYouRather'),
    dimension: z.string(),
    options: z.array(tagNodeOptionSpecSchema).length(2).readonly(),
  }),
  z.object({ kind: z.literal('dealBreakers'), facets: z.array(z.string()).readonly() }),
  // --- Story 8.4 catalog-backed kinds (appended — additive; the four static kinds above stay byte-for-byte) ---
  // This-or-That: a DISCRIMINATING title pair (the producer selects the two games that best discriminate
  // on the low-confidence dimension). EXACTLY two options (`.length(2)` — the pairwise mechanic is strictly
  // binary), mirroring the client `thisOrThat` `MinigameMove` (`play-session.tsx:102`). A `.length(2)`
  // ARRAY (not a `z.tuple`) so the inferred element type survives the `@subtails/contracts → discovery →
  // client` package boundary cleanly; the client maps the two elements into its own readonly 2-tuple.
  z.object({
    kind: z.literal('thisOrThat'),
    options: z.array(pairOptionSpecSchema).length(2).readonly(),
  }),
  // Vibe Check: a labelable screenshot for a `mood`|`art_style` dimension (title HIDDEN by the render).
  // Mirrors the client `vibeCheck` `MinigameMove` exactly (`play-session.tsx:105`) — `imageUrl` is REQUIRED
  // (the producer emits this kind ONLY when a real image resolves; else it degrades to a static spec / game).
  z.object({
    kind: z.literal('vibeCheck'),
    subjectId: z.string(),
    subjectType: z.string(),
    dimension: z.enum(['mood', 'art_style']),
    imageUrl: z.string(),
  }),
  // Label Vote (Story 10-12-followup-crowd-label-vote-surface): a label-bearing candidate elicitation
  // surface for crowd-label confirmation (title-hidden imagery + Yes/No/Not-sure verdict on ONE candidate
  // label, mirroring Vibe Check but as a NEW sibling kind — not a payload patch to vibeCheck's contract).
  // Dimension DERIVES from the same registry `LABEL_DIMENSIONS` mirrors (Taste Information Matrix
  // Story 2.5, AC10) — `[...CANONICAL_TAG_DIMENSIONS, 'tag']`, hoisted above this block — rather than a
  // second hand-written literal that used to silently disagree with `packages/discovery/src/
  // consensus.ts:LABEL_DIMENSIONS` the moment either one widened. `createLabelVoteCandidateReader`
  // (`catalog-surfaces.ts`) selects candidates via `inArray(gameLabels.dimension, LABEL_DIMENSIONS)`,
  // so this schema MUST widen in lockstep with that set or a newly-legal dimension's candidate would
  // parse-fail at serve time. label is the candidate `game_labels.label` text (machine token, carried
  // verbatim to extractLabelVote); labelKey is the tag-net node's `label_key` (i18n nested key for
  // display lookup via `tTagNodes(labelKey)`); nodeId is the selected candidate's `game_tag_nodes.id`
  // (machine identifier, never user-facing); imageUrl is REQUIRED (same contract as vibeCheck — producer
  // emits ONLY when image resolves).
  z.object({
    kind: z.literal('labelVote'),
    subjectId: z.string(),
    subjectType: z.string(),
    dimension: z.enum([...CANONICAL_TAG_DIMENSIONS, 'tag'] as const),
    label: z.string(),
    labelKey: z.string(),
    nodeId: z.number(),
    imageUrl: z.string(),
  }),
  // Draft-Your-5: a candidate SET (the constrained-select finale). Mirrors the client `draftYour5`
  // `MinigameMove` (`play-session.tsx:108`).
  z.object({ kind: z.literal('draftYour5'), options: z.array(draftOptionSpecSchema).readonly() }),
  // --- Steam preferences Story 3.1 (appended — additive; every kind above stays byte-for-byte) ---
  // Insight Check: a settle-the-contradiction question about one game or one excluded axis.
  z.object({ kind: z.literal('insightCheck'), subject: insightCheckSubjectSchema }),
]);

// The MINIGAME move — Epic 8's confidence-routed broad-question surface (the third additive variant, the
// same "move mode" the header anticipated). It carries a locale-free `spec` (the cold-start minigame the
// client renders via the shipped `specToMinigameMove` / `MinigameSurface`) plus the same non-null
// structured `reason` every surface carries (so the always-a-next-move contract holds for it too — AC3).
// It is DISTINGUISHED from the game/node moves by the `surface: 'minigame-spec'` discriminant (the game
// and node variants carry no `surface`, so absent = today's game, byte-for-byte). The server does not
// EMIT this variant yet (that is confidence routing, Story 8.3) — 8.2 only makes the response ABLE to
// carry it. WITHOUT reshaping the game or node move.
export const nextMoveMinigameMoveSchema = z.object({
  surface: z.literal('minigame-spec'),
  spec: minigameSpecSchema,
  reason: reasonPayloadSchema,
  ...tasteModelUpdatingField,
  ...notifyOnReadyAcceptedField,
});

// Taste-engine Story 5.3 (AD-13, Decision 1) — THE TERMINAL STATE. When the ladder's two tiers
// (`selectFromTiers` in `@subtails/discovery`) both return `null` — every rated game already seen,
// owned or suppressed — the engine resolves this typed variant instead of throwing. `kind`, not
// `surface`: every served variant's client/route/harness code reads `'surface' in move` as "this is
// a minigame", so a `surface: 'terminal'` would be misread and crash on `next.spec.kind`; no served
// variant carries a top-level `kind`, so it discriminates cleanly. `cause`, not `reason`: every served
// variant's `reason` is a `ReasonPayload` object read generically as `move.reason.factors`, so a
// string `reason` would be a trap. `.strict()` (the `interstitialDescriptorSchema` AD-8/D8 precedent
// above): the backend emits no prose, ever, on this variant. The recompute-race fields are carried
// because the route's adhoc-recompute race runs before the engine call and every response body,
// including this one, may need to carry the "picks updating" banner. APPEND-ONLY: `cause` grows only
// by adding a new enum member; never rename or reshape a committed member.
//
// Taste Engine Story 10.7 (D5): learning saturation is reported on the `move_selected`/
// `next_move_terminal` operator log lines (the `learningState` field) and never ends a session. A
// saturated player still gets taste-retrieved and supply game cards — the discovery value the product
// exists for (PRD SM-C1) — so no `learning_saturated` cause is added here. This enum stays exactly
// `['pool_exhausted']`.
export const nextMoveTerminalCauseSchema = z.enum(['pool_exhausted']);

export type NextMoveTerminalCause = z.infer<typeof nextMoveTerminalCauseSchema>;

export const nextMoveTerminalSchema = z
  .object({
    kind: z.literal('terminal'),
    cause: nextMoveTerminalCauseSchema,
    ...tasteModelUpdatingField,
    ...notifyOnReadyAcceptedField,
  })
  .strict();

// The next-move response CONTRACT — the union the /next route validates against, so a drill-down
// `tag_node` serve (Story 5.12, AC5), a cold-start minigame surface (Epic 8) and the Story 5.3
// terminal state are each a first-class, schema-valid outcome. The game variant is tried first (its
// required `gameId` distinguishes it); a node move (no `gameId`, has `nodeId`), a minigame move (no
// `gameId`, has `surface`/`spec`) and the terminal (has `kind: 'terminal'`, no `gameId`/`nodeId`/
// `surface`) each fall through to their own variant. ADDITIVE — none of the three served variants is
// reshaped. NOT a `z.discriminatedUnion`: the served variants share no discriminant key, and the
// terminal is appended LAST so the existing parse order (game → node → minigame) is unchanged.
export const nextMoveResponseSchema = z.union([
  nextMoveGameMoveSchema,
  nextMoveNodeMoveSchema,
  nextMoveMinigameMoveSchema,
  nextMoveTerminalSchema,
]);

// `NextMoveResponse` stays the GAME-move type (backward-compatible for every existing typed caller);
// `NextMoveNodeMove` and `NextMoveMinigameMove` are the machine-metadata SERVED variants; `NextMoveMove`
// is the EXPLICIT served union — a caller opts into it when it handles all three served shapes (e.g.
// Epic 6's Differentiate UI, Epic 8's cold surface) — and is intentionally NOT `z.infer` of the wire
// schema any more, so its meaning ("a move a caller renders/acts on") does not silently widen to
// include the terminal for `applyServedMove`, `move-to-signal.ts` or `session-loop.ts`. `NextMoveOutcome`
// names the full wire body (served OR terminal) — what the route parses and returns, and what a
// consumer that must handle the terminal (the client, the harness) receives. The engine's `nextMove`
// returns the narrower `NextMoveResponse | NextMoveTerminal` at the type boundary; the schema (union) is
// what validates a node, minigame or terminal body at runtime.
export type NextMoveResponse = z.infer<typeof nextMoveGameMoveSchema>;
export type NextMoveNodeMove = z.infer<typeof nextMoveNodeMoveSchema>;
export type NextMoveMinigameMove = z.infer<typeof nextMoveMinigameMoveSchema>;
export type MinigameSpec = z.infer<typeof minigameSpecSchema>;
export type NextMoveTerminal = z.infer<typeof nextMoveTerminalSchema>;
export type NextMoveMove = NextMoveResponse | NextMoveNodeMove | NextMoveMinigameMove;
export type NextMoveOutcome = z.infer<typeof nextMoveResponseSchema>;

/**
 * The single owner of "is this the terminal state" (Decision 1). Every consumer — the route, the
 * client, the taste-engine-validation harness — calls this rather than re-deriving the check (e.g.
 * `'kind' in x`), so the discrimination lives in exactly one place. Pure and browser-safe (no DB, no
 * side effect), so the client can import it directly from `@subtails/contracts`.
 */
export function isNextMoveTerminal(x: NextMoveOutcome): x is NextMoveTerminal {
  return 'kind' in x && x.kind === 'terminal';
}

// ---------------------------------------------------------------------------
// Taste Engine Story 10.5 (D1, D3) — the RENDER-KIND vocabulary, derived at runtime from the
// same schema that decides what the engine may serve, never a hand-written list (the
// `taste-insights.open-forest.test.ts:604` / `concept-responder.ts:492` precedent). `'game'`,
// `'node'` and `'terminal'` are the three non-minigame served shapes `nextMoveResponseSchema`'s
// union carries; the rest are `minigameSpecSchema`'s own discriminants, read straight off
// the shipped contract so a ninth spec kind widens `RENDERABLE_MOVE_KINDS` automatically instead of
// silently bypassing every consumer that enumerates it (fact 7 — a guard that parses a kind list out
// of source is a fixed-list guard wearing a parser; this constant is the fix, read from the contract
// itself and nowhere else).
// ---------------------------------------------------------------------------
export type RenderableMoveKind = 'game' | 'node' | 'terminal' | MinigameSpec['kind'];

export const RENDERABLE_MOVE_KINDS: readonly RenderableMoveKind[] = [
  'game',
  'node',
  'terminal',
  ...minigameSpecSchema.options.map((o) => o.shape.kind.value as MinigameSpec['kind']),
];

/**
 * D3 — an explicitly-empty, NAMED operator decision: a spec kind listed here is one the engine's
 * candidate producers CAN build but the shipped client CANNOT yet render (e.g. a kind added to the
 * contract ahead of its client release). `packages/discovery`'s minigame candidate assembly drops
 * any spec kind in this set from the candidate list BEFORE any score is computed (an eligibility
 * gate, never a score/comparator/ordering input — §9.3). Empty today: every kind the schema carries
 * has a `MOVE_FRAMES` row on the client. That is NOT a reason to remove the gate — the gate is what
 * makes "a kind that cannot render is not servable" a mechanism instead of a sentence, and it is
 * proven live by a test that temporarily names a real kind here and observes the engine stop serving
 * it while still serving the others. An entry here is an operator decision with a recorded reason,
 * never a convenience default.
 */
export const NON_RENDERABLE_SPEC_KINDS: readonly MinigameSpec['kind'][] = [];

// ---------------------------------------------------------------------------
// Wishlist save request/response (Story 8.4) — the Discovery-Event wishlist save.
//
// When a Suggestion is a Discovery Event (the confident, taste-explained pick),
// the play surface offers "Save to Play-Next". That save posts this request to
// `POST /api/explore/save`, which writes one `play_next_queue` row for the user
// (idempotent on the `ux_play_next_queue_user_game` unique index). Realizes the
// wishlist-integration half of FR-19.
//
// Mirrors `signalWriteRequestSchema` deliberately: the CSRF token travels in the
// body (canonical mutating-route pattern) and is STRIPPED by the route before the
// write (the domain service never sees it). Do NOT reshape existing schemas — this
// is additive.
// ---------------------------------------------------------------------------

export const wishlistSaveRequestSchema = z.object({
  // The catalog game to save (the served `move.gameId`). `.positive()` mirrors the
  // canonical Play-Next route's gameId constraint: a 0/negative id is a client bug,
  // not a valid FK, so reject it at 400 rather than let the FK violation surface as 500.
  gameId: z.number().int().positive(),
  // Ephemeral client-issued session id (no FK); optional — carried for parity
  // with the signal contract / future provenance, not persisted by 8.4's save.
  sessionId: z.string().optional(),
  // The CSRF token travels in the body (canonical pattern — see the signal route).
  // The SERVICE must never persist this; the route strips it before delegation.
  csrfToken: z.string(),
});

export type WishlistSaveRequest = z.infer<typeof wishlistSaveRequestSchema>;

export const wishlistSaveResponseSchema = z.object({
  ok: z.boolean(),
  // Whether a new row was written this call.
  saved: z.boolean(),
  // True when the game was already in the queue (idempotent no-op, not an error).
  alreadySaved: z.boolean().optional(),
  // True when the target game does not exist in the catalog (the route maps this to
  // a 404). ADDITIVE — a plain fresh/already-saved result omits it, so existing
  // clients and the 200/409 paths are unaffected. Guards against a bad gameId
  // surfacing as a 500 on the FK violation.
  notFound: z.boolean().optional(),
});

export type WishlistSaveResponse = z.infer<typeof wishlistSaveResponseSchema>;

// ---------------------------------------------------------------------------
// Taste-profile read model (Story 1.3, AD-8 / NFR-4) — the shared, localizable
// descriptor the `getTasteProfile` read model (`@subtails/discovery`) emits and the
// taste board (Story 1.4) renders. The BACKEND EMITS NO PROSE: every user-facing
// word is a STABLE MACHINE CODE / TOKEN the client localizes through next-intl
// (mirrors `reasonFactorCodeEnum` / `likedTraitDataSchema` — D8). No raw signal, DB
// `id`, or `preference` vector ever reaches this contract (AD-8 — see the read model's
// bounded projection). Field names are camelCase (repo convention) even though the
// epic prose writes snake_case `mode_key` / `representative_image_ref`.
// ---------------------------------------------------------------------------

// The fixed, SEQUENTIAL certainty read — a word-first "how sure are we" bucket, NOT a
// raw score and NOT a green/amber/red traffic light. The three values stay in LOCKSTEP
// with the discovery config's `certaintyRead()` return type / `CERTAINTY_BANDS` keys
// (a config↔contract lockstep test asserts the two sets are identical, so a rename in
// one place breaks the build, not production). Ordered highest → lowest certainty. The
// client localizes each bucket key (no backend prose — NFR-4).
export const certaintyReadEnum = z.enum(['strong_read', 'fairly_sure', 'still_forming']);

// Named `CertaintyReadBucket` so it does NOT collide with the discovery config's
// `CertaintyRead` type export (the two are deliberate copies on opposite sides of the
// `@subtails/contracts` → `@subtails/discovery` layer boundary; contracts is the lower
// layer and cannot import the discovery type, so the lockstep test guards the drift).
export type CertaintyReadBucket = z.infer<typeof certaintyReadEnum>;

// The provenance of an inferred taste — how the model came to hold it, so the board can
// tell an HONEST story ("from how you've been playing" vs "you corrected this and it came
// back") without ever mislabeling a re-emerged/correction-derived read as organic (FR-4).
//   • 'organic'            → plainly inferred from play. The ONLY value emitted in Epic 1.
//   • 'correction_derived' → surfaced from a Differentiate correction (Story 6.6).
//   • 're_emerged'         → a previously-suppressed mode that came back on fresh agreeing
//                            evidence (`taste_mode_suppressions.re_emerged`, Story 1.9).
//   • 'told'               → a value the user EXPLICITLY added ("add a taste", Epic 7 / AD-8
//                            told amendment, ratified 2026-07-19). It is user-asserted, not
//                            inferred: it seeds the engine strong (Stated-Fact-like, NOT a
//                            suppression), surfaces with the "Added by you" OriginMarker, and is
//                            NEVER labeled "from how you've been playing". Emitted by the
//                            `source='told'` read overlay in `getTasteProfile`.
//   • 'warm_started'       → a claim the engine holds because of a title the player OWNS (Warm
//                            Start library seeding, taste-engine-3.2/3.6), not because of a Move
//                            they answered. Decided in `deriveProvenance`'s ONE seam
//                            (`taste-insights.ts`), LAST before `organic` — every other value
//                            describes something the player DID; this one describes what they OWN,
//                            and a claim the player has since sharpened or re-affirmed is better
//                            described by that act.
// APPENDED — never rename or reorder a committed value so persisted/derived codes stay
// stable (mirrors the `reasonFactorCodeEnum` convention above).
export const insightProvenanceEnum = z.enum(['organic', 'correction_derived', 're_emerged', 'told', 'warm_started']);

export type InsightProvenance = z.infer<typeof insightProvenanceEnum>;

// ---------------------------------------------------------------------------
// Taste Claim Reason Codes (Story 4.2, AD-18 §4) — a SECOND, independent reason-code
// vocabulary from `reasonFactorCodeEnum` (:47), append-only, following the same
// convention. `reasonFactorCodeEnum` explains why a CANDIDATE GAME was served (a Move's
// reason: exactly one code per weighted factor, rendered on the explore card, copy at
// `play.item.reason.*`). `tasteClaimReasonCodeEnum` explains why the engine HOLDS A
// BELIEF about the player (a Taste Mode's evidence: one OR MORE codes, ordered, rendered
// in the taste board `TokenInfo` popover, copy at `taste.board.reason.*`). Folding the
// two into one enum would give one vocabulary two meanings and would break the shipped
// copy-completeness guard's `REASON_PATH = ["play", "item", "reason"]` scoping over
// `explore.json`.
//
// NOT A SECOND SPELLING OF `insightProvenanceEnum` (:851). Provenance names EXACTLY ONE
// value — how the model came to hold the belief. A Reason Code names WHAT EVIDENCE
// STANDS BEHIND IT: one or more, ordered, carrying counts, and (for the library codes)
// the cited catalogue games. A warm-started avoidance claim carries provenance
// `warm_started` *and* the reason codes `owned_library_titles` (with its cited titles)
// *and* `avoidance_evidence` *and* `consistent_direction` (with its counts) — one
// provenance value cannot say that.
//
// APPEND-ONLY. Never rename or reorder a committed value (mirrors `reasonFactorCodeEnum`
// / `insightProvenanceEnum` above). The list a claim carries is ORDERED and NEVER EMPTY:
// a claim the derivation cannot otherwise explain emits `answered_moves` with a count as
// the total fallback (engineering-invariants §9.1 — a total fallback at the bottom of
// every ladder), never `[]`. `owned_library_titles` and `answered_moves` are NOT mutually
// exclusive — a claim can carry both; which one LEADS is the warm/answered marking,
// decided by `readClaimAttribution`'s existing proportionality test, never re-decided
// here.
//
//   • 'answered_moves'            → n Moves the player answered back this claim (the
//     behavioural default, and the total fallback every claim can fall back to).
//   • 'owned_library_titles'      → m titles the player owns back this claim; marked
//     WARM, not answered (AC3). Emitted for a PREFERENCE claim (`valence !== -1`) only —
//     an avoidance claim's warm rung emits `owned_library_titles_avoided` instead (below).
//   • 'consistent_direction'      → the attributed evidence agrees on direction (the
//     AC2/4.1 display-eligibility bar, restated in words — never a percentage or score;
//     `confidence.agree`/`.n` are dimension-relative, not a per-claim ratio). Emitted for a
//     preference claim only.
//   • 'avoidance_evidence'        → the evidence behind this claim is rejections, not
//     likes; carries the same `confidence.agree` count `consistent_direction` carries for
//     a preference claim (Taste Engine Story 4.5) — a count of concrete answered signals,
//     not a ratio or percentage, so §11's counts-yes/ratios-no rule is unaffected.
//   • 'owned_library_titles_avoided' → m titles the player owns point AWAY from this
//     claim (Taste Engine Story 4.5, AC2) — the warm rung's avoidance counterpart to
//     `owned_library_titles`, emitted when a warm claim's `valence === -1`. Same cited-
//     titles resolution and the same `count` derivation (R-006); only the direction of the
//     sentence and its heading differ.
//   • 'you_added_this'            → a told taste (`provenance === 'told'`).
//   • 'you_sharpened_this'        → correction-derived (`provenance === 'correction_derived'`).
//   • 'came_back_on_new_evidence' → re-emerged after a Disagree (`provenance === 're_emerged'`).
//
// Do NOT pre-commit codes for a future story's own semantics — each story appends its own
// codes with its own copy when it lands. `avoidance_evidence` is in THIS set because AC1
// requires every displayed claim to carry its reasons and 4.1 already put negative-
// valence modes on the board; `owned_library_titles_avoided` is in THIS set because 4.5
// gives the warm rung a valence-aware pair rather than leaving a preference sentence under
// an avoidance badge.
// ---------------------------------------------------------------------------
export const tasteClaimReasonCodeEnum = z.enum([
  'answered_moves',
  'owned_library_titles',
  'consistent_direction',
  'avoidance_evidence',
  'you_added_this',
  'you_sharpened_this',
  'came_back_on_new_evidence',
  'owned_library_titles_avoided',
]);

export type TasteClaimReasonCode = z.infer<typeof tasteClaimReasonCodeEnum>;

/**
 * One Reason Code entry on a claim's evidence panel — a machine code plus its OPTIONAL count (the
 * codes that carry a number, e.g. `answered_moves`, `owned_library_titles`). The client localizes
 * the code through `taste.board.reason.<code>` with ICU `{count}` where the code carries one.
 * `.strict()` — numbers and codes only, no free-text field (AC1, §6's no-free-prose rule).
 */
export const tasteClaimReasonSchema = z
  .object({
    code: tasteClaimReasonCodeEnum,
    count: z.number().int().nonnegative().optional(),
  })
  .strict();

export type TasteClaimReason = z.infer<typeof tasteClaimReasonSchema>;

/**
 * A cited catalogue game backing a claim — CATALOGUE DATA QUOTED VERBATIM (the same `games.title` /
 * `games.slug` every store page, browse tile and explore card already renders), never prose
 * generated at request time about this player. This is the ONE declared allowance in the
 * claim-evidence shape's "no free string" rule (§6): `.title` and `.slug` are strings, but they are
 * not an opinion about the player — they are the catalogue's own name for a game the claim is
 * citing. Pinned to exactly these two field names on exactly this schema — do NOT widen the
 * allowance to "strings on the evidence object"; that erases the invariant the no-free-prose guard
 * enforces.
 */
export const citedTitleSchema = z
  .object({
    gameId: z.number().int().positive(),
    title: z.string(),
    slug: z.string(),
  })
  .strict();

export type CitedTitle = z.infer<typeof citedTitleSchema>;

/**
 * The full evidence panel behind one displayed claim (AC1, AC3) — the Reason Codes plus the cited
 * catalogue games on each side of the warm/answered split. Every count the panel needs already rides
 * inside `reasons[].count` (read from `confidence.agree` — the mode's OWN cluster; never
 * `confidence.n`, which folds in a SIBLING mode's opposing evidence, and never
 * `confidence.strength`/`weight`, which gate ordering and display eligibility, not copy; see Dev
 * Notes "Where every number in the copy comes from"), so this object carries no separate,
 * unrendered count field.
 * `reasons.min(1)` enforces the never-empty rule by the parse itself, not by convention.
 * `ownedTitles` / `answeredTitles` are SEPARATELY labelled lists (never merged) so a warm claim is
 * marked warm rather than answered (AC3) — either may be empty, and an empty `ownedTitles` is the
 * overwhelmingly common case today (production holds zero `steam_library` signals), rendered as a
 * complete, honest panel, never an empty box.
 */
export const tasteClaimEvidenceSchema = z
  .object({
    reasons: z.array(tasteClaimReasonSchema).min(1),
    ownedTitles: z.array(citedTitleSchema),
    answeredTitles: z.array(citedTitleSchema),
  })
  .strict();

export type TasteClaimEvidence = z.infer<typeof tasteClaimEvidenceSchema>;

// A single Significant-Strength Insight descriptor — the STRUCTURED read of one taste mode
// (AD-8). `label` is the machine facet token (`fast`, `cozy`, `roguelike`, …), NEVER DB
// prose; the client localizes it (Story 1.4). `representativeImageRef` is the value's
// canonical-image key — `null` for every token until the Epic 5 asset store lands (the
// board degrades a null-ref token to plain; Story 1.13 owns that contract). No raw signal,
// DB `id`, or `preference` vector is ever present.
export const tasteTokenSchema = z.object({
  modeKey: z.string(),
  dimension: z.string(),
  label: z.string(),
  certainty: certaintyReadEnum,
  provenance: insightProvenanceEnum,
  representativeImageRef: z.string().nullable(),
  // taste-profile Story 6.5 (TN-5, AC4/AC5) — APPEND-ONLY additive fields (never reshape a shipped
  // field, mirrors the `reasonPayloadSchema.rung`/`confidence` convention). Both are the read model's
  // FRESH, read-time verdict (`getTasteProfile`), never persisted (TN-8 — a stored flag would be stale
  // the moment the forest moves).
  //   • `narrowable` → the token's resolved tag-net node has ≥1 undiscriminated, active, in-dimension,
  //     coherent (non-quarantined) child, so the board's "Go deeper" Differentiate entry is OFFERED
  //     (a leaf token is `false` → the x-only shape). Narrowability and provenance are ORTHOGONAL: this
  //     never relabels the `OriginMarker`/provenance line (AC6).
  //   • `resolvedNodeId` → the deep-link node identity (`taste_modes.resolved_node_id`, Story 5.11): a
  //     CATALOG-GLOBAL tag-net node id (public taxonomy identity, NEVER user data — AD-8), so it can
  //     ride the bare `/explore` seed URL. `null` for a cold / non-narrowable / node-less token.
  narrowable: z.boolean(),
  resolvedNodeId: z.number().nullable(),
  // Taste Engine Story 4.1 (AD-18 §4) — APPEND-ONLY, additive-OPTIONAL (mirrors the
  // `narrowable`/`resolvedNodeId` precedent above, but optional here rather than required, so every
  // pre-4.1 fixture/test literal across the repo keeps parsing without updating each one): which
  // direction the mode's evidence points, `1` liked or `-1` avoided. Read through the SINGLE
  // `valenceOf` accessor (`taste-insights-config.ts`) — never re-derived from `.score`/`.agree`
  // (`certainty-not-agreement.guard.test.ts` bans that substitution class for the analogous
  // certainty/agreement pair, and the same reasoning applies here). The real read path
  // (`toToken`, `taste-insights.ts`) always emits a concrete `1`/`-1`; `undefined` exists only for
  // a fixture/test literal authored before this field existed.
  valence: z.union([z.literal(1), z.literal(-1)]).optional(),
  // Taste Engine Story 4.2 (AD-18 §4) — APPEND-ONLY, additive-OPTIONAL, exactly like `valence`
  // (4.1) and for the same stated reason: every pre-4.2 fixture literal across the repo keeps
  // parsing without updating each one. The real read path (`toToken`, `taste-insights.ts`) always
  // emits a concrete `TasteClaimEvidence`; `undefined` exists only for a fixture/test literal
  // authored before this field existed.
  evidence: tasteClaimEvidenceSchema.optional(),
  // Taste Engine Story 4.3 (AD-18 §6, AC1/AC2) — APPEND-ONLY, additive-OPTIONAL, exactly like
  // `valence` (4.1) and `evidence` (4.2): every pre-4.3 fixture literal across the repo keeps
  // parsing without updating each one. The real read path (`toToken`/`buildToldToken`,
  // `taste-insights.ts`) always emits a concrete boolean; `undefined` exists only for a
  // fixture/test literal authored before this field existed.
  //
  // Today `provisional === (certainty !== 'strong_read')` — this field is DERIVABLE from the one
  // beside it, and is emitted anyway rather than left for the client to re-derive (the board's own
  // invariant: grouping/cap/overflow/certainty are never re-derived client-side). It earns its
  // place because Epic 8 repoints `PROVISIONAL_CLAIM_CERTAINTY_BAR` at the posterior's own
  // certainty while `certainty` stays the three-word ladder — at that moment the two stop
  // agreeing, and this one emitted boolean is the single place that change lands.
  provisional: z.boolean().optional(),
  // Taste Engine Story 8.9 (D9, AD-8, NFR-4) — APPEND-ONLY, additive-OPTIONAL, exactly like
  // `valence` (4.1) / `evidence` (4.2) / `provisional` (4.3): every pre-8.9 fixture literal across
  // the repo keeps parsing without updating each one. A MACHINE CODE, never prose — following 9-5's
  // precedent exactly (the backend emits a machine code and internal state never leaks to the
  // client): `'agreement'` is Stage 1's interim count-and-agreement bar (the shipped
  // `taste.board.provisional.note` sentence, an AGREEMENT sentence); `'certainty'` is Stage 2's
  // posterior-certainty bar (a DIFFERENT quantity Stage 2 owns, which the board maps to a SEPARATE
  // copy key naming certainty rather than agreement). ABSENT reads `'agreement'` — the Epic-1 /
  // Stage-1 default — so every existing fixture and Stage 1 render is byte-identical. The
  // `taste_model_owner` VALUE itself never reaches the client; only this derived machine code does.
  provisionalBasis: z.enum(['agreement', 'certainty']).optional(),
});

export type TasteToken = z.infer<typeof tasteTokenSchema>;

// One dimension's row on the board — its display-eligible tokens (bounded by the AD-7
// per-dimension cap, highest-strength first) plus an HONEST overflow count (`+N more`),
// so a fat dimension's initial render is bounded WITHOUT hiding access. `overflowCount`
// is everything the read KNOWS this dimension holds but did not render, from both sides
// of the group: `max(0, organicTokensInDimension − PER_DIMENSION_CAP)` PLUS the user's
// NET-ACTIVE told tastes in this dimension beyond `TOLD_NET_ACTIVE_READ_LIMIT`. Told
// tokens the read DID return are never capped — a taste you added by hand always shows —
// so the told term is zero for every user inside that bound.
export const dimensionGroupSchema = z.object({
  dimension: z.string(),
  tokens: z.array(tasteTokenSchema),
  overflowCount: z.number().int().nonnegative(),
});

export type DimensionGroup = z.infer<typeof dimensionGroupSchema>;

// WHY an empty board is empty, so the board picks HONEST copy (AD-8, Story 1.5). A
// STABLE MACHINE CODE the client localizes (never backend prose — NFR-4). Only set when
// the board is empty; a non-empty board omits it entirely (see `tasteProfileSchema`).
//   • 'cold_start'    → the user has never had a display-eligible Insight (no picture yet).
//                       The DEFAULT empty reason in Epic 1 (suppression does not exist).
//   • 'all_disagreed' → the user HAD eligible Insights that are all currently suppressed
//                       (they cleared their reads). DEFINED here + rendered by Story 1.5,
//                       but only made REACHABLE by the Story 1.8 AD-4 suppression overlay.
// Cold-start FIRST (the default), all-Disagreed second. APPENDED — never rename or reorder
// a committed value (mirrors `insightProvenanceEnum`), so persisted/derived codes stay stable.
export const emptyReasonEnum = z.enum(['cold_start', 'all_disagreed']);

export type EmptyReason = z.infer<typeof emptyReasonEnum>;

// Taste Engine Story 9.5 (D4, AC3(c), AD-8) — the correction control's copy-variant machine code. The
// wire carries THIS, never `taste_model_owner` itself: the client must never learn which Stage 2 owner
// value a player resolved to (AD-8), only which of the two ALREADY-WRITTEN copy variants to render.
//   • 'overlay_only'      → Story 9.4's restored Stage 1 wording (a correction has no model effect yet).
//   • 'overlay_and_model' → Story 9.5's new wording (a routed correction also shifts the Stage 2 posterior).
// APPENDED — never rename or reorder a committed value (mirrors `emptyReasonEnum` above), so a persisted
// or already-served code stays stable.
export const correctionEffectEnum = z.enum(['overlay_only', 'overlay_and_model']);

export type CorrectionEffect = z.infer<typeof correctionEffectEnum>;

// The top-level taste-profile envelope. Deliberately an OBJECT (not a bare array) so
// Story 1.5 could ADDITIVELY extend it with `emptyReason` (below) without reshaping the
// shipped Story-1.3 contract. `emptyReason` is `.optional()` (the repo's additive-field
// convention — mirrors `reasonPayloadSchema.rung`/`confidence`): the read model SETS it on
// an empty board, a non-empty board OMITS it, and every existing `{ dimensions: [...] }`
// consumer/fixture stays valid. The board defaults an absent reason to cold-start so an
// unexpected `undefined` is never a void (FR-5).
export const tasteProfileSchema = z.object({
  dimensions: z.array(dimensionGroupSchema),
  emptyReason: emptyReasonEnum.optional(),
});

export type TasteProfile = z.infer<typeof tasteProfileSchema>;

// ---------------------------------------------------------------------------
// Stated-Fact Freshness contract (Story 2.1, AD-9 / FR-6) — the shared field_key
// string-union + its user_preferences column mapping + the source rank-lattice
// value set. Imported UNCHANGED by every Epic-2 writer/reader (2.2 recordFreshness,
// 2.3 read model, the 2.1 backfill) and PERSISTED in user_preference_freshness.field_key.
// The TS union IS the compile-time gate on a malformed field_key (the DB column has no
// CHECK), and preference-field-key-drift.guard binds it to the live userPreferences schema.
// ---------------------------------------------------------------------------

// The five game-related Stated Facts, as STABLE MACHINE CODES. These values are persisted
// in `user_preference_freshness.field_key`, so they are APPEND-ONLY: never rename or reorder
// a committed value (mirrors `insightProvenanceEnum` above). Growing the set is a deliberate,
// guard-gated change (the drift guard fails the build if this set changes without a matching
// FIELD_KEY_COLUMNS entry + GAME_RELATED_PREFERENCE_COLUMNS registry update).
export const fieldKeyEnum = z.enum([
  'owned_platforms',
  'genre_preferences',
  'play_style_preferences',
  'play_time_hours_per_week',
  'content_filter',
]);

export type FieldKey = z.infer<typeof fieldKeyEnum>;

// Convenience list (the enum's option tuple) for iteration in the backfill/writer.
export const FIELD_KEYS = fieldKeyEnum.options;

// Each field_key → its `user_preferences` DB column name (the source-of-truth column). The
// `Record<FieldKey, string>` type makes this map COMPILE-TIME EXHAUSTIVE over the union: a
// field_key with no entry, or an entry whose key is not in the union, is a type error. Kept as
// plain strings so `@subtails/contracts` stays dependency-free (no `@subtails/db` import); the
// runtime cross-check that each column actually exists on `userPreferences` lives in
// `preference-field-key-drift.guard` (workspace-guards). `content_filter` maps to the
// source-of-truth `content_filter_level` column (PRD §4.2), NOT the legacy `content_filters` mirror.
export const FIELD_KEY_COLUMNS: Record<FieldKey, string> = {
  owned_platforms: 'owned_platforms',
  genre_preferences: 'genre_preferences',
  play_style_preferences: 'play_style_preferences',
  play_time_hours_per_week: 'play_time_hours_per_week',
  content_filter: 'content_filter_level',
};

// The `last_source` rank-lattice VALUE SET only (Story 2.1). The rank ORDERING/comparison
// (`manual > re_challenge > writeback` — a manually-set fact is authoritative and never silently
// downgraded) is Story 2.2's `taste-insights-config` concern; do NOT add ordering logic here.
// STABLE MACHINE CODES, persisted in `user_preference_freshness.last_source` — append-only.
export const freshnessSourceEnum = z.enum(['manual', 're_challenge', 'writeback']);

export type FreshnessSource = z.infer<typeof freshnessSourceEnum>;

// ---------------------------------------------------------------------------
// Stated-Facts read envelope (Story 2.3, AD-8 / AD-9 / FR-6) — the shared,
// localizable descriptor the `getStatedFacts` read model (`@subtails/discovery`)
// emits and the Stated-Facts display (Story 2.4) + Content-Filter read-row (Story
// 2.7) render. The BACKEND EMITS NO PROSE: `status`/`lastSource`/`fieldKey` are
// STABLE MACHINE CODES the client localizes through next-intl (mirrors
// `tasteProfileSchema` / `emptyReasonEnum` — D8/AD-8). No raw signal, DB `id`, or
// vector ever reaches this contract. Kept dependency-free (no `@subtails/db` import).
// ---------------------------------------------------------------------------

// The per-fact display status — the AD-9 set/cleared/never-set distinction the read model DERIVES
// (Story 2.3) and Story 2.4 renders differently (a distinct cleared state vs a "not set yet" +
// add affordance). STABLE MACHINE CODES, APPEND-ONLY — never rename or reorder a committed value
// (mirrors `emptyReasonEnum`/`insightProvenanceEnum`); the client localizes the code (no backend
// prose — AD-8). Derivation is a PURE function of `(freshnessRowPresent, valueEmpty)`, INDEPENDENT
// of `last_source` (a row + empty value is `cleared` whatever wrote it).
//   • 'set'       → a freshness row exists AND the value is non-empty.
//   • 'cleared'   → a freshness row exists AND the value is empty (`[]` / `null`) — distinct from
//                   never-set (the user cleared a fact they had set; "no constraint", surfaced honestly).
//   • 'never_set' → NO freshness row (the fact was never confirmed) — even if a legacy non-empty
//                   value exists (the value is still returned, but recency is honestly `null`).
export const statedFactStatusEnum = z.enum(['set', 'cleared', 'never_set']);

export type StatedFactStatus = z.infer<typeof statedFactStatusEnum>;

// The union of the five fields' actual value shapes so the 2.4 renderer receives each fact's REAL
// value, never a stringified / lossy projection: jsonb `string[]` (owned_platforms / genre_preferences
// / play_style_preferences), `integer` (play_time_hours_per_week), `text` (content_filter), and
// `null` for an absent scalar / an entirely-absent `user_preferences` row. [Source:
// packages/db-schema-library/src/library.ts:13-19 column types.]
export const statedFactValueSchema = z.union([
  z.array(z.string()),
  z.number().int(),
  z.string(),
  z.null(),
]);

export type StatedFactValue = z.infer<typeof statedFactValueSchema>;

// A single Stated Fact — one of the five `fieldKey`s joined with its value + freshness + derived
// staleness + status. `lastConfirmedAt` is a nullable ISO-8601 string (NOT a `Date`) so the envelope
// crosses the RSC/client boundary cleanly (the read model converts the timestamptz → ISO string);
// `lastSource` is the freshness source machine code (null when never-set). `stale` is derived against
// the single-sourced staleness window (`isStatedFactStale`, `@subtails/discovery` config); `status`
// is the AD-9 set/cleared/never-set distinction. No prose, no raw signal row, id, or vector (AD-8).
export const statedFactSchema = z.object({
  fieldKey: fieldKeyEnum,
  value: statedFactValueSchema,
  lastConfirmedAt: z.string().datetime().nullable(),
  lastSource: freshnessSourceEnum.nullable(),
  stale: z.boolean(),
  status: statedFactStatusEnum,
});

export type StatedFact = z.infer<typeof statedFactSchema>;

// The top-level Stated-Facts envelope. Deliberately an OBJECT (not a bare array) so a later story can
// ADDITIVELY extend it without reshaping the shipped contract (the `tasteProfileSchema` convention).
// The `getStatedFacts` read model emits exactly the five `FIELD_KEYS` in their stable order; 2.4/2.7
// localize the machine codes.
export const statedFactsSchema = z.object({
  facts: z.array(statedFactSchema),
});

export type StatedFacts = z.infer<typeof statedFactsSchema>;

// ---------------------------------------------------------------------------
// Stated-Fact manual-edit transport (Story 2.5, FR-7 / AD-9 / AD-10) — the shared,
// client-usable Zod contract the `POST /api/user/taste/facts` route validates the
// edit body against, and the inline editors build their option lists from. Admits
// ONLY the FOUR non-safety `fieldKey`s: `content_filter` is DELIBERATELY excluded —
// its only write path is the attested `recordAttestedLoosen` (AD-10/AD-11, Epic 4),
// and this route is never it, so a `content_filter` (or any unknown) fieldKey is
// rejected at the Zod boundary → 400. Kept dependency-free (no `@subtails/db` import).
// ---------------------------------------------------------------------------

// The four EDITABLE (non-safety) Stated Facts, as a subset of `fieldKeyEnum` (never
// `content_filter`). Exported as ONE list so the route, the editors, and the tests share
// a single source (never a parallel field-classification set — it is derived from the
// committed `fieldKeyEnum` contract and stays in lockstep with `FIELD_KEY_COLUMNS`).
export const NON_SAFETY_FIELD_KEYS = [
  'owned_platforms',
  'genre_preferences',
  'play_style_preferences',
  'play_time_hours_per_week',
] as const;

export type NonSafetyFieldKey = (typeof NON_SAFETY_FIELD_KEYS)[number];

// The KNOWN fixed vocab each array field is a multi-select over — the SAME ids the shipped
// `PreferencesForm` uses (`preferences.platform_*` / `preferences.genre_*` /
// `preferences.play_style_*` labels localize them; NO vocab is duplicated into new i18n keys).
// Defined here as the SINGLE source so the transport validator, the editors, and the tests
// cannot drift on the id set. Append-only (persisted `user_preferences` jsonb ids).
//
// ADDING AN ID? It needs a `preferences.<prefix>_<id>` label in ALL 8 locale files
// (`packages/i18n-account/src/locales/*/profile.json`) — `play_style` ids map dashes → underscores.
// Those keys are built by TEMPLATE in `optionLabelKey`/`factValueLabel`, so a literal grep for
// one finds ZERO references and looks orphaned. Do not delete them on that evidence.
// Locked by `apps/account/tests/stated-facts-client.test.tsx` ("every REUSED preferences.* vocab
// key that optionLabelKey builds exists in all 8 locales") — it derives the ids from these lists.
export const OWNED_PLATFORM_VOCAB = ['pc', 'xbox', 'playstation', 'nintendo', 'mobile'] as const;
export const GENRE_PREFERENCE_VOCAB = [
  'action',
  'adventure',
  'rpg',
  'strategy',
  'simulation',
  'sports',
  'racing',
  'fighting',
  'puzzle',
  'horror',
  'platformer',
  'shooter',
  'survival',
  'other',
] as const;
export const PLAY_STYLE_VOCAB = [
  'casual',
  'completionist',
  'speedrunner',
  'story-focused',
  'multiplayer-focused',
] as const;

// The sane playtime bound (hours/week) — the shipped 3.5a integer range. A value outside
// `[PLAY_TIME_HOURS_MIN, PLAY_TIME_HOURS_MAX]` (or a non-integer) is rejected → 400.
export const PLAY_TIME_HOURS_MIN = 1;
export const PLAY_TIME_HOURS_MAX = 168;

// De-duplicate a validated vocab-id list, preserving first-seen order. A well-behaved editor never
// emits duplicates (its toggle keeps a Set), but a crafted POST could send `['pc','pc']` which would
// otherwise persist and render as "PC, PC"; normalize it here so ONE selection = ONE stored id.
const dedupeVocab = <T extends string>(ids: readonly T[]): T[] => [...new Set(ids)];

/**
 * A bounded, de-duplicated multi-select value validator over a fixed vocab. `.max(vocab.length)` caps
 * the RAW input length BEFORE the transform, so an oversized/duplicate-stuffed array (e.g. a crafted
 * authenticated POST) is rejected → 400 rather than persisting an arbitrarily large jsonb blob; the
 * transform then collapses any remaining in-bounds duplicates to a single id. An EMPTY array is allowed
 * (a deliberate CLEAR, AD-9).
 */
const boundedVocabValue = <T extends readonly [string, ...string[]]>(vocab: T) =>
  z
    .array(z.enum(vocab))
    .max(vocab.length)
    .transform(dedupeVocab);

// The edit transport: a discriminated union on `fieldKey` so each field's `value` is validated
// against its REAL column shape and can never be paired with another field's value shape —
// `owned_platforms`/`genre_preferences`/`play_style_preferences` → a bounded, de-duplicated `string[]`
// over the known vocab (capped at the vocab length; an EMPTY array is allowed = a deliberate CLEAR,
// AD-9); `play_time_hours_per_week` → an integer in the sane range. `content_filter` is absent from the
// union, so it (and any unknown fieldKey) fails discrimination → the route returns 400. No
// stringification, no lossy projection.
export const statedFactEditSchema = z.discriminatedUnion('fieldKey', [
  z.object({
    fieldKey: z.literal('owned_platforms'),
    value: boundedVocabValue(OWNED_PLATFORM_VOCAB),
    // The per-Family exact-console declaration (console-generation Story 2.5). Optional: absent keeps
    // Family grain (an existing exact declaration is never downgraded). Validated against the selected
    // Families by the one writer, not here.
    consoles: consoleSelectionSchema.optional(),
  }),
  z.object({
    fieldKey: z.literal('genre_preferences'),
    value: boundedVocabValue(GENRE_PREFERENCE_VOCAB),
    /**
     * WHAT THE PICKER WAS DISPLAYING when the user saved (tag-net-expansion Story
     * 10.13-followup-orphaned-told-tastes). `genre_preferences` is bridged onto the tag net, and the
     * reconciliation may VOID a bridged told taste only when the user actually UNTICKED it — which means
     * it needs the selection the picker rendered, not the column as it stands when the write runs. Those
     * two diverge the moment a write CHANGES the column: onboarding POSTs `/api/user/preferences` (which
     * re-projects surviving told tastes into the column) and then immediately POSTs this route with the
     * same local array, and a server that re-derived "displayed" from the column would read the just
     * projected taste as unticked and destroy it in one user action.
     *
     * ABSENT DECODES TO `null`, WHICH MEANS "EMIT NO VOIDS", AND THAT DEFAULT IS THE SAFETY PROPERTY.
     * An old client, a replayed body or a third-party caller that omits the field can only ever fail
     * toward keeping a taste the user holds, never toward silently revoking one. `.nullish()` rather than
     * a default: `null` and absent must mean the same thing, and no value may materialize a `[]`, which
     * would mean "the picker showed an empty selection" — a different, destructive statement.
     *
     * DELIBERATELY NOT `boundedVocabValue`. `value` is what the user is SAVING and must be in-vocabulary;
     * `displayedValue` is a report of what a picker RENDERED, and a stored `genre_preferences` column can
     * legitimately hold a legacy id the current vocabulary no longer carries. Validating it against the vocab
     * would 400 an otherwise valid save for a value the user never chose, and the id is inert anyway — the
     * bridge maps an unknown id to no node at all. It is still BOUNDED (a picker state, not a payload).
     */
    displayedValue: z.array(z.string().max(64)).max(64).nullish(),
  }),
  z.object({
    fieldKey: z.literal('play_style_preferences'),
    value: boundedVocabValue(PLAY_STYLE_VOCAB),
  }),
  z.object({
    fieldKey: z.literal('play_time_hours_per_week'),
    value: z.number().int().min(PLAY_TIME_HOURS_MIN).max(PLAY_TIME_HOURS_MAX),
  }),
]);

export type StatedFactEdit = z.infer<typeof statedFactEditSchema>;

// ===========================================================================
// THE CONTENT-FILTER ATTESTATION CONTRACT (taste-profile Story 4.3 — AD-10).
//
// THIS FILE DEFINES; IT DOES NOT ENFORCE OR EXPOSE. Epic 4's rollout is explicit:
// the audit event + rate limit + shared column-writer + class guard all land BEFORE
// the loosen UI (4.7). Nothing here ships a loosen path, a writer, a cooldown, a
// guard or a UI, and nothing here grants any user an ability they did not have.
// This is types, constants, pure predicates and a Zod transport schema.
//
// WHY THE VOCABULARY LIVES HERE AND NOT IN `@subtails/discovery`, WHERE IT STARTED.
// The maturity ordering is needed by `discovery` (the minigames engine + the ratchet),
// `catalog` (the /api/search reader), `apps/account` (the tighten-only editor) and
// `apps/web`. Invariant §4.1's PROSE RULE is the ground that holds: `type:domain` may import
// platform/shared but NEVER another domain, and "logic needed by several domains and apps must
// live in a `type:platform, scope:shared` package: that is the only cycle-free placement".
// `catalog` and `discovery` are both `type:domain`, which is exactly WHY `search-utils.ts` had
// duplicated the four levels and said so in a comment. The duplication was never carelessness;
// it was the layer rule forcing it. So the edge is INVERTED rather than copied: contracts owns
// the vocabulary, and `content-filter.ts`'s `ContentLevel` becomes an alias of the inferred type
// below. `discovery → contracts` is legal and already used 10+ times; NO new dependency edge is
// created by this contract.
//
// DO NOT CITE THE LINT AS THE MECHANISM HERE — it was probed and it does not say what the story
// originally claimed (checked by execution during 4.3's review; recorded so 4.5-4.9 do not inherit
// a false rationale):
//   • The TAG rule would NOT have blocked `contracts → discovery`: `depConstraints` gives
//     `type:platform → ['scope:shared']`, `packages/discovery/project.json` carries BOTH
//     `type:domain` AND `scope:shared`, and Nx passes when the target has ANY listed tag.
//   • What DOES block it is `@nx/enforce-module-boundaries`' CYCLE DETECTION — a real probe import
//     errors with `Circular dependency between "contracts" and "discovery" detected`, because
//     `discovery → contracts` already exists. The outcome ("contracts may not import discovery") is
//     right; the mechanism is the cycle, not the tags.
//   • And a real `catalog → discovery` import LINTS CLEAN today — the domain→domain half of §4.1 is
//     PROSE-ONLY for domain packages tagged `scope:shared` (currently both). That gap is its own
//     scheduled work; the placement argument above rests on §4.1's rule, not on the linter.
//
// NOTE the deliberate NON-USE of the `certaintyReadEnum` copy+lockstep pattern above. That
// pattern is a FALLBACK for a case this contract does not have: `certaintyRead` needs a copy
// because the DOMAIN owns runtime config (`CERTAINTY_BANDS`, real numeric bands) that contracts
// cannot reach, so the two sides genuinely cannot be unified and a drift test is the best
// available. This vocabulary is four string literals and an order, with no runtime-config
// dependency — a true single source is achievable, so it is achieved. A lockstep test guarding
// a drift you could have made structurally impossible is strictly worse.
// ---------------------------------------------------------------------------

// The maturity vocabulary — STRICTEST FIRST. Identical values to
// `user_preferences.content_filter_level` (and its legacy `content_filters` mirror), reused so a
// subject's declared maturity, a player's filter level and an attestation's target are all directly
// comparable. STABLE MACHINE TOKENS, never localized and never rendered raw (AD-8 / D8 — the backend
// emits no prose; the client localizes every user-facing word through next-intl).
//
// THE ORDER OF THIS ARRAY IS THE ORDERING. `contentLevelRank` is derived from it below, so the two
// can never disagree. Do NOT reorder: the values are persisted in `user_preferences` and in
// `content_filter_attestations.from_level` / `.to_level`, and the rank is compared against stored rows.
export const contentLevelEnum = z.enum(['family', 'teen', 'mature', 'adult']);

export type ContentLevelValue = z.infer<typeof contentLevelEnum>;

/**
 * The `/api/search` content-filter reader. It resolves the searcher's maturity level from
 * `content_filter_level` — the SOURCE OF TRUTH, and the only column the minigames engine enforces
 * (`readContentFilterLevel`, packages/discovery-core/src/content-filter.ts) and the only one the Stated Fact
 * on /profile/taste displays. `/api/search` was the LAST surface reading anything else; after
 * taste-profile Story 4.2 the legacy `content_filters` column has ZERO readers in the workspace.
 *
 * WHAT IT USED TO DO, AND WHY THAT IS WORTH KNOWING. Until Story 4.2 this function read BOTH columns and
 * returned the FIRST non-`'mature'` value in `[contentFilterLevel, contentFilters]` order. That was NEVER
 * a "prefer the stricter" rule, though two separate documents described it that way and both were
 * corrected on 2026-07-15 under the 3.1 review, disproven by an executed probe: for
 * `{level:'adult', legacy:'family'}` it yielded `'adult'` — the LOOSER. It coincided with "stricter" only
 * when the level happened to be `'mature'`. So the legacy column could outvote the level the engine
 * enforces, and search and the engine could disagree about the same user.
 *
 * THIS RE-POINT WAS THE SECOND HALF OF A MATCHED PAIR, AND IT SHIPPED SECOND ON PURPOSE (Story 4.2).
 * The first half is migration `0077_reconcile_content_filter_columns`, which converged every divergent
 * `{level, legacy}` row onto the STRICTER of the two. Both halves shipped in that one story, in that
 * order, and the order is the whole safety argument:
 *   • The realistic divergent population is `{level:'mature', legacy:'family'|'teen'}` — a shape whose
 *     level was SYNTHESIZED by a pre-3.1 Zod `.default('mature')` while the legacy column received the
 *     user's actual click (the pre-3.1 form bound its radio to `contentFilters` and never sent a level).
 *   • The reconcile gave those rows `level = legacy`, so the OLD reader's first branch (`level === legacy`)
 *     already returned the stricter value — the reconcile TIGHTENED the ENGINE and left this reader's
 *     output unchanged.
 *   • This re-point is therefore a behavioral NO-OP for that population, which is exactly what made the
 *     two halves safe to ship together.
 *
 * WHO THE REAL VICTIM OF A LONE RE-POINT WOULD HAVE BEEN — CORRECTED IN REVIEW, READ THIS BEFORE CITING
 * THIS COMMENT. An earlier version of this docstring claimed that re-pointing alone would have silently
 * loosened `/api/search` for the whole divergent population. **That claim was FALSE, and the reason is
 * worth knowing: `/api/search` does not enforce this value at all.** `getUserContentFilterPreference`'s
 * result reaches only `responseFilters`, which the route ECHOES in its response body — it is never passed
 * to `buildSearchConditions`, which receives `filters` (whose `contentRatings` comes from the query param
 * alone). So an authenticated `family` user with no explicit param already gets an UNFILTERED catalog
 * while the response reports `['E','E10+']`. That is a live pre-existing safety gap in its own right, it
 * predates Story 4.2 (present at baseline `4b9af5b4`), and it has its own story — it is NOT this reader's
 * to fix, and this reader is correct as written.
 *
 * THE ORDERING ARGUMENT SURVIVES THAT CORRECTION INTACT, VIA A DIFFERENT CONSUMER. The reconcile is right
 * and had to ship FIRST because of the MINIGAMES ENGINE, which is a real enforcing consumer:
 * `readContentFilterLevel` reads `content_filter_level` and gates actual content on it. Converging those
 * rows TIGHTENS the engine onto the value the user actually clicked — restoring a choice a Zod default had
 * overwritten. So: reconcile first, re-point second, both halves in one story. What changes is only the
 * name of the surface that would have been harmed, not the direction or the order. If you are about to
 * reverse or extend this change: the data has already been converged; do not assume a future column
 * re-point is as cheap as this one looked.
 *
 * TOTAL over a null/unknown value, resolving to `'mature'` — identical to `normalizeContentLevel`
 * (packages/discovery-core/src/content-filter.ts:67-72) and to the schema default, so this reader and the
 * engine agree on what an absent or legacy value means. Only a null `userPrefs` (an anonymous /
 * prefs-less search) yields `undefined`, i.e. "no opinion", which the caller reads as "apply no
 * preference-derived rating filter".
 *
 * RETURN TYPE NARROWED TO `ContentLevelValue | undefined` (taste-profile Story 4.9, which owns this
 * surface — the previous docstring explicitly deferred the narrowing to this story). It is BEHAVIOR-NEUTRAL:
 * the function already only ever returned one of the four in-union levels (via `contentLevelEnum.safeParse`)
 * or the `'mature'` literal or `undefined`, so every runtime value is unchanged — the reader's lock
 * (`search-content-filter-reader.test.ts`) passes with ZERO assertion edits. The narrower type lets the
 * search route feed the result straight into `computeEffectiveContentRatings(storedLevel, …)` (which takes
 * `ContentLevelValue | undefined`) without a cast. The `undefined`-on-null-`userPrefs` contract is intact.
 *
 * STILL NO `@subtails/discovery` IMPORT — and now no local vocabulary copy either (taste-profile Story
 * 4.3). `catalog` and `discovery` are both `type:domain`, and Invariant §4.1's RULE is that a domain
 * package may import platform/shared but NEVER another domain. That rule is EXACTLY why the four levels
 * used to be duplicated here as local string logic; the duplication was never carelessness, it was the
 * layer rule forcing it. Story 4.3 dissolved the CAUSE by moving the vocabulary to `@subtails/contracts`
 * — a `type:platform` package `catalog` may legally reach, and already does (`@subtails/contracts/search`
 * at the top of this file). So the check below now consumes the ONE shared enum.
 *
 * THE LINT REFUSES THE EDGE. The `type:domain` constraint in `eslint.config.mjs` carries
 * `notDependOnLibsWithTags: ['type:domain']` alongside its allow list. The allow list alone could never
 * express the ban — it passes as soon as the target carries any listed tag, and `discovery` carries
 * `scope:shared` alongside `type:domain` — so the ban rides on the second key. A real
 * `catalog → discovery` import now fails the lint at `'error'`, and `1.2-CI-003` in
 * `ci-nx-module-boundary-enforcement.test.ts` spawns the real linter to prove that fires rather than
 * asserting the config text. The rule is the rule, and now a green lint is evidence of it.
 *
 * BEHAVIOUR IS IDENTICAL. `contentLevelEnum.safeParse` recognises exactly the same four values the
 * hand-written `||` chain did, and the `'mature'` fallback (for null, out-of-union, and empty string) and
 * the `undefined`-on-null-`userPrefs` contract are unchanged. The return type stays `string | undefined`
 * rather than narrowing to `ContentLevelValue`: narrowing is a real contract change for this reader's
 * callers and belongs to Story 4.9, which owns this surface.
 */
export function getUserContentFilterPreference(
	userPrefs: { contentFilterLevel: string | null } | null
): ContentLevelValue | undefined {
	if (!userPrefs) return undefined;

	const parsed = contentLevelEnum.safeParse(userPrefs.contentFilterLevel);
	return parsed.success ? parsed.data : 'mature';
}

// The four levels as an ordered tuple, strictest → loosest. Exported so a consumer that needs to
// ITERATE the vocabulary (a picker, a test cross-product) does not re-literal the list.
//
// FROZEN + `readonly`, DELIBERATELY. Zod v4 hands out `.options` as a PLAIN MUTABLE array, so a bare
// re-export would make the ONE ordering writable from every app bundle that imports it. Both rank
// copies this consolidated were unexported module-local consts — unreachable from any app — so
// exporting the single ordering without freezing it would be a REGRESSION IN EXPOSURE. A defensive
// copy is taken first so zod's own internal option array is never frozen underneath it.
export const CONTENT_LEVELS: readonly ContentLevelValue[] = Object.freeze([...contentLevelEnum.options]);

/**
 * THE ONE ORDERING (Story 4.3). Permissiveness rank: higher = more mature content allowed.
 *
 * `family(0) < teen(1) < mature(2) < adult(3)`. DERIVED from `contentLevelEnum.options` rather than
 * re-literalled, so the enum and the rank are one fact with one spelling.
 *
 * THIS CONSOLIDATES FIVE SHIPPED EXPRESSIONS OF THE SAME ORDER, all of which were VERIFIED (by
 * execution, against the live code, during 4.3) to induce this identical rank — the finding was
 * DUPLICATION, NOT DISAGREEMENT, so the consolidation is behavior-neutral:
 *   1. `content-filter.ts`'s `CONTENT_LEVEL_RANK`            → deleted, now imports this.
 *   2. `preferences-writeback.ts`'s byte-identical duplicate → deleted, now imports this.
 *   3. `stated-facts-client.helpers.ts`'s `CONTENT_LEVEL_ORDER` + `isLooserLevel` → now import this.
 *   4. the catalog reader test's local `LEVELS`/`RANK`        → now import this.
 *   5. `apps/web`'s `CONTENT_RATING_HIERARCHY` (search/route.ts) — a DIFFERENT KIND of object: a
 *      level → ESRB-rating-SET projection, not a rival rank. Its sets are strictly nested in this
 *      same sequence and its `|| .mature` fallback matches `normalizeContentLevel`'s default, so it
 *      is a derived artifact of this ordering. It is DELIBERATELY left in place: it sits inside
 *      Story 4.9's blast radius (/api/search does not enforce the preference-derived filter at all
 *      today — the value is echoed in the response, never passed to `buildSearchConditions`), and
 *      `apps/web` has no test surface, so a lock placed there would assert nothing.
 * A SIXTH expression, `drizzle/0077_reconcile_content_filter_columns.sql`'s inline SQL `CASE` rank,
 * is an APPLIED, FORWARD-ONLY, FROZEN artifact. This contract does not retroactively own it.
 *
 * FROZEN + `Readonly`, DELIBERATELY — "do NOT reorder" made STRUCTURAL rather than merely asked. This
 * single rank now backs both ratchet gates, `isSubjectAllowed` and `isLooser`; an unfrozen public
 * export would let any importer write `contentLevelRank.adult = -1` and INVERT `isLooser` for the whole
 * process. The freeze is what carries the property: the write NEVER TAKES. Whether it also throws is the
 * caller's module mode (strict ESM throws; a sloppy-mode CJS transpile silently no-ops) — do not rely on
 * the throw, rely on the ordering being unchanged afterwards.
 */
export const contentLevelRank: Readonly<Record<ContentLevelValue, number>> = Object.freeze(
  Object.fromEntries(CONTENT_LEVELS.map((level, index) => [level, index])) as Record<
    ContentLevelValue,
    number
  >,
);

/**
 * FAIL CLOSED, UNIFORMLY AND BY CONSTRUCTION. Parse a level the TYPE SYSTEM claims is in-union and
 * THROW when it is not.
 *
 * WHY THIS EXISTS. Every loosen-side predicate below is typed `ContentLevelValue`, but a type is not a
 * runtime guarantee: a value crossing an `any`/`as`/JSON/`unknown` seam reaches them type-erased. Before
 * this guard each predicate failed OPEN on such a value, and each in a different way —
 * `isLooser('mature','Adult')` answered `false` ("not a loosen" ⇒ the gate never fires),
 * `contentLevelRequiresAgeAttestation('Adult')` answered `false` (no 18+ needed), and
 * `attestationKeyFor('Adult')` minted a SELF-MATCHING `confirm_only` key, bypassing the 18+ gate by never
 * triggering it. This contract is the sole authority for 4.5's service, 4.6's guard and 4.7's UI, so it
 * must fail closed the SAME way everywhere, by construction, and not by accident of an operator.
 *
 * THROWING IS THE FAIL-CLOSED ANSWER HERE, not a returned `false`: `false` is a MEANINGFUL answer to
 * every one of these predicates ("not a loosen", "no 18+ needed"), so returning it for an unrecognized
 * input is indistinguishable from a permissive verdict. There is no safe verdict for a level that does
 * not exist — the only correct behavior is to refuse to answer.
 *
 * NOT A NORMALIZER. It never maps an unknown value onto a default (contrast `normalizeContentLevel`,
 * the READ-side total function that resolves null/unknown → `'mature'`). Dev Notes §5's rule stands:
 * the two recognizers stay distinct and this adds no third one.
 */
function requireContentLevel(level: ContentLevelValue, site: string): ContentLevelValue {
  const parsed = contentLevelEnum.safeParse(level);
  if (!parsed.success) {
    throw new TypeError(
      `${site}: ${JSON.stringify(level)} is not a content level (expected one of ${CONTENT_LEVELS.join(
        ', ',
      )}). A safety predicate refuses to answer for a level that does not exist.`,
    );
  }
  return parsed.data;
}

/**
 * Is `to` strictly LOOSER (more permissive) than `from`? THE decidable loosen predicate — pure,
 * total over the four levels, irreflexive and antisymmetric.
 *
 * This is the definition every writer, guard and surface reasons from, instead of re-literalling
 * the level order. It DECIDES; it does not enforce. `isLooser(from, to) === false` covers both
 * "tightening" and "no change" — a caller that needs to distinguish those compares the ranks itself.
 *
 * `family` IS UNREACHABLE AS A LOOSEN TARGET BY CONSTRUCTION: `contentLevelRank.family === 0`, so
 * `isLooser(from, 'family')` is false for EVERY `from`. The loosen-target domain is therefore exactly
 * `{teen, mature, adult}` — a fact this contract gets from the ordering rather than from a hand-kept
 * list that could drift out of agreement with it.
 *
 * TOTAL over the four levels; it FAILS CLOSED by THROWING on anything else (see
 * {@link requireContentLevel}). A `false` for a type-erased level would read as "not a loosen" and skip
 * the caller's gate — the totality this docstring promises holds at the type level only, so the runtime
 * enforces it too.
 */
export function isLooser(from: ContentLevelValue, to: ContentLevelValue): boolean {
  requireContentLevel(from, 'isLooser(from)');
  requireContentLevel(to, 'isLooser(to)');
  return contentLevelRank[to] > contentLevelRank[from];
}

// ---------------------------------------------------------------------------
// The level → allowed-ESRB-rating-SET projection (taste-profile Story 4.9).
//
// THIS CONSOLIDATES THE SIXTH EXPRESSION of the shared vocabulary (Story 4.3's docstring above named
// `apps/web`'s `CONTENT_RATING_HIERARCHY` as a level→rating-SET projection deliberately left in place
// because apps/web had no test surface). Story 4.9 stands up that surface and moves the projection HERE,
// keyed on `ContentLevelValue` so its keys ARE the shared enum — not a rival vocabulary — and gives it a
// real test home in the `contracts` vitest project (see `content-rating-projection.test.ts`).
//
// It is a DERIVED ARTIFACT of the one ordering, not a rival rank: each level's set is the set of the
// level below it PLUS the ratings that level newly admits, so the four sets are STRICTLY NESTED in the
// same `family ⊂ teen ⊂ mature ⊂ adult` sequence `contentLevelRank` encodes. `Record<ContentLevelValue,…>`
// makes the object COMPILE-TIME EXHAUSTIVE over the union — a missing or extra level is a type error — and
// the guarding test asserts the keys equal `CONTENT_LEVELS` and the nesting holds.
//
// FROZEN, like the ordering it derives from: a public export the search route reads on every request must
// not be writable from any importing bundle. The inner arrays are frozen too so a `.push('AO')` onto the
// `family` set can never silently widen a safety filter process-wide.
export const CONTENT_RATING_HIERARCHY: Readonly<Record<ContentLevelValue, readonly ContentRating[]>> =
  Object.freeze({
    family: Object.freeze(['E', 'E10+']),
    teen: Object.freeze(['E', 'E10+', 'T']),
    mature: Object.freeze(['E', 'E10+', 'T', 'M']),
    adult: Object.freeze(['E', 'E10+', 'T', 'M', 'AO']),
  } as Record<ContentLevelValue, readonly ContentRating[]>);

/**
 * The allowed ESRB rating set for a maturity level — the READ-side total function `/api/search` calls.
 *
 * TOTAL over any string, falling back to the `mature` set for a null/unknown/out-of-union value, exactly
 * as the READER default does (`getUserContentFilterPreference` / `normalizeContentLevel` resolve an
 * absent or out-of-union level to `'mature'`). So a level this function does not recognize is treated as
 * `mature`, never as "no filter" — the same fail-toward-a-real-ceiling posture as the reader. The
 * parameter is `string` (not `ContentLevelValue`) precisely because the search route may hand it a raw
 * query-param value; the `mature` fallback is what makes that safe.
 */
export function ratingsForContentLevel(level: string): readonly ContentRating[] {
  return CONTENT_RATING_HIERARCHY[level as ContentLevelValue] ?? CONTENT_RATING_HIERARCHY.mature;
}

/**
 * THE EFFECTIVE ENFORCED RATING SET for `/api/search` (taste-profile Story 4.9, AC #1/#2/#3/#4).
 *
 * Maps `(storedLevel, explicitRatings)` → the rating set the route must ACTUALLY enforce, with
 * tighten-only intersection semantics. Its three-valued return is the whole contract, and the route
 * honors each value distinctly:
 *
 *   • `undefined`  → NO preference-derived rating filter. The anonymous / prefs-less case (no stored
 *                    level AND no explicit param), or an authenticated user whose ceiling and param both
 *                    resolve to "no constraint". The route passes `undefined` to `buildSearchConditions`,
 *                    which applies no content-rating condition.
 *   • non-empty [] → ENFORCE exactly these ratings.
 *   • EMPTY []     → the DEFINED-BUT-EMPTY intersection — an explicit param asked for content STRICTLY
 *                    ABOVE the stored ceiling, so nothing is admissible. The honest answer is ZERO games.
 *                    The route MUST fail CLOSED here (short-circuit to empty results); it must NOT pass an
 *                    empty array to `buildSearchConditions`, whose `length > 0` guard would treat `[]` as
 *                    "no filter" and WIDEN to the whole catalog — the exact read-side loosen this story
 *                    closes.
 *
 * THE RULES:
 *   • Anonymous / prefs-less (`storedLevel === undefined`): UNCHANGED behavior — the explicit param is
 *     honored exactly as given (which may itself be `undefined` → no filter). No stored ceiling exists to
 *     intersect against.
 *   • Authenticated with a stored level, NO explicit param: enforce the ceiling (`ratings(storedLevel)`).
 *   • Authenticated with a stored level AND an explicit param `P`: enforce `P ∩ ceiling`. Because the
 *     level rating-sets are strictly nested, this can never contain a rating above the ceiling — an
 *     explicit param requesting more mature content than the stored level is silently CLAMPED to the
 *     ceiling (tighten-only), never honored as a widen. When `P` is entirely above the ceiling the
 *     intersection is empty (fail closed, above).
 */
export function computeEffectiveContentRatings(
  storedLevel: ContentLevelValue | undefined,
  explicitRatings: readonly ContentRating[] | undefined,
): readonly ContentRating[] | undefined {
  // Anonymous / prefs-less: no stored ceiling to intersect against — honor the explicit param verbatim
  // (may be `undefined` → no preference-derived filter). This is the unchanged pre-story behavior.
  if (storedLevel === undefined) return explicitRatings;

  const ceiling = ratingsForContentLevel(storedLevel);

  // A stored ceiling with no explicit param → enforce the ceiling.
  if (explicitRatings === undefined) return ceiling;

  // Both present → the tighten-only intersection. `[]` when the param is entirely above the ceiling;
  // the route reads a DEFINED-but-EMPTY result as "match nothing" (fail closed), never "no filter".
  const ceilingSet = new Set<ContentRating>(ceiling);
  return explicitRatings.filter((rating) => ceilingSet.has(rating));
}

// ---------------------------------------------------------------------------
// The attestation key (AD-10 crux + epics AC2 audit requirement)
// ---------------------------------------------------------------------------

/**
 * The attestation copy VERSION. Bump ONLY when the attestation WORDING changes (Story 4.7 owns the
 * copy). It is not a schema version and not a code version.
 *
 * WHY A VERSION IS IN THE KEY AND NOT IN A COMMENT. The attestation row is retained DE-IDENTIFIED
 * after account deletion (AD-13) precisely so the PRD §11 minor-access residual-risk sign-off can
 * resolve a dispute. Evidence that says "the user confirmed an attestation" is far weaker than "the
 * user confirmed THIS EXACT WORDING". When 4.7's copy is later reworded, historical rows must still
 * identify what was actually confirmed — which only works if the version is IN the persisted value.
 */
export const ATTESTATION_COPY_VERSION = 'v1';

/** The age-gate token used by every level whose loosen target requires an 18+ attestation. */
const AGE_18_PLUS_ATTESTATION = 'age_18_plus';

/**
 * 🚨 THE AD-10 CRUX. The attestation key for a given TARGET level.
 *
 * Format: `content_filter.attest.<copyVersion>.<toLevel>.<attestationKind>`
 *   e.g. `content_filter.attest.v1.adult.age_18_plus`
 *
 * TWO ORTHOGONAL REQUIREMENTS RIDE ON THIS ONE STRING — keep them distinguishable:
 *
 *   • TARGET-LEVEL MATCH (AD-10) — a SAFETY property. A key that did not encode the target level
 *     would let an attestation minted for `mature` unlock `adult` — the exact hole Epic 4 exists to
 *     close. Because the key is DERIVED FROM `toLevel`, the key for `mature` can never equal the key
 *     for `adult`, and matching reduces to EQUALITY against `attestationKeyFor(requestedToLevel)`.
 *     The match is therefore STRUCTURAL — impossible rather than merely checked — instead of a
 *     runtime `if` that a caller could forget. Consumers MUST match by that equality (see
 *     {@link attestationMatchesTarget}) and MUST NOT parse the level back out of the string.
 *
 *   • COPY VERSION (epics AC2) — an AUDIT/EVIDENCE property. See {@link ATTESTATION_COPY_VERSION}.
 *
 * TOTAL over `ContentLevelValue`, INCLUDING `family`, deliberately. `family` is unreachable as a
 * loosen target by construction (rank 0 — `isLooser(from,'family')` is false for every `from`), so no
 * caller can reach this with `family` after an `isLooser` gate. Staying total is the defensive choice
 * and costs nothing; a narrowed loosen-target type would add friction at every call site for a case
 * the ordering already excludes, and would put the exclusion in a SECOND place that could drift.
 *
 * THE RETURN IS A STABLE MACHINE TOKEN. It is NEVER localized and NEVER rendered raw to a user
 * (AD-8 / D8). Story 4.7 maps it onto a NESTED next-intl key to render the actual "I confirm I'm
 * 18+" copy; this contract deliberately ships no prose of its own.
 *
 * IT FAILS CLOSED BY THROWING on a type-erased level (see {@link requireContentLevel}). Minting a key
 * for an unrecognized level is the worst failure in this file: it would produce a SELF-MATCHING
 * `confirm_only` key, so `attestationMatchesTarget` would authorize the loosen and the 18+ gate would be
 * bypassed by never triggering. There is no key to mint for a level that does not exist.
 */
export function attestationKeyFor(toLevel: ContentLevelValue): string {
  requireContentLevel(toLevel, 'attestationKeyFor(toLevel)');
  const kind = contentLevelRequiresAgeAttestation(toLevel) ? AGE_18_PLUS_ATTESTATION : 'confirm_only';
  return `content_filter.attest.${ATTESTATION_COPY_VERSION}.${toLevel}.${kind}`;
}

/**
 * Does a STORED `attestationKey` authorize loosening to `requestedToLevel`? THE match expressed once,
 * as equality against the key derived from the REQUESTED target (AD-10).
 *
 * 🚨 THE KEY MUST COME ONLY FROM TRUSTED STORAGE — NEVER FROM THE REQUEST. It is a DETERMINISTIC
 * function of two public constants and the target level, so the key is a LABEL, NOT A PROOF: its value
 * is guessable, and it is pinned as a literal in this contract's own suite. A caller that matches a key
 * taken from a request body (or any other user-controlled input) is bypassed by a user typing the
 * constant, and this function cannot tell the difference. AD-10's "structural, impossible rather than
 * checked" property holds ONLY for a key READ BACK from `content_filter_attestations` after a real
 * attestation row was written. 4.5's service and 4.6's guard: read the row, then match.
 *
 * Exported so the loosen service (4.5) and the guard (4.6) share ONE spelling of the match rather
 * than each writing `key === attestationKeyFor(x)` and one of them eventually writing something
 * subtly weaker (`startsWith`, a regex, a parsed level). A `mature` key against an `adult` request
 * is false — that is the property the epic exists to guarantee.
 */
export function attestationMatchesTarget(
  attestationKey: string,
  requestedToLevel: ContentLevelValue,
): boolean {
  return attestationKey === attestationKeyFor(requestedToLevel);
}

/**
 * Does loosening INTO `toLevel` require a target-level-matched 18+ age attestation? (PRD FR-8
 * target-level gating.)
 *
 * DERIVED FROM THE ORDERING, not a hand-kept level list: any target at or above `mature`'s rank
 * requires 18+. So `mature` and `adult` require it; `teen` does not. A `teen` loosen still routes
 * through the SAME single loosen path and emits the SAME audit event — it requires only an explicit
 * confirm, no age attestation. `family` is unreachable as a target (rank 0), and answers `false`
 * here for totality, never because a `family` loosen is permitted.
 *
 * Exported so the loosen service (4.5), the guard (4.6) and the UI (4.7) each CONSUME this rather
 * than re-literalling `['mature','adult']` in three places that could drift apart.
 *
 * IT FAILS CLOSED BY THROWING on a type-erased level (see {@link requireContentLevel}). A `false` there
 * would read as "no 18+ attestation needed" — the age gate skipped for precisely the input nobody
 * validated.
 */
export function contentLevelRequiresAgeAttestation(toLevel: ContentLevelValue): boolean {
  requireContentLevel(toLevel, 'contentLevelRequiresAgeAttestation(toLevel)');
  return contentLevelRank[toLevel] >= contentLevelRank.mature;
}

// ---------------------------------------------------------------------------
// The attestation event (matches 4.1's shipped `content_filter_attestations` columns)
// ---------------------------------------------------------------------------

/**
 * The attestation audit event — the shape Story 4.5's `recordAttestedLoosen` writes and the account
 * adapter reads. Importable by BOTH the discovery service and the account app, since `contracts` is
 * the lower layer both may reach (which is the whole reason it lives here).
 *
 * MATCHES THE COLUMNS 4.1 SHIPPED in migration `0076` (`packages/db-schema-discovery/src/discovery.ts`), whose
 * schema comment defers to this contract by name: `from_level`/`to_level`/`attestation_key` are plain
 * `text` in the DB precisely so the ordering and the target-level match live HERE, in TypeScript, and
 * not in a DB enum (the same posture as `user_preference_freshness.field_key`). This story makes NO
 * schema change and NO migration.
 *
 * `fromLevel`/`toLevel` are constrained to {@link contentLevelEnum} — NOT free `text` — so an
 * out-of-union level cannot enter the audit trail through this transport.
 *
 * FIELD NAMES ARE camelCase, the repo convention already stated above for the taste-profile read
 * model, even though the epic prose and the DB columns write snake_case (`from_level`, …).
 *
 * `sessionId` is NULLABLE and `userId` is absent here by design: the row is retained DE-IDENTIFIED
 * after account deletion (AD-13), which NULLs both re-identification vectors. This schema describes
 * the event as WRITTEN; the anonymized residue is the DB's business, not this transport's.
 *
 * IT ENCODES NO PROSE AND NO LOCALIZED TEXT (AD-8 / D8). `attestationKey` is a stable machine token.
 */
export const contentFilterAttestationEventSchema = z.object({
  // The level in force BEFORE the loosen. Constrained to the vocabulary, never free text.
  fromLevel: contentLevelEnum,
  // The requested target. `attestationKey` MUST equal `attestationKeyFor(toLevel)` — see
  // `attestationMatchesTarget`. Enforcing that pairing is Story 4.5/4.6's, not this schema's:
  // a transport that silently rejected a mismatch would hide the very thing the guard must catch.
  toLevel: contentLevelEnum,
  // Plain COPY of the auth/web session id — never an FK (4.1: a cascade would shred the trail).
  // Nullable so the AD-13 anonymize can null it; 4.5 always writes it non-null.
  sessionId: z.string().uuid().nullable(),
  // The target-level-matched, copy-versioned key (AD-10 + epics AC2). A stable machine token.
  attestationKey: z.string().min(1),
  // When the user confirmed. The DB column defaults to now(); 4.5 may pass an explicit instant.
  attestedAt: z.date(),
});

export type ContentFilterAttestationEvent = z.infer<typeof contentFilterAttestationEventSchema>;

// ===========================================================================
// THE ADDED-TASTE RESOLUTION CONTRACT (taste-profile Story 7.2 — TN-3 / AD-1 / AD-8).
//
// The discriminated result the `packages/discovery` `resolveAddedTasteValue` read
// returns when a value the user picked in the 7.1 typeahead is resolved to its
// canonical `game_tag_nodes` node + tag-net dimension. It is CLASSIFY/RESOLVE +
// VALIDATE ONLY — 7.2 writes nothing; 7.3's `withTransaction` told-taste persist +
// the client render both CONSUME this shape (persist on `resolved`, show the
// localized fail message on `dimension_mismatch` / `unresolved`).
//
// THE BACKEND EMITS NO PROSE (AD-8 / D8). The `status` values are STABLE MACHINE
// CODES; the client localizes the fail message from the code through next-intl (the
// Story-7.2 reason-code→key mapper). The `resolved` result carries only PUBLIC
// taxonomy identity (`nodeId`, `dimension`, `labelKey`) + the OPAQUE servable image
// handle (`representativeImageRef`, or `null` when cold) — never a URL/path, never a
// rights-internal column.
//
// APPEND-ONLY status set — never rename or reorder a committed code (mirrors
// `insightProvenanceEnum` / `emptyReasonEnum` above). A `resolved` result's
// `dimension` is the NODE's tag-net dimension (a `tagDimensionEnum` value = the
// filing dimension, AC1). A `dimension_mismatch` carries the caller's `expected`
// scope and the node's `actual` dimension so the rejection is honest (AC2).
// ---------------------------------------------------------------------------

// The resolution status — a per-result machine code. `resolved` (found + validated),
// `dimension_mismatch` (found, but the caller's per-dimension scope disagrees with the
// node's dimension — REJECTED, never re-filed), `unresolved` (no ACTIVE, non-root node
// matches the picked `labelKey` — the stale/removed-vocabulary fail-clean, AC4).
export const addedTasteResolutionStatusEnum = z.enum(['resolved', 'dimension_mismatch', 'unresolved']);

export type AddedTasteResolutionStatus = z.infer<typeof addedTasteResolutionStatusEnum>;

// The RESOLVED variant — the canonical node identity 7.3's persist path files the told
// taste under. `dimension` is the node's tag-net dimension (the filing dimension);
// `representativeImageRef` is the servable image handle or `null` (the AC3 keyspace
// guarantee holds independent of a cold cover). `.strict()` — no prose field admitted.
export const resolvedAddedTasteSchema = z
  .object({
    status: z.literal('resolved'),
    nodeId: z.number().int(),
    dimension: tagDimensionEnum,
    labelKey: z.string(),
    representativeImageRef: z.string().nullable(),
  })
  .strict();

// The DIMENSION-MISMATCH variant (AC2). A node WAS found for the picked `labelKey`, but a
// per-dimension pick supplied a `scopedDimension` that disagrees with the node's dimension.
// `expected` is the caller-supplied scope (a string — it is untrusted client input, validated
// by this very rejection); `actual` is the resolved node's real tag-net dimension.
export const dimensionMismatchAddedTasteSchema = z
  .object({
    status: z.literal('dimension_mismatch'),
    expected: z.string(),
    actual: tagDimensionEnum,
  })
  .strict();

// The UNRESOLVED variant (AC4) — the fail-clean routine miss. No prose, no partial node;
// 7.3 writes nothing and the client localizes the message from the status code.
export const unresolvedAddedTasteSchema = z.object({ status: z.literal('unresolved') }).strict();

// THE RESOLUTION CONTRACT — the discriminated union `resolveAddedTasteValue` returns and
// 7.3 branches on. `status` routes each variant unambiguously; an unknown status fails
// discrimination → rejected.
export const addedTasteResolutionSchema = z.discriminatedUnion('status', [
  resolvedAddedTasteSchema,
  dimensionMismatchAddedTasteSchema,
  unresolvedAddedTasteSchema,
]);

export type ResolvedAddedTaste = z.infer<typeof resolvedAddedTasteSchema>;
export type DimensionMismatchAddedTaste = z.infer<typeof dimensionMismatchAddedTasteSchema>;
export type UnresolvedAddedTaste = z.infer<typeof unresolvedAddedTasteSchema>;
export type AddedTasteResolution = z.infer<typeof addedTasteResolutionSchema>;

// ===========================================================================
// THE BETWEEN-CARD INTERSTITIAL DESCRIPTOR (taste-profile Story 6.1 — AD-12 / FR-9).
//
// The typed contract for `apps/explore`'s ONE net-new, scheduled, skippable
// between-card interstitial seam. It sits BETWEEN two game cards; the Re-challenge
// prompt (6-3) and the Differentiate entry (6-5) both hang off it. This story ships
// only the SEAM — the descriptor shape below — plus a pure scheduler + an a11y host;
// there is no producer yet, so nothing is ever emitted and the loop is byte-for-byte
// today (the seam is DORMANT).
//
// ADDITIVE, LIKE `nextMoveNodeMoveSchema` ABOVE. It does NOT reshape
// `nextMoveResponseSchema`, `nextMoveGameMoveSchema`, `nextMoveNodeMoveSchema`,
// `signalWriteRequestSchema`, or any other shipped schema — it is a new, standalone
// union no existing consumer sees.
//
// MACHINE METADATA + i18n KEYS ONLY — THE BACKEND EMITS NO PROSE (AD-8 / D8), exactly
// like `nextMoveNodeMoveSchema.labelKey`. Every user-facing word is resolved through
// next-intl on the client from a variant-supplied KEY; the descriptor carries no English.
// The variants are `.strict()` so a prose-shaped free-form field (a `title`, a `prompt`,
// a raw English string) is REJECTED at the Zod boundary rather than silently stripped —
// the "no backend prose" rule is structural, not merely conventional.
//
// FORWARD-SHAPED, MINIMAL NOW. 6-2/6-3 EXTEND the `re_challenge` variant (the stale fact
// to confirm/adjust) and 6-5 EXTENDS the `differentiate` variant (the drill-down entry).
// Keep additions APPEND-ONLY on each variant so a persisted/serialized descriptor stays
// valid — never rename or reshape a committed field.
// ---------------------------------------------------------------------------

// The reserved interstitial kinds. A DISCRIMINATED UNION keys on this `kind` field so each
// variant carries only its own metadata and can never be paired with another's. APPEND-ONLY:
// never rename or reorder a committed value (mirrors `insightProvenanceEnum` above); a future
// interstitial kind is a deliberate, scope-gated addition here.
export const interstitialKindEnum = z.enum(['re_challenge', 'differentiate', 'reach_suggestion']);

export type InterstitialKind = z.infer<typeof interstitialKindEnum>;

// The RE-CHALLENGE variant (6-2/6-3). Carries MACHINE METADATA ONLY: which Stated Fact is
// being re-challenged (`fieldKey`, from the shipped `fieldKeyEnum` — never free text) and the
// node/prompt `labelKey` (a next-intl KEY the client localizes — NO new user-facing string,
// mirroring `nextMoveNodeMoveSchema.labelKey`). 6-2 chooses the one due stale fact and mints
// this; 6-3 renders the confirm/adjust content off it. `.strict()` — no prose field admitted.
export const reChallengeInterstitialSchema = z
  .object({
    kind: z.literal('re_challenge'),
    fieldKey: fieldKeyEnum,
    labelKey: z.string(),
  })
  .strict();

export type ReChallengeInterstitial = z.infer<typeof reChallengeInterstitialSchema>;

// The DIFFERENTIATE variant (6-5). Carries MACHINE METADATA ONLY: the taste `dimension` being
// drilled into (a stable facet token, not prose) and the node `labelKey` (a next-intl KEY —
// mirrors `nextMoveNodeMoveSchema`). 6-5 mints this from the TasteToken "Go deeper" entry and
// wires the drill-down round off it. `.strict()` — no prose field admitted.
export const differentiateInterstitialSchema = z
  .object({
    kind: z.literal('differentiate'),
    dimension: z.string(),
    labelKey: z.string(),
  })
  .strict();

export type DifferentiateInterstitial = z.infer<typeof differentiateInterstitialSchema>;

// The REACH-SUGGESTION variant (9-2). The client-side descriptor the scheduler stages when a `/next`
// response carries `nextMoveGameMoveSchema.reachSuggestion`. Carries MACHINE METADATA ONLY: the prompt
// `labelKey` (a next-intl KEY — mirrors `differentiateInterstitialSchema`). The client computes the
// wider reach step from its live reach state; the descriptor carries no target step and no prose.
// `.strict()` — no prose field admitted.
export const reachSuggestionInterstitialSchema = z
  .object({
    kind: z.literal('reach_suggestion'),
    labelKey: z.string(),
  })
  .strict();

export type ReachSuggestionInterstitial = z.infer<typeof reachSuggestionInterstitialSchema>;

// THE DESCRIPTOR CONTRACT — the discriminated union the scheduler carries and the host renders.
// `kind` unambiguously routes each variant; an unknown `kind` fails discrimination → rejected.
// Every variant exposes `labelKey`, so the host reads `descriptor.labelKey` for the a11y name on
// any kind without narrowing.
export const interstitialDescriptorSchema = z.discriminatedUnion('kind', [
  reChallengeInterstitialSchema,
  differentiateInterstitialSchema,
  reachSuggestionInterstitialSchema,
]);

export type InterstitialDescriptor = z.infer<typeof interstitialDescriptorSchema>;

// ===========================================================================
// Steam preference import — the envelope + payload contracts (steam-preferences
// Story 1.1, AC2/AC3). The verbatim Steam preference record a player exports via a
// link-and-paste (the no-install floor) or the versioned export snippet/extension.
//
// CONTRACT_VERSION is OWNED HERE — the ONE place the current envelope schema
// version is authored (AD-7). `packages/discovery`'s import service compares an
// envelope's `contract_version` against this constant to decide `unknown_contract_
// version`; the schema layer below only enforces the envelope's own SHAPE.
// ---------------------------------------------------------------------------

/** The current Steam-preference envelope contract version. Bump on a breaking shape change. */
export const STEAM_PREFERENCE_CONTRACT_VERSION = '1';

/** How the player got the record onto this page — the AD-6 export ladder. */
export const steamPreferenceProducerSchema = z.enum(['paste', 'extension', 'snippet']);
export type SteamPreferenceProducer = z.infer<typeof steamPreferenceProducerSchema>;

/** A `steam_preference_snapshots` row's lifecycle state (AD-2 — one `live` row per user). */
export const steamPreferenceSnapshotStatusSchema = z.enum(['live', 'superseded', 'deleted']);
export type SteamPreferenceSnapshotStatus = z.infer<typeof steamPreferenceSnapshotStatusSchema>;

/**
 * `rgIgnoredApps` needs its own two-part rule (Task 1, AC7). Steam serializes it as an OBJECT MAP
 * (`{ "<appid>": <reasonCode> }`) whenever it holds entries, but the ANONYMOUS baseline (never
 * dismissed anything) serializes the same field as an EMPTY ARRAY `[]` — a JS/PHP-style "empty
 * object looks like an empty array" artifact. A schema that rejects every array form would turn
 * AC7's "nothing to import" into a `malformed_payload` before the baseline check ever runs; a schema
 * that accepts every array form would silently swallow the KNOWN HISTORICAL DRIFT of a populated
 * array. So: an object map passes through as-is; an empty array normalizes to `{}`; a POPULATED
 * array still rejects (fails both union branches — `z.record` rejects arrays outright in zod 4, and
 * `.max(0)` rejects a non-empty one).
 */
export const steamPreferenceIgnoredAppsSchema = z
  .union([z.record(z.string(), z.number()), z.array(z.unknown()).max(0)])
  .transform((value) => (Array.isArray(value) ? {} : value));

/**
 * Known fields of the raw floor payload (`dynamicstore/userdata`'s shape), validated for presence
 * and shape. `.passthrough()` (zod 4 loose object — mirrors `packages/contracts/src/auth/index.ts`'s
 * `webauthnJson`) tolerates and RETAINS unknown additional fields verbatim, so a field Valve adds
 * tomorrow is not a shape rejection today. Every list field is REQUIRED (no `.default(...)`): Steam
 * emits every one of these keys on every account it has been observed from (an account with none of a
 * given kind still gets the key as `[]`, never an absent key), so a missing key means the payload is
 * not really a Steam preference record — a foreign JSON object (`{}`, a `package.json`, a Steam error
 * body `{ success: false }`) must fail shape validation and come back `malformed_payload`, not parse
 * with all nine lists silently synthesized as empty.
 *
 * `rgExcludedContentDescriptorIDs` stays `z.number()` (never coerced to string) — AC7's anonymous-
 * baseline check compares it against the literal `[3, 4]` by value. `rgOwnedApps` accepts either a
 * string or a number per entry — the appid ↔ catalog attribution overlap (Task 3) compares it against
 * `game_source_mappings.external_id`, a TEXT column, so both incoming shapes normalize the same way
 * at the comparison site rather than being pre-coerced here (this schema stays a shape validator, not
 * a normalizer, apart from the `rgIgnoredApps` empty-array case above).
 *
 * Do NOT constrain the values held inside `rgIgnoredApps`/`rgIgnoredPackages` (the per-item dismissal
 * REASON code): an unknown reason code is dormant semantics for Story 1.3's classifier, not a shape
 * failure here.
 */
/**
 * `rgExcludedTags` needs its own rule, for the same reason `rgIgnoredApps` does: the field's SHAPE
 * was inferred from the ANONYMOUS baseline, where it is an empty array and its element type is
 * therefore unobservable. A real logged-in record ships OBJECTS —
 * `{ tagid: 4736, name: '2D-Kampfspiel', timestamp_added: 1498249879 }` — one per switched-off tag.
 * A scalar-only element schema rejects every one of them, so the whole record came back
 * `malformed_payload` for exactly the players this feature is for: the ones who have actually
 * excluded tags. Verified against a real 26,406-dismissal export.
 *
 * Scalar forms stay accepted (a `tagid` alone is what the plan builder and the tag-axis mapping have
 * always consumed, and the snippet/extension may emit that form), and the object form NORMALIZES to
 * its `tagid`. That normalization is deliberate and is the second sanctioned exception to this
 * schema's shape-validator-not-normalizer rule: `rgExcludedTags` is consumed downstream as a list of
 * Steam store TAG IDS (`steam-preference-plan.ts`'s `normalizeAndDedupe`,
 * `steam-preference-report.ts`'s `.map(String)` delta sets), and normalizing here keeps every one of
 * those consumers correct instead of teaching each of them a second element shape. `name` and
 * `timestamp_added` are dropped: no consumer reads them, and the tag-axis mapping keys on the id.
 */
export const steamPreferenceExcludedTagsSchema = z
  .array(
    z.union([
      z.string(),
      z.number(),
      // A PLAIN object, deliberately not `.passthrough()`: only `tagid` is read, and the two sibling
      // keys Steam ships (`name`, `timestamp_added`) are dropped either way. Retaining them would
      // widen this member's inferred type with an index signature for no consumer's benefit — and
      // this file is large enough that the extra inference work degraded an unrelated type elsewhere
      // in the program to `never`.
      z.object({ tagid: z.union([z.string(), z.number()]) }),
    ]),
  )
  // Both arms cast EXPLICITLY rather than leaning on control-flow narrowing. `apps/account`'s
  // tsconfig runs with `strict: false`, and under that setting this toolchain does not narrow the
  // object arm of this union out of the fallback branch — the same seam
  // `steam-preference-import.ts`'s `DispatchResult` documents. An explicit cast type-checks
  // identically under both settings.
  .transform((entries): (string | number)[] =>
    entries.map((entry) => {
      if (entry !== null && typeof entry === 'object') {
        return (entry as { tagid: string | number }).tagid;
      }
      return entry as string | number;
    }),
  );

export const steamPreferencePayloadSchema = z
  .object({
    rgIgnoredApps: steamPreferenceIgnoredAppsSchema,
    rgIgnoredPackages: z.array(z.union([z.string(), z.number()])),
    rgExcludedTags: steamPreferenceExcludedTagsSchema,
    rgExcludedContentDescriptorIDs: z.array(z.number()),
    rgCuratorsIgnored: z.array(z.union([z.string(), z.number()])),
    rgCreatorsIgnored: z.array(z.union([z.string(), z.number()])),
    rgWishlist: z.array(z.union([z.string(), z.number()])),
    rgOwnedApps: z.array(z.union([z.string(), z.number()])),
    rgFollowedApps: z.array(z.union([z.string(), z.number()])),
  })
  .passthrough();

export type SteamPreferencePayload = z.infer<typeof steamPreferencePayloadSchema>;

/**
 * The self-identified envelope (AC2/AC3) — `.strict()` (mirrors `steamPreferenceEnvelopeSchema`'s
 * sibling strict schemas above) so an unknown envelope-level field REJECTS the whole file rather than
 * being silently dropped: dispatch in `packages/discovery`'s import service is decided by the
 * presence of `contract_version` alone, so a typo'd/foreign envelope field must be loud, never quiet.
 *
 * `contract_version` is a plain string here — the SHAPE layer. Whether it is a version this deploy
 * actually supports (`unknown_contract_version`) is a VALUE decision the import service makes by
 * comparing it to {@link STEAM_PREFERENCE_CONTRACT_VERSION}, so a future version bump needs no
 * contracts-package change to keep parsing older envelopes' shape.
 */
export const steamPreferenceEnvelopeSchema = z
  .object({
    contract_version: z.string(),
    producer: steamPreferenceProducerSchema,
    /** Informational only — the producer's own build/version string. Never re-validated as a gate. */
    producer_release: z.string().optional(),
    /** Present for `extension`/`snippet` producers (self-identification, AC4); absent for a floor paste. */
    steamid: z.string().optional(),
    payload: steamPreferencePayloadSchema,
  })
  .strict();

export type SteamPreferenceEnvelope = z.infer<typeof steamPreferenceEnvelopeSchema>;

/**
 * The maximum length of a `contract_version` string this deploy will ever ECHO BACK to the player
 * inside a {@link steamImportRejectionDetailSchema} `found`/`expected` field (steam-preferences Story
 * 2.2, AC1). `contract_version` is `z.string()` at the shape layer above — a caller-controlled value,
 * not a value this schema constrains in length — so an uploaded envelope could in principle claim a
 * multi-kilobyte "version". Authored BESIDE the detail schema below, rather than as a bare literal
 * inside it, so the schema's own `.max()` and the domain's display truncation can never drift apart.
 */
export const STEAM_IMPORT_CONTRACT_VERSION_DISPLAY_MAX = 32;

/**
 * The structured, non-prose detail carried on a rejected import response (steam-preferences Story
 * 2.2, AC1). `kind` is a DISCRIMINATOR, not a label: a later outcome that needs its own structured
 * detail joins this as an ADDITIVE union member (`steamImportRejectionDetailSchema` becomes a
 * `z.discriminatedUnion('kind', [...])`), never a reshape of this member's fields. `.strict()` so an
 * unexpected extra key on the wire is a shape rejection, not silently ignored.
 *
 * `expected`/`found` are capped at {@link STEAM_IMPORT_CONTRACT_VERSION_DISPLAY_MAX}: `expected` is
 * always `STEAM_PREFERENCE_CONTRACT_VERSION` (short and controlled by us), but `found` echoes the
 * envelope's OWN claimed `contract_version`, which is caller-controlled `z.string()` at the shape
 * layer above and therefore unbounded absent this cap.
 */
export const steamImportRejectionDetailSchema = z
  .object({
    kind: z.literal('contract_version'),
    expected: z.string().min(1).max(STEAM_IMPORT_CONTRACT_VERSION_DISPLAY_MAX),
    found: z.string().min(1).max(STEAM_IMPORT_CONTRACT_VERSION_DISPLAY_MAX),
  })
  .strict();

export type SteamImportRejectionDetail = z.infer<typeof steamImportRejectionDetailSchema>;

/**
 * The structured import outcome / rejection-reason vocabulary (AC2, AD-8/D8 — the API returns ONLY
 * this machine code plus non-prose detail; the client localizes it, no backend English prose ever
 * reaches the player). APPEND-ONLY, mirrors `reasonFactorCodeEnum`'s convention: never rename or
 * reorder a committed member. Every value needs a localized copy key (Task 6) —
 * `reason-code-copy-completeness.guard`'s precedent, `reasonFactorCodeEnum`.
 *
 *   - `accepted`                     — Phase A persisted the snapshot.
 *   - `nothing_to_import`            — the anonymous baseline (AC7): a distinct non-error outcome.
 *   - `malformed_payload`            — the floor payload failed shape validation.
 *   - `unknown_contract_version`     — a self-identified envelope named a `contract_version` this
 *     deploy does not recognize.
 *   - `unknown_envelope_field`       — a self-identified envelope carried a field outside the strict
 *     schema.
 *   - `payload_too_large`            — the raw body exceeded `STEAM_IMPORT_MAX_PAYLOAD_BYTES`.
 *   - `no_linked_steam_account`      — a self-identified envelope's steamid has no matching
 *     `linked_accounts` row for this user.
 *   - `identity_mismatch`            — a self-identified envelope's steamid does not equal the
 *     user's linked Steam account.
 *   - `attribution_below_threshold`  — HISTORICAL ONLY (see below).
 *   - `library_too_small_to_attribute` — HISTORICAL ONLY (see below).
 *
 * THE TWO HISTORICAL-ONLY MEMBERS. `attribution_below_threshold` and `library_too_small_to_attribute`
 * were the verdicts of the floor paste's library-overlap gate, which the 2026-09-06 operator decision
 * removed: an import is now taken on the player's word, because it lands exclusively in their own
 * account (the reasoning lives in ONE place — `packages/discovery-account/src/steam-preference-import.ts`'s
 * attribution docblock — and is enforced by `steam-import-signals-never-crowd-vote.guard.test.ts`).
 * The import can no longer return either one. They stay in this enum, keep their category mapping, and
 * keep their player-facing copy because `steam_preference_import_outcomes` holds durable rows written
 * before that decision, and the alarm read buckets them through the total category map below — a
 * member removed here would make those rows undecodable. This is the append-only rule (AD-8) doing its
 * job, not an undecided question.
 */
export const steamImportOutcomeSchema = z.enum([
  'accepted',
  'nothing_to_import',
  'malformed_payload',
  'unknown_contract_version',
  'unknown_envelope_field',
  'payload_too_large',
  'no_linked_steam_account',
  'identity_mismatch',
  'attribution_below_threshold',
  'library_too_small_to_attribute',
]);

export type SteamImportOutcome = z.infer<typeof steamImportOutcomeSchema>;

/**
 * The FR-38 four-bucket log/alarm vocabulary (Story 1.6, AC3) — reconciled against the shipped
 * ten-member {@link steamImportOutcomeSchema} in the Dev Notes mapping table (steam-preferences
 * Story 1.6). `nothing_to_import` is kept as its OWN bucket rather than folded into any of the
 * epic's four names: an anonymous-baseline paste is neither an acceptance nor a failure, and
 * folding it into `shape_rejected` would make a player pasting the wrong tab look like an upstream
 * drift, while folding it into the denominator alone would understate the real rejection rate.
 */
export const steamImportOutcomeCategorySchema = z.enum([
  'accepted',
  'nothing_to_import',
  'shape_rejected',
  'attribution_failed',
]);
export type SteamImportOutcomeCategory = z.infer<typeof steamImportOutcomeCategorySchema>;

/**
 * TOTAL by construction (Story 1.6, AC3): a `Record<SteamImportOutcome, SteamImportOutcomeCategory>`
 * rather than a `switch` with a `default` — a new `steamImportOutcomeSchema` member is a COMPILE
 * ERROR here until it is categorized, so it can never fall through into a bucket by accident (the
 * shipped route helper this replaces ended `return 'attribution_failed'`, which would have silently
 * miscounted a future outcome and moved the R-2 alarm's denominator). This is the FR-38 log line's
 * and the R-2 alarm's ONE grouping (AD-8) — the relocation of Story 1.1's shipped classification,
 * byte for byte, never re-litigated: `accepted → accepted`; `nothing_to_import → nothing_to_import`;
 * `malformed_payload | unknown_contract_version | unknown_envelope_field | payload_too_large →
 * shape_rejected`; `no_linked_steam_account | identity_mismatch | attribution_below_threshold |
 * library_too_small_to_attribute → attribution_failed`.
 */
export const STEAM_IMPORT_OUTCOME_CATEGORY: Record<SteamImportOutcome, SteamImportOutcomeCategory> = {
  accepted: 'accepted',
  nothing_to_import: 'nothing_to_import',
  malformed_payload: 'shape_rejected',
  unknown_contract_version: 'shape_rejected',
  unknown_envelope_field: 'shape_rejected',
  payload_too_large: 'shape_rejected',
  no_linked_steam_account: 'attribution_failed',
  identity_mismatch: 'attribution_failed',
  attribution_below_threshold: 'attribution_failed',
  library_too_small_to_attribute: 'attribution_failed',
};

/** Total accessor over {@link STEAM_IMPORT_OUTCOME_CATEGORY} — never re-derive the grouping at a call site (AD-7). */
export function steamImportOutcomeCategory(outcome: SteamImportOutcome): SteamImportOutcomeCategory {
  return STEAM_IMPORT_OUTCOME_CATEGORY[outcome];
}

// ---------------------------------------------------------------------------
// steam-preferences Story 1.2 — the Resolved Meaning enum, the delta shape, and the import report.
// AD-1: this enum is the ONE vocabulary of meaning a dismissal can resolve to. It is STAMPED into
// the ledger by Story 1.3 and READ (never re-derived) by every other consumer; the classifier that
// is allowed to PRODUCE one of these values lives at `packages/discovery/src/steam-preference-
// classifier.ts` and is the sole caller-class this module's guard (Task 7) enumerates as legitimate.
// ---------------------------------------------------------------------------

/**
 * The five Resolved Meanings a `0`/`2`-reason-code dismissal can settle into (AD-1). A reason code
 * outside `{0, 2}` never reaches this enum — it is dormant (no meaning, no guess, AD-3).
 *
 *   - `disliked`          — reason `0`, not owned. The only meaning that means what its name says.
 *   - `exhausted`         — reason `0`, owned, playtime at/above the exhaustion threshold.
 *   - `unplayed_residue`  — reason `0`, owned, playtime at/below the residue band.
 *   - `played_elsewhere`  — reason `2`, any ownership/playtime.
 *   - `unresolved`        — reason `0`, owned, playtime between the bands, or playtime `'unknown'`.
 *     Carries NO taste weight; a wrongly-assigned `unresolved` cannot cause the R-1 inversion.
 */
export const steamResolvedMeaningSchema = z.enum([
  'disliked',
  'exhausted',
  'unplayed_residue',
  'played_elsewhere',
  'unresolved',
]);

export type SteamResolvedMeaning = z.infer<typeof steamResolvedMeaningSchema>;

/**
 * The AD-7 game-suppression set (Story 1.4) the D11 eligibility anti-join compares against. Built
 * from {@link steamResolvedMeaningSchema}'s own enum accessors — never re-typed string literals —
 * so it exists precisely so no consumer re-literals a meaning (the `steam-resolved-meaning-single-
 * owner` guard's forward note). Membership here means "excluded from suggestion retrieval", never
 * "negative taste": `disliked` is a taste judgement and must never be added to this set (AD-7).
 */
export const STEAM_SUPPRESSING_RESOLVED_MEANINGS = [
  steamResolvedMeaningSchema.enum.exhausted,
  steamResolvedMeaningSchema.enum.played_elsewhere,
] as const satisfies readonly [SteamResolvedMeaning, SteamResolvedMeaning];

export type SteamSuppressingResolvedMeaning = (typeof STEAM_SUPPRESSING_RESOLVED_MEANINGS)[number];

/**
 * The AC7 re-import delta — computed against the PREVIOUS live snapshot's payload, read before it is
 * superseded. `null` (never this shape with all-zero counts) when there was no previous snapshot —
 * the report says so explicitly rather than a caller inferring "first import" from zeros that could
 * also mean "nothing changed". Every count is a plain non-negative integer (D8/AD-8 — no prose).
 */
export const steamImportDeltaSchema = z
  .object({
    previous_snapshot_id: z.string(),
    previous_imported_at: z.string(),
    /**
     * Games in `rgOwnedApps` now that were not there at the previous import — what the player BOUGHT
     * (or was gifted, or claimed) in between. Reported ADDED-only, unlike every other pair in this
     * delta: a Steam library shrinks only through a refund or a revoked key, so a permanent
     * "0 games removed" line would be noise on every import for an event almost nobody ever sees.
     */
    owned_added: z.number().int().nonnegative(),
    dismissals_added: z.number().int().nonnegative(),
    dismissals_removed: z.number().int().nonnegative(),
    dismissals_reason_changed: z.number().int().nonnegative(),
    excluded_tags_added: z.number().int().nonnegative(),
    excluded_tags_removed: z.number().int().nonnegative(),
    ignored_sources_added: z.number().int().nonnegative(),
    ignored_sources_removed: z.number().int().nonnegative(),
  })
  .strict();

export type SteamImportDelta = z.infer<typeof steamImportDeltaSchema>;

/**
 * The Phase A import report (AC4/AC5/AC6) — a structured contract, never backend prose. Every value
 * is a number, a boolean, an id, or an ISO timestamp; the client localizes all of it. `.strict()` so
 * a stray field can never ride along into the `counts` jsonb column (Story 1.1's P0 lesson: a schema
 * that validates nothing accepts anything).
 *
 * `by_meaning` keys are built FROM `steamResolvedMeaningSchema`'s own members (`z.record` keyed by
 * the enum), so a future member added to the enum cannot be silently forgotten here.
 */
export const steamImportReportSchema = z
  .object({
    totals: z
      .object({
        dismissals: z.number().int().nonnegative(),
        owned_dismissals: z.number().int().nonnegative(),
        declared_exclusions: z.number().int().nonnegative(),
        ignored_curators: z.number().int().nonnegative(),
        ignored_creators: z.number().int().nonnegative(),
        wishlist: z.number().int().nonnegative(),
        owned: z.number().int().nonnegative(),
        followed: z.number().int().nonnegative(),
        content_descriptors_differ_from_baseline: z.boolean(),
      })
      .strict(),
    by_meaning: z.record(steamResolvedMeaningSchema, z.number().int().nonnegative()),
    dormant_unknown_reason: z.number().int().nonnegative(),
    understood: z.number().int().nonnegative(),
    needs_help: z.number().int().nonnegative(),
    delta: steamImportDeltaSchema.nullable(),
  })
  .strict();

export type SteamImportReport = z.infer<typeof steamImportReportSchema>;

// ---------------------------------------------------------------------------
// steam-preferences Story 1.3 — the AD-9 resolution-ledger vocabularies and the AD-2
// attribution-triple layer token. `steam_preference_resolutions` is the STAMP (Story 1.3's
// migration); these are its closed, application-owned vocabularies, read by every future
// consumer (Story 1.4's anti-join, Story 1.5's erasure, Epic 3's Insight Check) rather than a
// re-derivation. `steamResolvedMeaningSchema` above stays the ONE meaning vocabulary — nothing
// here re-defines it.
// ---------------------------------------------------------------------------

/**
 * The AD-9 ledger row's subject discriminator (`steam_preference_resolutions.subject_type`).
 * Phase B (Story 1.3) writes ONLY `game` rows — an `axis` row is written only when an axis
 * becomes an Insight Check candidate (Epic 3's contradiction-candidate generation), never here.
 */
export const steamResolutionSubjectTypeSchema = z.enum(['game', 'axis']);
export type SteamResolutionSubjectType = z.infer<typeof steamResolutionSubjectTypeSchema>;

/**
 * The Insight Check lifecycle a `steam_preference_resolutions` row moves through
 * (`steam_preference_resolutions.state`). Phase B (Story 1.3) writes ONLY `resolved` — the
 * classifier stamped a meaning at import time — and never any other member. `candidate` /
 * `settled` / `declined` / `withdrawn` are Epic 3's (candidate generation, the Insight Check
 * answer, a declined prompt) and Story 3.4's (`withdrawn`, a re-import's dropped subject).
 */
export const steamResolutionStateSchema = z.enum(['resolved', 'candidate', 'settled', 'declined', 'withdrawn']);
export type SteamResolutionState = z.infer<typeof steamResolutionStateSchema>;


/**
 * The `layer` half of the AD-2 attribution triple (`preference_signals.context.layer`) — which of
 * the record's five SIGNAL-PRODUCING layers produced a signal. This vocabulary is written into the
 * `preference_signals.context` jsonb column on every Phase B signal write, so it is exactly the set
 * of layers that can ever appear there, and it never grows for a layer that writes no signal. The
 * work plan's full layer vocabulary is {@link steamPreferencePlanLayerSchema} below, which is a
 * SUPERSET of this one.
 */
export const steamPreferenceLayerSchema = z.enum([
  'dismissal',
  'declared_exclusion',
  'content_descriptor',
  'ignored_curator',
  'ignored_creator',
]);
export type SteamPreferenceLayer = z.infer<typeof steamPreferenceLayerSchema>;

/**
 * The AC3 work plan's FIXED layer order — every layer `buildMaterializationPlan` concatenates, in
 * the exact order it concatenates them. `materialized_through` is a numeric INDEX into that plan, so
 * this order is load-bearing for resumability, not documentation: reordering or INSERTING a member
 * re-points every in-flight snapshot's watermark at a different unit. APPENDING is the safe edit and
 * the only one made here — indices already handed out keep their meaning, and a snapshot mid-drain
 * simply continues into the new tail.
 *
 * The first five members are {@link steamPreferenceLayerSchema}'s, unchanged and in the same order.
 * The two appended layers write NO `preference_signals` row at all, which is why they are NOT in that
 * schema: they carry the record's own STATEMENTS OF FACT rather than evidence of taste.
 *
 *   - `owned_library` — the record's `rgOwnedApps`, materialized into `user_game_library`. This is the
 *     library a player with a PRIVATE Steam profile can never sync: `GetOwnedGames` returns `[]` for a
 *     private profile, so before this layer their subtails library stayed empty and every
 *     library-shaped surface was dead for them, while the record they had already pasted listed every
 *     game they own.
 *   - `wishlist_intent` — the record's `rgWishlist`, materialized into `play_next_queue`, which is
 *     where this product already keeps a wishlist ("Save to Play-Next", `wishlist-service.ts`).
 *   - `followed_intent` — the record's `rgFollowedApps`, materialized into the SAME `play_next_queue`
 *     (operator decision, 2026-09-06). Following a game on Steam and wishlisting it are two ways of
 *     saying "this one, later", and the queue is idempotent on `(user_id, game_id)`, so a game the
 *     player did BOTH to lands there exactly once. It is a separate layer rather than a merge into
 *     `wishlist_intent` for the reason the whole enum order exists: merging would re-sort that layer's
 *     units and move indices an in-flight `materialized_through` already points at, while appending
 *     leaves every handed-out index meaning what it meant.
 *
 * Ownership is not a preference. A game appearing in any of these layers says the player owns or
 * wants it, never that they like it, which is why none of them writes a signal and why an imported
 * library row is kept out of the playtime classifier's inputs (see `steam-preference-materialize.ts`).
 */
export const steamPreferencePlanLayerSchema = z.enum([
  'dismissal',
  'declared_exclusion',
  'content_descriptor',
  'ignored_curator',
  'ignored_creator',
  'owned_library',
  'wishlist_intent',
  'followed_intent',
]);
export type SteamPreferencePlanLayer = z.infer<typeof steamPreferencePlanLayerSchema>;

/**
 * The `user_game_library.sync_source` / provenance token for a library row created from an imported
 * Steam preference record rather than measured through the Steam Web API.
 *
 * THIS TOKEN IS A SAFETY BOUNDARY, not a label. `user_game_library.playtime_minutes` is
 * `NOT NULL DEFAULT 0`, and the dismissal classifier reads a present row's playtime as a MEASURED
 * minute count: zero minutes on an owned, dismissed game classifies `unplayed_residue` (a real taste
 * verdict), while a MISSING row classifies `unresolved` (no verdict at all). A pasted record carries
 * ownership but no playtime whatsoever, so a row created from it would assert a measured zero that
 * nobody measured, and manufacture the exact R-1 inversion the classifier exists to prevent. Rows
 * carrying this token are therefore excluded from every playtime lookup, leaving those games
 * honestly `unknown` until a real sync measures them.
 */
export const STEAM_LIBRARY_SYNC_SOURCE_PREFERENCE_IMPORT = 'preference_import';

/**
 * The AD-2 attribution triple stored in `preference_signals.context` for every Phase B write
 * (AC8) — what makes Story 1.5's scoped retraction able to remove exactly what a mistake
 * introduced. `.strict()` so a stray field can never ride along into the jsonb column (the
 * `steamImportReportSchema` P0 lesson: a schema that validates nothing accepts anything).
 * `resolved_meaning` is `null` for every non-`dismissal` layer (a declared exclusion, a content
 * descriptor, an ignored curator/creator carry no Resolved Meaning at all).
 */
export const steamPreferenceSignalContextSchema = z
  .object({
    snapshot_id: z.string().uuid(),
    layer: steamPreferenceLayerSchema,
    resolved_meaning: steamResolvedMeaningSchema.nullable(),
  })
  .strict();
export type SteamPreferenceSignalContext = z.infer<typeof steamPreferenceSignalContextSchema>;

/**
 * Taste Engine Story 1.7 (AC2) — the `game_labels` row-eligibility predicate for a `vote_count`
 * DERIVATION's denominator: `source === 'store_tag'` **and** a REAL taste dimension (never a
 * reserved processed-marker dimension). Lives HERE, in `@subtails/contracts` (`type:platform,
 * scope:shared`), rather than in `packages/ingestion` (its original home, Story 1.6) or
 * `packages/discovery` alone, because BOTH packages are `type:domain` and Invariant §4.1 forbids a
 * `type:domain -> type:domain` edge — `packages/discovery-jobs/src/membership.ts`'s μ-denominator scope
 * needs the identical predicate `packages/ingestion/src/providers/steamspy.ts` already exports, and
 * a shared `type:platform` home is the only legal way for both domain packages to consume ONE
 * definition rather than each carrying its own copy (the exact class of defect Story 1.6's review
 * finding P0 #2 exists to prevent). `packages/ingestion/src/providers/steamspy.ts` re-exports this
 * name so its existing call sites and tests are unaffected.
 *
 * Every `_steamspy_swept` tombstone (Story 1.6, AC4) is a `source='store_tag'` row carrying a
 * non-null `vote_count` that is a COUNT OF PERSISTED TAGS, not a SteamSpy community vote count —
 * ~3.4% of the `game_labels` table, a ~33% error on a low-vote game if folded into a μ denominator
 * (`SOLUTION-DESIGN.md` §1's denominator is `Σ vote_count` per game). `source='crowd'`'s
 * `vote_count` is a DIFFERENT quantity entirely (the number of distinct human labellers in a
 * consensus quorum, `apps/jobs/src/app/api/cron/crowd-consensus/route.ts`) and is excluded by the
 * `source === 'store_tag'` half alone.
 *
 * OPEN-VOCABULARY BY CONVENTION, not a hardcoded sentinel list (Invariant §9.1): `dimension.charAt(0)
 * !== '_'` excludes every reserved processed-marker dimension (`_steamspy_swept`,
 * `_store_tag_dimensioned`, `_machine_attempted`, and any future one) by the SAME `_`-prefix
 * convention `scripts/label-dimension-coverage.ts` already uses — a hardcoded `NOT IN (...)` would
 * silently stop excluding the next one anyone adds.
 *
 * Consume THIS exported predicate rather than re-deriving the scoping rule from prose: a rule only a
 * comment carries is a rule the next caller can obey wrongly while looking correct.
 */
export function isVoteCountEligibleLabel(row: { source: string; dimension: string }): boolean {
  return row.source === 'store_tag' && row.dimension.charAt(0) !== '_';
}

/**
 * Taste Engine Story 1.11 (AC10) — the `game_labels` row-eligibility predicate for TASTE-EVIDENCE
 * derivation from a plain game swipe (`deriveFacetSignalsFromGameSwipe` / `expandGameSignalToFacets`,
 * reached from `taste-mode-recompute.ts`'s bounded `game_labels` read). A `source='store_tag'` row
 * whose `dimension` is a reserved ingestion-internal marker (`_steamspy_swept`,
 * `_store_tag_dimensioned`, `_machine_attempted`, and any future one) is an INGESTION TOMBSTONE, not a
 * taste dimension a player could have "liked" or "disliked" — `normalizeSourceMembership` anchors
 * every `store_tag` row to the fixed `STORE_TAG_MEMBERSHIP_ANCHOR` (`0.5`) regardless of dimension, so
 * a tombstone clears the facet-expansion floor and is expanded into taste evidence exactly like a real
 * tag, diluting every genuine axis's mixture weight (measured on the Replay Fixture: two tombstone
 * dimensions carried a double-digit percentage share of the derived evidence mass and inflated the
 * active-axis count — see `taste-mode-recompute.ts`'s AC10 call site and Story 1.11's Dev Agent
 * Record for the exact counted figures).
 *
 * DELIBERATELY a SIBLING of {@link isVoteCountEligibleLabel}, never a re-export of it: the two answer
 * DIFFERENT questions (vote-count-denominator eligibility vs taste-evidence eligibility) that happen
 * to share the same reserved-marker convention today. `isVoteCountEligibleLabel` also requires
 * `source === 'store_tag'` (a `crowd`/`machine` row is never vote-count-eligible), which would be
 * WRONG here — a `crowd`/`machine` row's dimension is never an ingestion tombstone (only the
 * `store_tag` ingestion writers mint the reserved `_`-prefix), so this predicate admits every
 * non-`store_tag` row unconditionally and excludes a `store_tag` row ONLY when its dimension carries
 * the reserved `_`-prefix. A future divergence between the two rules (if one is ever recalibrated)
 * must not silently change both — declaring this as its own named function is what keeps that
 * possible.
 *
 * OPEN-VOCABULARY BY CONVENTION (Invariant §9.1) — the SAME `_`-prefix rule
 * {@link isVoteCountEligibleLabel} already documents, never a hardcoded dimension list: a future
 * reserved marker the ingestion pipeline mints is excluded by the convention alone.
 */
export function isTasteEvidenceEligibleLabel(row: { source: string; dimension: string }): boolean {
  return !(row.source === 'store_tag' && row.dimension.charAt(0) === '_');
}

// ---------------------------------------------------------------------------------------------
// steam-preferences Story 4.1 - Write-Back: the offer, the list, the record.
// ---------------------------------------------------------------------------------------------

/**
 * Every outcome a `steam_writeback_events` row may carry. The route records every one of them
 * ({@link steamWritebackRouteActionSchema}).
 */
export const steamWritebackOutcomeSchema = z.enum(['offered', 'declined', 'accepted', 'executed', 'failed']);
export type SteamWritebackOutcome = z.infer<typeof steamWritebackOutcomeSchema>;

/**
 * The actions the Write-Back route accepts (`accept` is the player's claim that they ran the snippet, Story 4.2;
 * `executed` and `failed` record the per-item result the extension observed, Story 4.3).
 */
export const steamWritebackRouteActionSchema = z.enum(['offer', 'decline', 'accept', 'executed', 'failed']);
export type SteamWritebackRouteAction = z.infer<typeof steamWritebackRouteActionSchema>;

/** The most appids one request may carry (the cap is tuned in `taste-insights-config.ts`; this is the wire ceiling). */
export const STEAM_WRITEBACK_REQUEST_APPID_CEILING = 500;

/** One offerable item: the reviewed-list shape Stories 4.2 and 4.3 hand to an executor (appid plus title). */
export const steamWritebackOfferItemSchema = z.object({
  appid: z.number().int().positive(),
  title: z.string(),
});
export type SteamWritebackOfferItem = z.infer<typeof steamWritebackOfferItemSchema>;

/** The version of the batch envelope the player copies to the Write-Back snippet (Story 4.2). */
export const STEAM_WRITEBACK_BATCH_CONTRACT_VERSION = '1';

/** The most appids the snippet accepts in one batch. */
export const STEAM_WRITEBACK_SNIPPET_APPID_CEILING = 200;

/** The batch envelope the app copies for the snippet: `{contract_version:'1', appids:[positive ints]}`. */
export const steamWritebackBatchSchema = z.object({
  contract_version: z.literal(STEAM_WRITEBACK_BATCH_CONTRACT_VERSION),
  appids: z.array(z.number().int().positive()).min(1).max(STEAM_WRITEBACK_SNIPPET_APPID_CEILING),
});
export type SteamWritebackBatch = z.infer<typeof steamWritebackBatchSchema>;

/** The version of the report the extension hands the page after it ran a batch (Story 4.3). */
export const STEAM_WRITEBACK_REPORT_CONTRACT_VERSION = '1';

/**
 * The per-item result of an extension Write-Back run: `executed` only when the dismissal was observed gone
 * from the player's Steam record after the run, `failed` for everything else. Carries appids and outcomes
 * only, never a credential.
 */
export const steamWritebackReportSchema = z.object({
  contract_version: z.literal(STEAM_WRITEBACK_REPORT_CONTRACT_VERSION),
  results: z
    .array(z.object({ appid: z.number().int().positive(), outcome: z.enum(['executed', 'failed']) }))
    .min(1)
    .max(STEAM_WRITEBACK_SNIPPET_APPID_CEILING),
});
export type SteamWritebackReport = z.infer<typeof steamWritebackReportSchema>;

/** POST /api/user/steam-writeback request body. Evidence and titles are never client-supplied. */
export const steamWritebackRequestSchema = z.object({
  action: steamWritebackRouteActionSchema,
  appids: z.array(z.number().int().positive()).min(1).max(STEAM_WRITEBACK_REQUEST_APPID_CEILING),
});
export type SteamWritebackRequest = z.infer<typeof steamWritebackRequestSchema>;

/** POST response: the appids that were actually recorded (ineligible ones are ignored). */
export const steamWritebackResponseSchema = z.object({
  action: steamWritebackRouteActionSchema,
  recorded: z.array(z.number().int().positive()),
});
export type SteamWritebackResponse = z.infer<typeof steamWritebackResponseSchema>;
