// Privacy & Resource Budget Tracker
// Bounds cumulative network leakage, remote escalations, and execution step count.

export interface BudgetLimits {
  maxCumulativeBytes?: number; // Maximum cumulative network bytes allowed per session (default: 50 KB)
  maxRemoteCalls?: number;     // Maximum fallback VLM API calls allowed per session (default: 4)
  maxSteps?: number;           // Maximum procedural action steps allowed per goal (default: 8)
}

export interface BudgetStatus {
  exceeded: boolean;
  cumulativeBytesSent: number;
  remoteCallsMade: number;
  stepsExecuted: number;
  reason?: string;
}

export class SessionPrivacyBudget {
  private maxBytes: number;
  private maxRemoteCalls: number;
  private maxSteps: number;

  private cumulativeBytes: number = 0;
  private remoteCalls: number = 0;
  private steps: number = 0;

  constructor(limits: BudgetLimits = {}) {
    this.maxBytes = limits.maxCumulativeBytes ?? 50 * 1024; // 50 KB default
    this.maxRemoteCalls = limits.maxRemoteCalls ?? 4;
    this.maxSteps = limits.maxSteps ?? 8;
  }

  /**
   * Checks if another action step is permitted under the step budget.
   */
  public canExecuteNextStep(): boolean {
    return this.steps < this.maxSteps;
  }

  public getSteps(): number {
    return this.steps;
  }

  public getMaxSteps(): number {
    return this.maxSteps;
  }

  /**
   * Checks if an outbound remote call is permitted under current budget.
   */
  public canEscalate(estimatedBytes: number = 0): boolean {
    if (this.remoteCalls >= this.maxRemoteCalls) return false;
    if (this.cumulativeBytes + estimatedBytes > this.maxBytes) return false;
    return true;
  }

  /**
   * Records execution of an action step.
   */
  public recordStep(bytesSent: number, isRemote: boolean): void {
    this.steps++;
    this.cumulativeBytes += bytesSent;
    if (isRemote) {
      this.remoteCalls++;
    }
  }

  /**
   * Checks whether any session budget limit has been breached.
   */
  public getStatus(): BudgetStatus {
    if (this.steps > this.maxSteps) {
      return {
        exceeded: true,
        cumulativeBytesSent: this.cumulativeBytes,
        remoteCallsMade: this.remoteCalls,
        stepsExecuted: this.steps,
        reason: `Maximum step limit exceeded (${this.steps} > ${this.maxSteps}). Halting runaway loop.`,
      };
    }

    if (this.cumulativeBytes > this.maxBytes) {
      return {
        exceeded: true,
        cumulativeBytesSent: this.cumulativeBytes,
        remoteCallsMade: this.remoteCalls,
        stepsExecuted: this.steps,
        reason: `Session privacy budget exceeded: transmitted ${this.cumulativeBytes} B (limit: ${this.maxBytes} B).`,
      };
    }

    if (this.remoteCalls > this.maxRemoteCalls) {
      return {
        exceeded: true,
        cumulativeBytesSent: this.cumulativeBytes,
        remoteCallsMade: this.remoteCalls,
        stepsExecuted: this.steps,
        reason: `Maximum remote call budget exceeded (${this.remoteCalls} > ${this.maxRemoteCalls}).`,
      };
    }

    return {
      exceeded: false,
      cumulativeBytesSent: this.cumulativeBytes,
      remoteCallsMade: this.remoteCalls,
      stepsExecuted: this.steps,
    };
  }

  public reset(): void {
    this.cumulativeBytes = 0;
    this.remoteCalls = 0;
    this.steps = 0;
  }
}
