import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Extract the leading JSDoc block that immediately precedes an `export` statement.
 * Returns the cleaned text (stripped of leading ` * ` prefixes) or undefined
 * if no qualifying multi-line JSDoc block is found.
 */
export function extractLeadingJsDoc(filePath: string): string | undefined {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  // Walk through lines looking for a /** ... */ block immediately followed by export
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trimStart()
    if (trimmed.startsWith('/**')) {
      const blockStartLine = i

      // Collect lines until we find */
      const blockLines: string[] = []
      let foundEnd = false
      while (i < lines.length) {
        blockLines.push(lines[i])
        if (lines[i].includes('*/')) {
          foundEnd = true
          i++
          break
        }
        i++
      }

      if (!foundEnd) continue

      // Must be multi-line (at least 3 lines: /**, content, */)
      if (blockLines.length < 3) continue

      // Check if the next non-blank line contains `export`
      let nextLine = i
      while (nextLine < lines.length && lines[nextLine].trim() === '') {
        nextLine++
      }
      if (nextLine < lines.length && lines[nextLine].includes('export')) {
        // Extract and clean the JSDoc text
        const cleaned = blockLines
          .map(line => {
            let l = line.trimStart()
            if (l.startsWith('/**')) l = l.slice(3)
            else if (l.startsWith('*/')) l = ''
            else if (l.startsWith('* ')) l = l.slice(2)
            else if (l.startsWith('*')) l = l.slice(1)
            // Handle trailing */
            if (l.endsWith('*/')) l = l.slice(0, -2)
            return l.trimEnd()
          })
          .filter((_, idx, arr) => {
            // Remove empty first/last lines from cleaning artifacts
            if (idx === 0 && arr[idx].trim() === '') return false
            if (idx === arr.length - 1 && arr[idx].trim() === '') return false
            return true
          })
          .join('\n')
          .trim()

        if (cleaned.length > 0) return cleaned
      }
    } else {
      i++
    }
  }

  return undefined
}

/**
 * Parse a barrel index.ts file and extract exported symbol names.
 * Handles:
 *   export { Foo, Bar } from './x'
 *   export type { Baz } from './y'
 *   export class Qux
 *   export function doThing
 *   export const THING
 *   export * from './z'   → returns ['*']
 */
export function parseBarrelExports(indexPath: string): string[] {
  const content = fs.readFileSync(indexPath, 'utf-8')
  const lines = content.split('\n')
  const symbols = new Set<string>()

  let accumulating = false
  let accumulated = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // If we're accumulating a multi-line export block, keep collecting
    if (accumulating) {
      accumulated += ' ' + trimmed
      if (trimmed.includes('}')) {
        // Block is complete — parse the accumulated content
        const innerMatch = accumulated.match(/\{([^}]+)\}/)
        if (innerMatch) {
          parseExportNames(innerMatch[1], symbols)
        }
        accumulating = false
        accumulated = ''
      }
      continue
    }

    // export * from './z'
    if (/^export\s+\*\s+from\s+/.test(trimmed)) {
      symbols.add('*')
      continue
    }

    // export { Foo, Bar } from './x'  or  export type { Foo, Bar } from './y'
    const braceMatch = trimmed.match(/^export\s+(?:type\s+)?\{([^}]+)\}/)
    if (braceMatch) {
      parseExportNames(braceMatch[1], symbols)
      continue
    }

    // Start of a multi-line export block: has `{` but no `}`
    if (/^export\s+(?:type\s+)?\{/.test(trimmed) && !trimmed.includes('}')) {
      accumulating = true
      accumulated = trimmed
      continue
    }

    // export class Qux / export function doThing / export const THING
    const declMatch = trimmed.match(/^export\s+(?:class|function|const|let|var|interface|enum|type)\s+(\w+)/)
    if (declMatch) {
      symbols.add(declMatch[1])
      continue
    }
  }

  return Array.from(symbols)
}

/**
 * Scan all .ts files in workstreamDir for cross-workstream import statements.
 * Maps import paths like `from '../otherDir/...'` to workstream IDs via allWorkstreamIds.
 * Returns deduplicated array of dependency workstream IDs, excluding self-references.
 */
export function extractDependencies(
  workstreamDir: string,
  allWorkstreamIds: Map<string, string>,
  rootFileWorkstreamId: string,
): string[] {
  const deps = new Set<string>()
  const files = collectTsFiles(workstreamDir)

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8')
    // Match import statements: import ... from '../dirName/...' or import ... from '../dirName'
    const importRegex = /from\s+['"]\.\.\/([^/'".]+)(?:\/[^'"]*)?['"]/g
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(content)) !== null) {
      const dirName = match[1]
      const wsId = allWorkstreamIds.get(dirName)
      if (wsId && wsId !== rootFileWorkstreamId) {
        deps.add(wsId)
      }
    }
  }

  return Array.from(deps)
}

/**
 * Build a full dependency graph for all workstreams.
 * Returns Map<workstreamId, dependencyIds[]>.
 */
