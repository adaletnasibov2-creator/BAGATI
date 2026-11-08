import { AccountSwitchBar } from "@/components/account-switch-bar";
import { currentUser } from "@/lib/auth";

const ROLE_LABEL = { CUSTOMER: "müştəri", VENDOR: "satıcı", ADMIN: "admin" } as const;

export async function ActiveSessionNotice({ returnTo }: { returnTo: string }) {
  const user = await currentUser();
  if (!user) return null;
  return <AccountSwitchBar email={user.email} roleLabel={ROLE_LABEL[user.role]} returnTo={returnTo} />;
}
