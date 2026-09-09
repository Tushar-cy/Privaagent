// Live On-Page Privacy Overlay Layer — Tri-Mode Defense Engine
// Modes:
// 1. "BLUR" (Default) — Precision floating dark slate blur overlays with Range API exact sub-string bboxes.
// 2. "GHOST" — CSS Ghost Masking directly on DOM text nodes: text becomes transparent and vaporized with text-shadow glow (unselectable, uncopyable in clipboard, unreadable in print/inspect).
// 3. "SYNTHETIC" — Displays format-preserving differential privacy synthetic honeypot surrogates (Verhoeff Aadhaar, Luhn test card, valid PAN) in real-time.

import { PageElement, PageState } from "../common/types";
import { getSubStringBoundingBox } from "../privacy/redactor";
import { resolveElementByTargetId } from "../semantic/dom-extractor";
import { SensitiveDetection } from "../privacy/sensitivity";
import { BoundingBox } from "../common/types";
import { generateSyntheticSurrogate } from "../privacy/synthetic-replacer";

const OVERLAY_CONTAINER_ID = "privaagent-redaction-root";
const HUD_BADGE_ID = "privaagent-status-hud";
const GHOST_STYLE_ID = "privaagent-ghost-style";

export type RedactionMode = "BLUR" | "GHOST" | "SYNTHETIC";

interface OverlayEntry {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  isSecret: boolean;
  type: string;
  syntheticValue?: string;
}

export class OverlayManager {
  private container: HTMLDivElement | null = null;
  private hudBadge: HTMLDivElement | null = null;
  private isVisible: boolean = true;
  private mode: RedactionMode = "BLUR";
  private doc: Document;
  private lastPageState: PageState | null = null;
  private ghostTaggedElements: Set<Element> = new Set();

  constructor(doc: Document = document) {
    this.doc = doc;
  }

  private ensureGhostStyle(): void {
    let style = this.doc.getElementById(GHOST_STYLE_ID) as HTMLStyleElement;
    if (!style && this.doc.head) {
      style = this.doc.createElement("style");
      style.id = GHOST_STYLE_ID;
      style.textContent = `
        .privaagent-ghost-redacted {
          color: transparent !important;
          text-shadow: 0 0 10px rgba(56, 189, 248, 0.85) !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          pointer-events: none !important;
        }
      `;
      this.doc.head.appendChild(style);
    }
  }

