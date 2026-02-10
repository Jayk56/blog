/**
 * Artifact and provenance types.
 *
 * Artifacts are the outputs of agent work — code files, documents,
 * analyses, designs. Provenance tracks where each artifact came from,
 * who produced it, what inputs were used, and who reviewed it.
 *
 * From the blog post: "understanding what was produced by which agent,
 * from which inputs, so you can evaluate quality."
 */

/**
 * What kind of artifact this is. Determines how it's displayed
 * and what review expectations apply.
 */
export type ArtifactKind =
  | 'code'           // Source code files
  | 'document'       // Written content (docs, reports, blog posts)
  | 'design'         // Design specs, wireframes, architecture diagrams
  | 'data'           // Datasets, analysis results, visualizations
  | 'test'           // Test suites, test fixtures
  | 'configuration'  // Config files, deployment specs
  | 'research'       // Literature reviews, paper analyses (Rosa's world)
  | 'decision_record'; // ADRs, constraint definitions (David's ADR)

/**
 * Provenance chain for an artifact. Tracks the full lineage so
 * humans can evaluate quality and trace issues back to their source.
 *
 * "The provenance view shows her exactly which agent produced which
 * sections, what sources were used, and what the review agent thought."
 */
export interface Provenance {
  /** IDs of artifacts that were inputs to producing this artifact. */
  sourceArtifactIds: string[];
  /** ID of the agent that produced this artifact. */
  producerAgentId: string;
  /** IDs of agents that validated/reviewed this artifact. */
  validatorAgentIds: string[];
  /** ID of the human reviewer (if reviewed). Null if not yet reviewed. */
  humanReviewerId: string | null;
  /** IDs of decisions that influenced this artifact's creation. */
  relatedDecisionIds: string[];
  /** The tick when this artifact was produced. */
  producedAtTick: number;
  /** The tick when this artifact was last modified. */
  lastModifiedAtTick: number;
}

/**
 * An artifact produced by agent work within the project.
 * Displayed in provenance drawers and linked from decisions
 * and coherence issues.
 */
export interface Artifact {
  id: string;
  /** Display name, e.g. "notification-service.ts". */
  name: string;
  /** What kind of artifact this is. */
  kind: ArtifactKind;
  /** Brief description of the artifact's purpose. */
  description: string;
  /** Which workstream this artifact belongs to. */
  workstreamId: string;
  /** Full provenance chain. */
  provenance: Provenance;
  /**
   * Current quality assessment (0-1).
   * Computed from test results, review outcomes, and agent evaluation.
   * "Quality is measured, not estimated."
   */
  qualityScore: number;
  /** Current lifecycle status. */
  status: 'draft' | 'in_review' | 'approved' | 'needs_rework' | 'archived';
}