export function buildDependencyGraph(
  workstreams: Array<{ id: string; dirPath: string }>,
  srcRoot: string,
): Map<string, string[]> {
  // Build a map from directory basenames to workstream IDs
  const dirToId = new Map<string, string>()
  for (const ws of workstreams) {
    const basename = path.basename(ws.dirPath)
    dirToId.set(basename, ws.id)
  }

  // Also map root-level .ts files (like bus.ts, tick.ts) by their stem
  // These aren't directories but are imported as '../bus', '../tick', etc.
  // We don't need to map these since they aren't workstreams

  const graph = new Map<string, string[]>()
  for (const ws of workstreams) {
    const deps = extractDependencies(ws.dirPath, dirToId, ws.id)
    graph.set(ws.id, deps)
  }

  return graph
}

/**
 * Follow `export * from './foo'` in barrel files, resolve to absolute paths.
 * Returns absolute file paths for each `export *` target.
 */
export function resolveBarrelTargetPaths(indexPath: string): string[] {
  if (!fs.existsSync(indexPath)) return []

  const content = fs.readFileSync(indexPath, 'utf-8')
  const lines = content.split('\n')
  const dir = path.dirname(indexPath)
  const results: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    const match = trimmed.match(/^export\s+\*\s+from\s+['"](\.\/[^'"]+)['"]/)
    if (match) {
      const specifier = match[1]
      // Try .ts extension
      const resolved = path.resolve(dir, specifier + '.ts')
      if (fs.existsSync(resolved)) {
        results.push(resolved)
      }
    }
  }

  return results
}

/**
 * Extract single-line `/** ... *​/` comments that precede `export` statements.
 * Returns array of cleaned text (skips trivially short ones < 10 chars).
 */
export function extractSingleLineJsDocs(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const results: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    // Match single-line JSDoc: /** text */ on one line
    const match = trimmed.match(/^\/\*\*\s+(.+?)\s*\*\/\s*$/)
    if (!match) continue

    // Check the block is truly single-line (not part of a multi-line block)
    // Check if the next non-blank line contains `export`
    let nextIdx = i + 1
    while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
      nextIdx++
    }
    if (nextIdx < lines.length && lines[nextIdx].includes('export')) {
      const text = match[1].trim()
      if (text.length >= 10) {
        results.push(text)
      }
    }
  }

  return results
}

/**
 * Collect multi-line JSDoc candidates from workstream files.
 * Returns an array of {fileName, text} for files that have qualifying JSDoc.
 * Also collects single-line JSDocs as additional candidates.
 */
export function collectJsDocCandidates(
  wsName: string,
  dirPath: string,
  files: string[],
  repoRoot: string,
): Array<{ fileName: string; text: string }> {
  const candidates: Array<{ fileName: string; text: string }> = []

  for (const f of files) {
    const absPath = path.join(repoRoot, f)
    const jsDoc = extractLeadingJsDoc(absPath)
    if (jsDoc) {
      candidates.push({ fileName: f, text: jsDoc })
    }
  }

  // Also collect single-line JSDocs as additional candidates
  for (const f of files) {
    const absPath = path.join(repoRoot, f)
    const singleLineDocs = extractSingleLineJsDocs(absPath)
    for (const text of singleLineDocs) {
      // Avoid duplicates — skip if same text already present
      if (!candidates.some(c => c.text === text)) {
        candidates.push({ fileName: f, text })
      }
    }
  }

  return candidates
}

/**
 * Master description resolver — implements 7-tier strategy.
 */
export function synthesizeModuleDescription(
  wsName: string,
  dirPath: string,
  files: string[],
  repoRoot: string,
  hasBarrelIndex: boolean,
): string {
  // Tier 6 (special case): integration
  if (wsName === 'integration') {
    return 'Cross-cutting integration and end-to-end test suite'
  }

  const indexPath = path.join(dirPath, 'index.ts')

  // Tier 1: Barrel JSDoc — barrel index.ts has qualifying multi-line JSDoc
  if (hasBarrelIndex) {
    const barrelJsDoc = extractLeadingJsDoc(indexPath)
    if (barrelJsDoc) {
      return firstSentence(barrelJsDoc)
    }
  }

  // Tier 2: export * following — barrel uses export *, follow targets
  if (hasBarrelIndex && fs.existsSync(indexPath)) {
    const barrelExports = parseBarrelExports(indexPath)
    if (barrelExports.includes('*')) {
      const targetPaths = resolveBarrelTargetPaths(indexPath)
      if (targetPaths.length > 0) {
        const descriptions: string[] = []
        for (const tp of targetPaths) {
          const docs = extractSingleLineJsDocs(tp)
          if (docs.length > 0) {
            descriptions.push(firstSentence(docs[0]))
          }
        }
        if (descriptions.length >= 2) {
          return descriptions.slice(0, 4).join('. ')
        }
      }
    }
  }

  // Tier 3: Best-representative multi-line JSDoc from any file
  // But if module has 6+ files and only 1 candidate, skip (prefer aggregation)
  if (files.length > 0) {
    const candidates: Array<{ file: string; jsDoc: string }> = []
    for (const f of files) {
      const absPath = path.join(repoRoot, f)
      const jsDoc = extractLeadingJsDoc(absPath)
      if (jsDoc) {
        candidates.push({ file: f, jsDoc })
      }
    }
    if (candidates.length > 0) {
      if (!(files.length >= 6 && candidates.length === 1)) {
        // Pick the longest
        candidates.sort((a, b) => b.jsDoc.length - a.jsDoc.length)
        return firstSentence(candidates[0].jsDoc)
      }
    }
  }

  // Tier 4: Single-line JSDoc aggregation from all files
  if (files.length > 0) {
    const allDocs: string[] = []
    for (const f of files) {
      const absPath = path.join(repoRoot, f)
      const docs = extractSingleLineJsDocs(absPath)
      for (const d of docs) {
        const sent = firstSentence(d)
        if (!allDocs.includes(sent)) {
          allDocs.push(sent)
        }
      }
    }
    if (allDocs.length > 0) {
      return allDocs.slice(0, 4).join('. ')
    }
  }

  // Tier 5: File-structure synthesis — humanize file names
  if (files.length > 0) {
    return synthesizeFromFileNames(wsName, files)
  }

  // Tier 7: Final fallback
  return `Workstream for ${wsName}`
}

