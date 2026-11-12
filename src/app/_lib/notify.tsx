"use client";

import { notifications, notificationsStore } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck, IconExclamationMark, IconInfoCircle } from "@tabler/icons-react";

/**
 * Toasts. Every toast in the app goes through here, so the four kinds look
 * and behave the same everywhere: an icon and colour per kind, and failures
 * stay on screen longer than confirmations. The look itself is in
 * src/app/theme/Notification.module.css.
 */
type Toast = {
  /** What happened, in a few words. */
  title: string;
  /** The detail: what it means or what to do next. */
  message: string;
  /** Showing a toast with the id of one on screen replaces it instead of stacking. */
  id?: string;
};

// `role`: failures interrupt a screen reader ("alert"); confirmations and
// information wait their turn ("status").
const KINDS = {
  error: { autoClose: 9000, color: "red", icon: <IconExclamationMark size={18} aria-hidden />, role: "alert" },
  info: { autoClose: 6000, color: "blue", icon: <IconInfoCircle size={18} aria-hidden />, role: "status" },
  success: { autoClose: 4500, color: "teal", icon: <IconCheck size={18} aria-hidden />, role: "status" },
  // Something went through, but not all of it; or "slow down".
  warning: { autoClose: 8000, color: "tan", icon: <IconAlertTriangle size={18} aria-hidden />, role: "alert" },
} as const;

function show(kind: keyof typeof KINDS, { id, message, title }: Toast) {
  const options = { ...KINDS[kind], "data-kind": kind, id, message, title };
  // Same id as a toast already on screen: update it in place.
  if (id && notificationsStore.getState().notifications.some((toast) => toast.id === id)) {
    notifications.update(options);
  } else {
    notifications.show(options);
  }
}

export const notify = {
  error: (toast: Toast) => show("error", toast),
  info: (toast: Toast) => show("info", toast),
  success: (toast: Toast) => show("success", toast),
  warning: (toast: Toast) => show("warning", toast),
};
