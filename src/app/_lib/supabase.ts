import { createClient } from "@supabase/supabase-js";
import { env } from "~/env";

export default createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)