  private removeGhostStyle(): void {
    for (const el of this.ghostTaggedElements) {
      el.classList.remove("privaagent-ghost-redacted");
    }
    this.ghostTaggedElements.clear();
    const style = this.doc.getElementById(GHOST_STYLE_ID);
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  private ensureContainer(): HTMLDivElement {
    let container = this.doc.getElementById(OVERLAY_CONTAINER_ID) as HTMLDivElement;
    if (!container) {
      container = this.doc.createElement("div");
      container.id = OVERLAY_CONTAINER_ID;
      container.style.position = "fixed";
      container.style.inset = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.pointerEvents = "none";
      container.style.zIndex = "2147483640";
      container.style.overflow = "hidden";

      if (this.doc.body) {
        this.doc.body.appendChild(container);
      }
    }
    this.container = container;
    return container;
  }

  public setMode(mode: RedactionMode): void {
    this.mode = mode;
    if (mode === "GHOST") {
      this.ensureGhostStyle();
    } else {
      this.removeGhostStyle();
    }
    if (this.lastPageState) {
      this.renderRedactionOverlays(this.lastPageState);
    }
  }

  public getMode(): RedactionMode {
    return this.mode;
  }

  public updateHUD(level: string = "L0", statusText: string = "Privacy Shield Active"): void {
    if (!this.doc.body) return;

    let hud = this.doc.getElementById(HUD_BADGE_ID) as HTMLDivElement;
    if (!hud) {
      hud = this.doc.createElement("div");
      hud.id = HUD_BADGE_ID;
      hud.style.position = "fixed";
      hud.style.bottom = "16px";
      hud.style.right = "16px";
      hud.style.background = "#07090f";
      hud.style.color = "#38bdf8";
      hud.style.padding = "6px 12px";
      hud.style.borderRadius = "20px";
      hud.style.fontSize = "12px";
      hud.style.fontWeight = "600";
      hud.style.boxShadow = "0 4px 16px rgba(0,0,0,0.5)";
      hud.style.border = "1px solid #38bdf855";
      hud.style.zIndex = "2147483647";
      hud.style.pointerEvents = "auto";
      hud.style.display = "flex";
      hud.style.alignItems = "center";
      hud.style.gap = "6px";
      hud.style.transition = "all 0.2s ease";
      this.doc.body.appendChild(hud);
    }

    const modeIndicator = this.mode === "GHOST" ? "👻 GHOST" : this.mode === "SYNTHETIC" ? "🍯 SYNTH" : "🛡️ BLUR";

    hud.innerHTML = `
      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#34d399; box-shadow:0 0 6px #34d399;"></span>
      <span style="font-weight:700;">Privaagent</span>
      <span style="background:#0e1320; color:#38bdf8; border:1px solid #1e2d4a; padding:1px 6px; border-radius:10px; font-size:10px;">${level}</span>
      <span style="background:rgba(56,189,248,0.15); color:#38bdf8; padding:1px 5px; border-radius:4px; font-size:9.5px; font-weight:700;">${modeIndicator}</span>
      <span style="color:#94a3b8; font-size:11px;">${statusText}</span>
    `;
    this.hudBadge = hud;
  }

  private computeLabel(type: string, isSecret: boolean): string {
    if (this.mode === "SYNTHETIC") {
      const surrogate = generateSyntheticSurrogate(type);
      return `🍯 ${surrogate}`;
    }

    if (isSecret) return "⬛ [SECRET]";
    switch (type) {
      case "EMAIL": return "🔒 [EMAIL]";
      case "PHONE": return "🔒 [PHONE]";
      case "AADHAAR": return "🔒 [AADHAAR]";
      case "PAN": return "🔒 [PAN]";
      case "CREDIT_CARD": return "🔒 [CARD]";
      case "GSTIN": return "🏛️ [GSTIN]";
      case "DRIVING_LICENSE": return "🪪 [DL]";
      case "BANK_ACCOUNT": return "🏦 [BANK A/C]";
      case "DOB": return "📅 [DOB]";
      case "VEHICLE_RC": return "🚗 [RC]";
      case "PASSPORT_IN": return "✈️ [PASSPORT]";
      case "VOTER_ID": return "🗳️ [VOTER ID]";
      case "UPI_ID": return "💸 [UPI]";
      case "IFSC": return "🏦 [IFSC]";
      case "PERSON": return "🛡️ [NAME]";
      case "PASSWORD": return "🔑 [PASSWORD]";
      default: return "🔒 [REDACTED]";
    }
  }

  private computeOverlayEntries(el: PageElement): OverlayEntry[] {
    const detections = (el.metadata?.sensitive_detections as SensitiveDetection[] | undefined) || [];
    const entries: OverlayEntry[] = [];

    if (!el.sensitive || !el.bbox) return entries;
    const [elemLeft, elemTop, elemWidth, elemHeight] = el.bbox;
    if (elemWidth <= 0 || elemHeight <= 0) return entries;

    const domEl = resolveElementByTargetId(el.target_id);

    // If in GHOST mode, tag live DOM element to vaporize text in DOM
    if (this.mode === "GHOST" && domEl) {
      domEl.classList.add("privaagent-ghost-redacted");
      this.ghostTaggedElements.add(domEl);
    }

    if (detections.length === 0) {
      entries.push({
        left: elemLeft,
        top: elemTop,
        width: elemWidth,
        height: elemHeight,
        label: this.computeLabel("GENERIC", false),
        isSecret: false,
        type: "GENERIC",
      });
      return entries;
    }

    for (const detection of detections) {
      const [spanStart, spanEnd] = detection.span;
      let bbox: BoundingBox | null = null;

      if (domEl) {
        bbox = getSubStringBoundingBox(domEl, spanStart, spanEnd, detection.text);
      }

      const isSecret = detection.type === "SECRET_KEY";
      const label = this.computeLabel(detection.type, isSecret);

      if (bbox && bbox[2] > 0 && bbox[3] > 0) {
        const [bLeft, bTop, bWidth, bHeight] = bbox;
        entries.push({
          left: bLeft,
          top: bTop,
          width: this.mode === "SYNTHETIC" ? Math.max(bWidth, 140) : bWidth,
          height: bHeight,
          label,
          isSecret,
          type: detection.type,
          syntheticValue: this.mode === "SYNTHETIC" ? generateSyntheticSurrogate(detection.type) : undefined,
        });
      } else {
        entries.push({
          left: elemLeft,
          top: elemTop,
          width: elemWidth,
          height: elemHeight,
          label,
          isSecret,
          type: detection.type,
        });
      }
    }

    return entries;
  }

  public renderRedactionOverlays(pageState: PageState): number {
    this.lastPageState = pageState;
    return this._doRender(pageState);
  }

  private _doRender(pageState: PageState): number {
    const container = this.ensureContainer();
    container.innerHTML = "";

    if (this.mode === "GHOST") {
      this.ensureGhostStyle();
    }

    if (!this.isVisible) {
      this.removeGhostStyle();
      return 0;
    }

    let overlayCount = 0;

    for (const el of pageState.elements) {
      if (!el.sensitive) continue;

      const entries = this.computeOverlayEntries(el);

      for (const entry of entries) {
        const overlay = this.doc.createElement("div");
        overlay.className = "privaagent-blur-overlay";
        overlay.style.position = "absolute";
        overlay.style.left = `${entry.left}px`;
        overlay.style.top = `${entry.top}px`;
        overlay.style.width = `${entry.width}px`;
        overlay.style.height = `${entry.height}px`;

        if (this.mode === "GHOST") {
          overlay.style.backgroundColor = "transparent";
          overlay.style.border = "1px dashed #38bdf866";
          overlay.style.borderRadius = "3px";
        } else if (this.mode === "SYNTHETIC") {
          overlay.style.backgroundColor = "rgba(15, 23, 42, 0.96)";
          overlay.style.border = "1px solid #10b981";
          overlay.style.borderRadius = "3px";
        } else {
          // Standard BLUR mode
          overlay.style.backgroundColor = entry.isSecret ? "rgba(0, 0, 0, 0.98)" : "rgba(10, 15, 29, 0.93)";
          overlay.style.backdropFilter = entry.isSecret ? "none" : "blur(6px)";
          (overlay.style as any).webkitBackdropFilter = entry.isSecret ? "none" : "blur(6px)";
          overlay.style.border = entry.isSecret ? "1px solid #ef4444" : "1px dashed #38bdf888";
          overlay.style.borderRadius = "3px";
        }

        overlay.style.boxSizing = "border-box";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.overflow = "hidden";

        const badge = this.doc.createElement("span");
        badge.style.fontSize = "9px";
        badge.style.fontWeight = "bold";
        badge.style.padding = "1px 4px";
        badge.style.borderRadius = "2px";
        badge.style.whiteSpace = "nowrap";
        badge.style.overflow = "hidden";
        badge.style.maxWidth = "100%";

        if (this.mode === "SYNTHETIC") {
          badge.style.color = "#34d399";
          badge.style.background = "rgba(6, 78, 59, 0.85)";
          badge.style.fontFamily = "monospace";
        } else if (this.mode === "GHOST") {
          badge.style.color = "#38bdf8";
          badge.style.background = "rgba(14, 19, 32, 0.9)";
        } else {
          badge.style.color = entry.isSecret ? "#ef4444" : "#38bdf8";
          badge.style.background = "rgba(10, 15, 29, 0.95)";
        }

        badge.textContent = entry.label;
        overlay.appendChild(badge);

        container.appendChild(overlay);
        overlayCount++;
      }
    }

    return overlayCount;
  }

  public rerender(): void {
    if (this.lastPageState) {
      this._doRender(this.lastPageState);
    }
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    const container = this.ensureContainer();
    container.style.display = visible ? "block" : "none";
    if (!visible) {
      this.removeGhostStyle();
    } else if (this.mode === "GHOST") {
      this.ensureGhostStyle();
    }
    if (this.hudBadge) {
      this.hudBadge.style.opacity = visible ? "1" : "0.5";
    }
  }

  public destroy(): void {
    this.removeGhostStyle();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.hudBadge && this.hudBadge.parentNode) {
      this.hudBadge.parentNode.removeChild(this.hudBadge);
    }
  }
}
