export type PushPlatform = "android" | "desktop" | "ios";

export function detectPushPlatform(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : ""
): PushPlatform {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  return "desktop";
}

export function shouldUseSingleReminderAction(platform?: PushPlatform | string | null): boolean {
  // Chromium on Android can map multi-button notification actions to the wrong URL.
  return platform === "android";
}
