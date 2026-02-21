#!/usr/bin/env npx tsx
/**
 * fetch-state.ts — Single CLI to fetch all project-tab server state.
 *
 * Usage:
 *   npx tsx project-tab/scripts/fetch-state.ts route
 *   npx tsx project-tab/scripts/fetch-state.ts debrief [--since 2h|friday|2026-02-19T00:00:00Z]
 *
 * Outputs a single JSON object with all fetched data.
 * Exits with code 1 if the server is unreachable.
 */

const SERVER = process.env.PROJECT_TAB_SERVER ?? "http://localhost:3001";

type Mode = "route" | "debrief";

async function fetchJSON(url: string, method = "GET"): Promise<any> {
  try {
    const res = await fetch(url, { method });
    if (!res.ok) return { _error: `${res.status} ${res.statusText}` };
    return await res.json();
  } catch (e: any) {
    return { _error: e.message };
  }
}

function parseSince(value: string): string {
  // Relative times: "2h", "30m", "3d"
  const match = value.match(/^(\d+)([mhd])$/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    const ms =
      unit === "m" ? num * 60_000 : unit === "h" ? num * 3_600_000 : num * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }

  // Day names: "friday", "monday", etc.
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayIdx = days.indexOf(value.toLowerCase());
  if (dayIdx !== -1) {
    const now = new Date();
    let diff = now.getDay() - dayIdx;
    if (diff <= 0) diff += 7;
    const target = new Date(now.getTime() - diff * 86_400_000);
    target.setHours(0, 0, 0, 0);
    return target.toISOString();
  }

  // Assume ISO date or date string
  try {
    return new Date(value).toISOString();
  } catch {
    console.error(`Invalid --since value: "${value}"`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode: Mode = args[0] === "debrief" ? "debrief" : "route";

  // Parse --since for debrief
  let since: string | undefined;
  const sinceIdx = args.indexOf("--since");
  if (sinceIdx !== -1 && args[sinceIdx + 1]) {
    since = parseSince(args[sinceIdx + 1]);
  }

  // Step 1: Core state — all in parallel
  const coreEndpoints: Record<string, [string, string?]> = {
    health: [`${SERVER}/api/health`],
    project: [`${SERVER}/api/project`],
    agents: [`${SERVER}/api/agents`],
    decisions: [`${SERVER}/api/decisions`],
    controlMode: [`${SERVER}/api/control-mode`],
  };

  if (mode === "route") {
    coreEndpoints.coherence = [`${SERVER}/api/coherence`];
    coreEndpoints.artifacts = [`${SERVER}/api/artifacts`];
  }

  const coreKeys = Object.keys(coreEndpoints);
  const coreResults = await Promise.all(
    coreKeys.map((k) => fetchJSON(coreEndpoints[k][0], coreEndpoints[k][1]))
  );
  const result: Record<string, any> = { _mode: mode };
  coreKeys.forEach((k, i) => (result[k] = coreResults[i]));

  // Bail if server is unreachable
  if (result.health?._error) {
    console.log(JSON.stringify({ error: "Server unreachable", details: result.health._error }));
    process.exit(1);
  }

  // Events for debrief (time-windowed)
  if (mode === "debrief") {
    const sinceParam = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    result._since = sinceParam;
    result.events = await fetchJSON(
      `${SERVER}/api/events?types=artifact,completion,coherence,decision,lifecycle,error&since=${encodeURIComponent(sinceParam)}&limit=500`
    );
  }

  // Step 2: Trust scores for non-terminated agents
  const agents: any[] = Array.isArray(result.agents) ? result.agents : [];
  const activeAgents = agents.filter(
    (a) => a.status !== "terminated" && a.status !== "killed"
  );
  if (activeAgents.length > 0) {
    const trustResults = await Promise.all(
      activeAgents.map((a) => fetchJSON(`${SERVER}/api/trust/${a.id}`))
    );
    const trustScores: Record<string, any> = {};
    activeAgents.forEach((a, i) => (trustScores[a.id] = trustResults[i]));
    result.trustScores = trustScores;
  } else {
    result.trustScores = {};
  }

  // Step 3: Insights (if project has history)
  // Note: debrief mode doesn't fetch artifacts, so insights gate on resolved decisions only.
  // Route mode fetches artifacts, so either resolved decisions or artifacts trigger insight fetching.
  const decisions: any[] = Array.isArray(result.decisions) ? result.decisions : [];
  const artifacts: any[] = Array.isArray(result.artifacts) ? result.artifacts : [];
  const hasHistory =
    decisions.some((d) => d.status === "resolved") || artifacts.length > 0;

  if (hasHistory) {
    const insightEndpoints: Record<string, string> = {
      overridePatterns: `${SERVER}/api/insights/override-patterns`,
      reworkAnalysis: `${SERVER}/api/insights/rework-analysis`,
      controlModeRoi: `${SERVER}/api/insights/control-mode-roi`,
    };
    if (mode === "route") {
      insightEndpoints.injectionEfficiency = `${SERVER}/api/insights/injection-efficiency`;
    }

    const insightKeys = Object.keys(insightEndpoints);
    const insightResults = await Promise.all(
      insightKeys.map((k) => fetchJSON(insightEndpoints[k], "POST"))
    );
    const insights: Record<string, any> = {};
    insightKeys.forEach((k, i) => (insights[k] = insightResults[i]));
    result.insights = insights;
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
