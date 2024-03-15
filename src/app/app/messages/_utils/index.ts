import { type Message } from "@prisma/client";
import client from "~/app/_lib/supabase";

export const messageSub = ({ threadId, cb }: { threadId: string, cb: (payload: {new: Message}) => void; }) => client
  .channel(`public:Message:threadId=eq.${threadId}`)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', filter: `threadId=eq.${threadId}`, table: 'Message' }, cb)
  .subscribe()