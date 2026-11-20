import Link from "next/link";
import { redirect,notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AccountShell, accountCard } from "@/components/account-shell";
import { customerMessagesBadge } from "@/lib/messaging-pages";
import { ProfileForm } from "@/components/profile-form";
import { AddressBookClient } from "@/components/address-book-client";
import { Notifications } from "@/components/notifications";
import { EmptyState } from "@/components/ui/empty-state";
import { LogoutButton } from "@/components/logout-button";
import { PasswordChangeForm } from "@/components/password-change-form";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { GoogleUnlinkButton } from "@/components/google-unlink-button";
export const dynamic="force-dynamic";
export default async function AccountSectionPage({params,searchParams}:{params:Promise<{section:string[]}>;searchParams:Promise<{oauth?:string;portal?:string}>}){const user=await currentUser();if(!user||user.role!=="CUSTOMER")redirect(`/login?next=${encodeURIComponent("/account")}`);const [{section},{oauth,portal}]=await Promise.all([params,searchParams]);const current=section[0];let title="Hesabım";let content:React.ReactNode=null;
  if(current==="profile"){title="Profil məlumatları";const profile=await prisma.customerProfile.findUnique({where:{userId:user.id}});content=<section className={accountCard}><p className="text-sm text-fg-muted">E-poçt</p><p className="mt-1 break-words font-medium text-fg">{user.email}</p><ProfileForm profile={profile}/></section>}
  else if(current==="addresses"){title="Çatdırılma ünvanları";const [addresses,cities]=await Promise.all([prisma.address.findMany({where:{userId:user.id},include:{city:{select:{name:true}}},orderBy:{isDefault:"desc"}}),prisma.city.findMany({where:{isActive:true},select:{id:true,name:true},orderBy:{name:"asc"}})]);content=<AddressBookClient initial={addresses} cities={cities}/>}
  else if(current==="notifications"){title="Bildirişlər";const items=await prisma.notification.findMany({where:{userId:user.id},orderBy:{createdAt:"desc"},take:30});content=<Notifications items={items}/>}
  else if(current==="wishlist"){title="İstək siyahısı";content=<EmptyState title="İstək siyahısı hələ aktiv deyil" description="Mövcud verilənlər bazasında müştəri istək siyahısı modeli yoxdur."/>}
  else if(current==="security"){title="Təhlükəsizlik";const [googleAccount,accountSecurity]=await Promise.all([prisma.googleAccount.findUnique({where:{userId:user.id},select:{id:true}}),prisma.user.findUnique({where:{id:user.id},select:{passwordAuthEnabled:true}})]);content=<section className={accountCard}><h2 className="font-display text-h3 text-fg">Şifrə və sessiya</h2>{accountSecurity?.passwordAuthEnabled?<PasswordChangeForm/>:<p className="mt-2 text-sm text-fg-secondary">Bu hesab Google ilə idarə olunur; BAGATI şifrəsi dəyişdirilmir.</p>}<div className="mt-6 border-t border-line pt-5"><h2 className="font-display text-h3 text-fg">Google hesabı</h2>{googleAccount?<GoogleUnlinkButton canUnlink={Boolean(accountSecurity?.passwordAuthEnabled)}/>:<GoogleOAuthButton intent="customer" mode="link" nextPath="/account/security" errorCode={oauth} portal={portal}/>}</div><div className="mt-6 border-t border-line pt-5"><LogoutButton/></div><p className="mt-5 text-xs leading-5 text-fg-muted">{accountSecurity?.passwordAuthEnabled?<>Şifrənizi unutmusunuzsa, <Link href="/forgot-password" className="font-medium text-primary underline-offset-2 hover:underline">bərpa keçidi istəyin</Link>.</>:<>Bu hesab üçün Google hesabınızdan istifadə edin.</>} Çoxmərhələli təsdiq hazırda təqdim edilmir.</p></section>}
  else notFound();
  const messagesUnread=await customerMessagesBadge(user.id);
  return <AccountShell title={title} messagesUnread={messagesUnread}>{content}</AccountShell>
}