/** Extract up to first sentence-ending punctuation (. ! ?). */
export function firstSentence(text: string): string {
  // Look for sentence-ending punctuation followed by space or end of string
  const match = text.match(/^(.*?[.!?])(?:\s|$)/)
  if (match) return match[1]
  // No sentence-ending punctuation — return full text (trimmed to first line)
  const firstLine = text.split('\n')[0].trim()
  return firstLine
}

/** Humanize kebab-case filenames into a readable description. */
export function synthesizeFromFileNames(wsName: string, files: string[]): string {
  const names = files
    .map(f => path.basename(f, '.ts'))
    .filter(n => n !== 'index')
    .map(n => n.replace(/-/g, ' '))
    .slice(0, 5)

  if (names.length === 0) return `Workstream for ${wsName}`
  return `${capitalize(wsName)}: ${names.join(', ')}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Extract exported symbol names from a single .ts file by scanning for
 * export declarations (class, function, const, interface, type, enum)
 * and re-export blocks (`export { A, B } from '...'` or `export { C }`).
 * Returns a deduplicated array of exported symbol names.
 * Returns empty array if the file does not exist.
 */
export function extractFileExports(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const symbols = new Set<string>()

  let accumulating = false
  let accumulated = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // If we're accumulating a multi-line export block, keep collecting
    if (accumulating) {
      accumulated += ' ' + trimmed
      if (trimmed.includes('}')) {
        const innerMatch = accumulated.match(/\{([^}]+)\}/)
        if (innerMatch) {
          parseExportNames(innerMatch[1], symbols)
        }
        accumulating = false
        accumulated = ''
      }
      continue
    }

    // export { Foo, Bar } from './x'  or  export type { Foo, Bar } from './y'
    // Also handles export { Foo, Bar } (no from clause)
    const braceMatch = trimmed.match(/^export\s+(?:type\s+)?\{([^}]+)\}/)
    if (braceMatch) {
      parseExportNames(braceMatch[1], symbols)
      continue
    }

    // Start of a multi-line export block: has `{` but no `}`
    if (/^export\s+(?:type\s+)?\{/.test(trimmed) && !trimmed.includes('}')) {
      accumulating = true
      accumulated = trimmed
      continue
    }

    // export class Foo / export function bar / export const BAZ / export interface Qux
    // export type MyType / export enum Status / export async function doThing
    const declMatch = trimmed.match(
      /^export\s+(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|enum|type)\s+(\w+)/,
    )
    if (declMatch) {
      symbols.add(declMatch[1])
      continue
    }
  }

  return Array.from(symbols)
}

/** Parse comma-separated export names from inside braces, handling `type` prefix and `as` renames. */
function parseExportNames(inner: string, symbols: Set<string>): void {
  const names = inner.split(',').map(n => n.trim()).filter(n => n.length > 0)
  for (let name of names) {
    // Strip inline `type` keyword (e.g., `type AuthRole` → `AuthRole`)
    name = name.replace(/^type\s+/, '')
    // Handle `Foo as Bar` — take the exported name (Bar)
    const asParts = name.split(/\s+as\s+/)
    symbols.add(asParts[asParts.length - 1].trim())
  }
}

/** Recursively collect all .ts files in a directory. */
function collectTsFiles(dir: string): string[] {
  const result: string[] = []
  if (!fs.existsSync(dir)) return result

  const stat = fs.statSync(dir)
  if (!stat.isDirectory()) {
    if (dir.endsWith('.ts')) return [dir]
    return result
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...collectTsFiles(fullPath))
    } else if (entry.name.endsWith('.ts')) {
      result.push(fullPath)
    }
  }

  return result
}
