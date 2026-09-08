// Goal Decomposer: Breaks down high-level procedural instructions
// into an ordered sequence of discrete, actionable sub-tasks.

export interface DecomposedGoal {
  goal: string;
  subtasks: string[];
  isMultiStep: boolean;
}

const ACTION_VERBS = [
  "click", "open", "type", "search", "find", "scroll", "navigate",
  "view", "select", "enter", "download", "pay", "submit", "check"
];

/**
 * Splits a compound user goal into ordered atomic subtasks.
 */
export function decomposeGoal(goalStr: string): DecomposedGoal {
  if (!goalStr || typeof goalStr !== "string") {
    return { goal: "", subtasks: [], isMultiStep: false };
  }

  const trimmed = goalStr.trim();

  // Explicit sequential connectives
  const explicitDelimiters = /\s+(?:then|after\s+that|followed\s+by|and\s+then)\s+|;\s*/i;
  let rawParts = trimmed.split(explicitDelimiters).map((p) => p.trim()).filter(Boolean);

  // If no explicit sequential connective was used, check for "and" connecting two action clauses
  if (rawParts.length === 1 && /\band\b/i.test(trimmed)) {
    const andParts = trimmed.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
    // Both parts must contain at least one recognized action verb to be considered independent steps
    const allHaveVerbs = andParts.every((part) =>
      ACTION_VERBS.some((verb) => new RegExp(`\\b${verb}\\b`, "i").test(part))
    );

    if (allHaveVerbs && andParts.length > 1) {
      rawParts = andParts;
    }
  }

  // Ensure each subtask is clean and non-empty
  const subtasks = rawParts.length > 0 ? rawParts : [trimmed];

  return {
    goal: trimmed,
    subtasks,
    isMultiStep: subtasks.length > 1,
  };
}
