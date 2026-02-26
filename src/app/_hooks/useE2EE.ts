"use client";

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

    // Get userId from tRPC context (session is already loaded in the app shell)
    void apiUtilsRef.current.client.keys.getCurrentUserId.query().then((userId) => {
      if (userId && !cancelled) void init(userId);
    }).catch(() => {
      // Not authenticated — skip E2EE init
    });

    return () => { cancelled = true; };
  }, []);

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
    if (!stateRef.current.privateKey) throw new Error("E2EE not ready");
    let threadKey = await getThreadKey(threadId);
    let freshThreadKeys: { encryptedKey: string; userId: string }[] | undefined;

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
  }, []);

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
      threadKey = await decryptThreadKey(encryptedThreadKey, privateKey);
      await storeThreadKey(threadId, threadKey);
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
