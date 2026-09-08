// Accessibility (A11y) tree extraction and metadata fusion

export interface A11yInfo {
  role?: string;
  accessibleName?: string;
  accessibleDescription?: string;
  isHidden: boolean;
}

// Map HTML tag names to implicit ARIA roles
const TAG_ROLE_MAP: Record<string, string> = {
  button: "button",
  a: "link",
  input: "textbox",
  textarea: "textbox",
  select: "combobox",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  canvas: "img",
  img: "img",
  table: "table",
  nav: "navigation",
  header: "banner",
  footer: "contentinfo",
  main: "main",
  section: "region",
};

/**
 * Extracts ARIA roles and computed accessible names for an element.
 */
export function getElementA11yInfo(element: Element): A11yInfo {
  // Check aria-hidden
  const ariaHidden = element.getAttribute("aria-hidden");
  if (ariaHidden === "true") {
    return { isHidden: true };
  }

  // Explicit role takes precedence, then default tag role
  const explicitRole = element.getAttribute("role");
  const tagName = element.tagName.toLowerCase();
  const role = explicitRole || TAG_ROLE_MAP[tagName] || "generic";

  // Compute accessible name: aria-label -> aria-labelledby -> title -> textContent/alt/value
  let accessibleName: string | undefined;

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) {
    accessibleName = ariaLabel.trim();
  } else {
    const ariaLabelledby = element.getAttribute("aria-labelledby");
    if (ariaLabelledby) {
      const referencedElements = ariaLabelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);

      if (referencedElements.length > 0) {
        accessibleName = referencedElements
          .map((el) => el.textContent?.trim() || "")
          .filter(Boolean)
          .join(" ");
      }
    }
  }

  // Check title
  if (!accessibleName) {
    const title = element.getAttribute("title");
    if (title && title.trim()) {
      accessibleName = title.trim();
    }
  }

  // Check aria-describedby
  let accessibleDescription: string | undefined;
  const ariaDescribedby = element.getAttribute("aria-describedby");
  if (ariaDescribedby) {
    const descEl = document.getElementById(ariaDescribedby);
    if (descEl && descEl.textContent) {
      accessibleDescription = descEl.textContent.trim();
    }
  }

  return {
    role,
    accessibleName,
    accessibleDescription,
    isHidden: false,
  };
}
