/** Auth user shape — kept free of @supabase/supabase-js so the shell entry can import it. */
export type AppUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  isDisabled: boolean;
  createdAt: string;
};
