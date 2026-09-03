export type AppUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  isDisabled: boolean;
  createdAt: string;
};
