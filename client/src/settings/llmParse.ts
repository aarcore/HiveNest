import { parseSuggestion, type SuggestCommandResult } from './llm'

/** Test helper / Agent reuse: parse model raw text into a suggestion. */
export function suggestCommandFromRaw(raw: string): SuggestCommandResult {
  return parseSuggestion(raw, 'test')
}
