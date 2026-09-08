// Live On-Page Privacy Overlay Layer
// Renders visual blur/blackout overlays over detected PII elements
// WITHOUT mutating or tampering with the live DOM text nodes.

import { PageElement, PageState } from "../common/types";

const OVERLAY_CONTAINER_ID = "privaagent-redaction-root";
const HUD_BADGE_ID = "privaagent-status-hud";

export class OverlayManager {
  private container: HTMLDivElement | null = null;
  private hudBadge: HTMLDivElement | null = null;
  private isVisible: boolean = true;
  private doc: Document;

  constructor(doc: Document = document) {
    this.doc = doc;
  }

  private ensureContainer(): HTMLDivElement {
    let container = this.doc.getElementById(OVERLAY_CONTAINER_ID) as HTMLDivElement;
    if (!container) {
      container = this.doc.createElement("div");
      container.id = OVERLAY_CONTAINER_ID;
      container.style.position = "absolute";
      container.style.top = "0";
      container.style.left = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.pointerEvents = "none";
      container.style.zIndex = "2147483640";
      container.style.overflow = "visible";

      if (this.doc.body) {
        this.doc.body.appendChild(container);
      }
    }
    this.container = container;
    return container;
  }

  /**
   * Injects or updates the floating privacy HUD badge on the webpage.
   */
  public updateHUD(level: string = "L0", statusText: string = "Privacy Shield Active"): void {
    if (!this.doc.body) return;

    let hud = this.doc.getElementById(HUD_BADGE_ID) as HTMLDivElement;
    if (!hud) {
      hud = this.doc.createElement("div");
      hud.id = HUD_BADGE_ID;
      hud.style.position = "fixed";
      hud.style.bottom = "16px";
      hud.style.right = "16px";
      hud.style.background = "#0f172a";
      hud.style.color = "#38bdf8";
      hud.style.padding = "6px 12px";
      hud.style.borderRadius = "20px";
      hud.style.fontSize = "12px";
      hud.style.fontWeight = "600";
      hud.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
      hud.style.border = "1px solid #38bdf844";
      hud.style.zIndex = "2147483647";
      hud.style.pointerEvents = "auto";
      hud.style.display = "flex";
      hud.style.alignItems = "center";
      hud.style.gap = "6px";
      hud.style.transition = "all 0.2s ease";
      this.doc.body.appendChild(hud);
    }

    hud.innerHTML = `
      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#4ade80;"></span>
      <span>Privaagent</span>
      <span style="background:#1e293b; color:#4ade80; padding:1px 6px; border-radius:10px; font-size:10px;">${level}</span>
      <span style="color:#94a3b8; font-size:11px;">${statusText}</span>
    `;
    this.hudBadge = hud;
  }

  /**
   * Renders redaction masks directly over coordinates of sensitive elements.
   */
  public renderRedactionOverlays(pageState: PageState): number {
    const container = this.ensureContainer();
    container.innerHTML = "";

    if (!this.isVisible) return 0;

    let overlayCount = 0;

    for (const el of pageState.elements) {
      if (!el.sensitive || !el.bbox) continue;

      const [left, top, width, height] = el.bbox;
      if (width <= 0 || height <= 0) continue;

      const overlay = this.doc.createElement("div");
      overlay.className = "privaagent-blur-overlay";
      overlay.style.position = "absolute";
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlay.style.backgroundColor = el.role === "face" ? "rgba(15, 23, 42, 0.85)" : "rgba(30, 41, 59, 0.75)";
      overlay.style.backdropFilter = "blur(8px)";
      (overlay.style as any).webkitBackdropFilter = "blur(8px)";
      overlay.style.border = "1px dashed #38bdf888";
      overlay.style.borderRadius = "4px";
      overlay.style.boxSizing = "border-box";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";

      // Small token indicator
      const badge = this.doc.createElement("span");
      badge.style.fontSize = "10px";
      badge.style.color = "#38bdf8";
      badge.style.fontWeight = "bold";
      badge.style.background = "rgba(15, 23, 42, 0.9)";
      badge.style.padding = "1px 4px";
      badge.style.borderRadius = "2px";
      badge.textContent = el.role === "face" ? "🛡️ [FACE_BLURRED]" : "🔒 [REDACTED]";
      overlay.appendChild(badge);

      container.appendChild(overlay);
      overlayCount++;
    }

    return overlayCount;
  }

  /**
   * Toggles visibility of overlays.
   */
  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    const container = this.ensureContainer();
    container.style.display = visible ? "block" : "none";
    if (this.hudBadge) {
      this.hudBadge.style.opacity = visible ? "1" : "0.5";
    }
  }

  /**
   * Cleans up all overlays and removes DOM containers.
   */
  public destroy(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.hudBadge && this.hudBadge.parentNode) {
      this.hudBadge.parentNode.removeChild(this.hudBadge);
    }
  }
}
