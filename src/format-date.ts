import { moment } from 'obsidian'

// Obsidian re-exports moment but types its return as `any`, which trips the
// review linter's no-unsafe-* rules at every call site. Contain that here: cast
// the result to a minimal typed shape once, so callers stay fully typed.
interface MomentLike {
  isValid(): boolean
  format(format?: string): string
}

// Parse `input` and format it with the given moment tokens; returns null when
// the input isn't a valid date (so callers can fall back to the raw value).
export const formatDate = (input: string, format: string): string | null => {
  const m = moment(input) as MomentLike
  return m.isValid() ? m.format(format) : null
}
