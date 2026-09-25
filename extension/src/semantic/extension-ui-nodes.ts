// Exact-node registry for extension-owned page overlays. The extractor uses
// this to avoid treating Privaagent's own HUD and redaction badges as page
// content, without trusting page-controlled IDs or attributes.

const extensionUiNodes = new WeakSet<Element>();

export function markExtensionUiNode(element: Element): void {
  extensionUiNodes.add(element);
}

export function isExtensionUiNodeOrDescendant(element: Element): boolean {
  let current: Node | null = element;
  while (current) {
    if (current.nodeType === 1 && extensionUiNodes.has(current as Element)) return true;
    current = current.parentNode;
  }
  return false;
}
