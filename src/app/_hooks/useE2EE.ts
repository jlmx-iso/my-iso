"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  decryptMessage,
  decryptThreadKey,
  encryptMessage,
  encryptThreadKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateKeyPair,
  generateThreadKey,
  importPrivateKeyJwk,
} from "~/_utils/crypto";
import {
  getPrivateKey,
  getThreadKey,
  storePrivateKey,
  storeThreadKey,
} from "~/_utils/keystore";
import { api } from "~/trpc/react";

type E2EEState = {
  ready: boolean;
  privateKey: CryptoKey | null;
};

/**
 * React hook that manages the full E2EE lifecycle:
 * - On mount: loads private key from IndexedDB, or restores from server backup,
 *   or generates a fresh key pair and registers it.
 * - Exposes encrypt/decrypt helpers bound to the current session's key material.
 */
export function useE2EE() {
  const [state, setState] = useState<E2EEState>({ privateKey: null, ready: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  const session = useSession();
  const sessionUserId = session.data?.user?.id;

  const setupKeysMutation = api.keys.setup.useMutation();
  const restoreKeysQuery = api.keys.restore.useQuery(undefined, { enabled: false });
  const apiUtils = api.useUtils();

  // Stable refs so the effect never captures stale hook instances
  const setupRef = useRef(setupKeysMutation);
  setupRef.current = setupKeysMutation;
  const restoreRef = useRef(restoreKeysQuery);
  restoreRef.current = restoreKeysQuery;
  const apiUtilsRef = useRef(apiUtils);
  apiUtilsRef.current = apiUtils;

  useEffect(() => {
    // Reset when user changes (logout/login without full reload)
    setState({ privateKey: null, ready: false });

    if (!sessionUserId) return;

    let cancelled = false;

    async function init(userId: string) {
      // 1. Check local IndexedDB first
      let privateKey = await getPrivateKey(userId);
      if (privateKey) {
        if (!cancelled) setState({ privateKey, ready: true });
        return;
      }

      // 2. Try to restore from server backup
      try {
        const result = await restoreRef.current.refetch();
        if (result.data?.privateKeyJwk) {
          privateKey = await importPrivateKeyJwk(result.data.privateKeyJwk);
          await storePrivateKey(userId, privateKey);
          if (!cancelled) setState({ privateKey, ready: true });
          return;
        }
      } catch {
        // Server has no backup yet — generate a fresh pair
      }

      // 3. Generate fresh key pair and register with server
      const pair = await generateKeyPair();
      const [publicKeyJwk, privateKeyJwk] = await Promise.all([
        exportPublicKeyJwk(pair.publicKey),
        exportPrivateKeyJwk(pair.privateKey),
      ]);

      await setupRef.current.mutateAsync({
        privateKeyJwk: privateKeyJwk as Record<string, unknown>,
        publicKeyJwk: publicKeyJwk as Record<string, unknown>,
      });
      await storePrivateKey(userId, pair.privateKey);

      if (!cancelled) setState({ privateKey: pair.privateKey, ready: true });
    }

    void init(sessionUserId).catch(() => {
      // Init failed — E2EE will remain unavailable
    });

    return () => { cancelled = true; };
  }, [sessionUserId]);

  /**
   * Encrypt plaintext for a thread.
   * Generates a thread key if none exists in IndexedDB yet, wraps it for
   * all recipients, and returns the ciphertext + wrapped keys.
   */
  const encryptForThread = useCallback(async (
    threadId: string,
    plaintext: string,
    recipientPublicJwks: { userId: string; jwk: JsonWebKey }[],
  ): Promise<{
    ciphertext: string;
    threadKeys?: { encryptedKey: string; userId: string }[];
  }> => {
    const { privateKey } = stateRef.current;
    if (!privateKey) throw new Error("E2EE not ready");
    let threadKey = await getThreadKey(threadId);
    let freshThreadKeys: { encryptedKey: string; userId: string }[] | undefined;

    // If no local thread key, try to restore from server (e.g. new device)
    if (!threadKey && !threadId.startsWith("pending-")) {
      try {
        const threadData = await apiUtilsRef.current.client.message.getThreadById.query({ threadId });
        const encryptedThreadKey = threadData?.threadKeys?.find(
          (k: { userId: string }) => k.userId === sessionUserId,
        )?.encryptedKey;
        if (encryptedThreadKey) {
          threadKey = await decryptThreadKey(encryptedThreadKey, privateKey);
          await storeThreadKey(threadId, threadKey);
        }
      } catch {
        // Server lookup failed — will generate a new key below
      }
    }

    if (!threadKey) {
      threadKey = await generateThreadKey();
      await storeThreadKey(threadId, threadKey);

      // Wrap for each participant (including self)
      freshThreadKeys = await Promise.all(
        recipientPublicJwks.map(async ({ jwk, userId }) => ({
          encryptedKey: await encryptThreadKey(threadKey!, jwk),
          userId,
        })),
      );
    }

    const ciphertext = await encryptMessage(threadKey, plaintext);
    return { ciphertext, threadKeys: freshThreadKeys };
  }, [sessionUserId]);

  /**
   * Decrypt a message given its thread ID. Loads the thread key from
   * IndexedDB, or decrypts the wrapped key first using the private key.
   */
  const decryptForThread = useCallback(async (
    threadId: string,
    ciphertext: string,
    encryptedThreadKey?: string,
  ): Promise<string> => {
    const { privateKey } = stateRef.current;

    let threadKey = await getThreadKey(threadId);
    if (!threadKey && encryptedThreadKey && privateKey) {
      try {
        threadKey = await decryptThreadKey(encryptedThreadKey, privateKey);
        await storeThreadKey(threadId, threadKey);
      } catch {
        return "[decryption failed]";
      }
    }
    if (!threadKey) {
      return "[encrypted]";
    }

    try {
      return await decryptMessage(threadKey, ciphertext);
    } catch {
      return "[decryption failed]";
    }
  }, []);

  return {
    decryptForThread,
    encryptForThread,
    ready: state.ready,
  };
}
