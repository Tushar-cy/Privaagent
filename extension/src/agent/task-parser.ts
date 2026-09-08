// Natural Language Task Parser: Extracts intent, primitive action, keywords,
// and visual reasoning requirements from user prompt strings.

import { ActionType } from "../common/types";

export interface ParsedTask {
  raw: string;
  actionType: ActionType;
  keywords: string[];
  typeValue?: string;
  requiresVision: boolean;
  targetRoleHint?: string;
}

// Action verb classification
const VERB_ACTION_MAP: Record<string, ActionType> = {
  click: "click",
  press: "click",
  tap: "click",
  open: "click",
  view: "click",
  show: "click",
  expand: "click",
  select: "select",
  choose: "select",
  pick: "select",
  type: "type",
  enter: "type",
  input: "type",
  write: "type",
  fill: "type",
  scroll: "scroll",
  navigate: "navigate",
  goto: "navigate",
  visit: "navigate",
};

// Visual keywords that necessitate vision / canvas inspection
const VISION_KEYWORDS = [
  "canvas",
  "chart",
  "graph",
  "bar",
  "color",
  "blue",
  "red",
  "green",
  "photo",
  "avatar",
  "face",
  "picture",
  "image",
  "visual",
];

// Stopwords to prune from keyword indexing
const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "is", "it",
  "please", "can", "you", "me", "my", "this", "that", "representing",
  "into", "from", "with", "by", "as", "then", "after"
]);

/**
 * Parses a natural language task into structured semantic intent.
 */
export function parseTask(taskStr: string): ParsedTask {
  const clean = taskStr.trim();
  const lower = clean.toLowerCase();
  const tokens = lower.split(/[^a-z0-9_]+/).filter(Boolean);

  // 1. Identify primitive action verb
  let actionType: ActionType = "click"; // Default for browser interactions
  let foundVerbIndex = -1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (VERB_ACTION_MAP[token]) {
      actionType = VERB_ACTION_MAP[token];
      foundVerbIndex = i;
      break;
    }
  }

  // 2. Detect if task explicitly requires computer vision
  const requiresVision = tokens.some((t) => VISION_KEYWORDS.includes(t));

  // 3. Extract type value (e.g. "type hello into search")
  let typeValue: string | undefined;
  const typeValueTokens = new Set<string>();
  if (actionType === "type") {
    const quoteMatch = clean.match(/["']([^"']+)["']/);
    if (quoteMatch) {
      typeValue = quoteMatch[1];
    } else {
      const typeIndex = tokens.indexOf("type");
      if (typeIndex !== -1 && tokens[typeIndex + 1]) {
        typeValue = tokens[typeIndex + 1];
      }
    }
    if (typeValue) {
      typeValue
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .forEach((t) => {
          if (t) typeValueTokens.add(t);
        });
    }
  }

  // 4. Extract keywords (excluding stopwords, the action verb, and typed values)
  const keywords = tokens.filter(
    (t, idx) =>
      idx !== foundVerbIndex &&
      !STOPWORDS.has(t) &&
      !typeValueTokens.has(t) &&
      t.length > 1
  );

  // 5. Extract target role hint if mentioned
  let targetRoleHint: string | undefined;
  if (tokens.includes("button")) targetRoleHint = "button";
  else if (tokens.includes("link")) targetRoleHint = "link";
  else if (tokens.includes("input") || tokens.includes("field")) targetRoleHint = "textbox";
  else if (tokens.includes("chart") || tokens.includes("bar")) targetRoleHint = "chart_bar";

  return {
    raw: clean,
    actionType,
    keywords,
    typeValue,
    requiresVision,
    targetRoleHint,
  };
}
