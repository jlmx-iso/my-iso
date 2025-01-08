import { type Message } from "@prisma/client";

import client from "~/_lib/supabase";

export const messageSub = ({ threadId, cb }: { threadId: string, cb: (payload: { new: Message }) => void; }) => client
  .channel(`public:Message:threadId=eq.${threadId}`)
  .on('postgres_changes', { event: 'INSERT', filter: `threadId=eq.${threadId}`, schema: 'public', table: 'Message' }, cb)
  .on('postgres_changes', { event: 'UPDATE', filter: `threadId=eq.${threadId}`, schema: 'public', table: 'Message' }, cb)
  .subscribe()