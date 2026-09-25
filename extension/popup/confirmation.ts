export type TabMessageSender = (
  tabId: number,
  message: Record<string, unknown>,
  callback?: (response: any) => void
) => void;

/** Dispatches explicit approval back through the content script's execution gate. */
export function dispatchUserApprovedAction(
  sendTabMessage: TabMessageSender,
  tabId: number,
  action: unknown,
  callback: (response: any) => void,
  disclosureLevel: string = "L0"
): void {
  sendTabMessage(tabId, {
    type: "EXECUTE_ACTION",
    action,
    userConfirmed: true,
    disclosureLevel,
  }, callback);
}
