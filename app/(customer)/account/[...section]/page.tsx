import Link from "next/link";
import { redirect,notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AccountNavigation } from "@/components/account-navigation";
import { ProfileForm } from "@/components/profile-form";
import { AddressBookClient } from "@/components/address-book-client";
import { Notifications } from "@/components/notifications";
import { EmptyState } from "@/components/state-panel";
import { LogoutButton } from "@/components/logout-button";
import { PasswordChangeForm } from "@/components/password-change-form";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { GoogleUnlinkButton } from "@/components/google-unlink-button";
export const dynamic="force-dynamic";
export default async function AccountSectionPage({params,searchParams}:{params:Promise<{section:string[]}>;searchParams:Promise<{oauth?:string;portal?:string}>}){const user=await currentUser();if(!user||user.role!=="CUSTOMER")redirect(`/login?next=${encodeURIComponent("/account")}`);const [{section},{oauth,portal}]=await Promise.all([params,searchParams]);const current=section[0];let title="Hesabım";let content:React.ReactNode=null;
  if(current==="profile"){title="Profil məlumatları";const profile=await prisma.customerProfile.findUnique({where:{userId:user.id}});content=<section className="rounded-2xl border border-line bg-white p-6"><p className="text-sm text-muted">E-poçt</p><p className="mt-1 font-medium">{user.email}</p><ProfileForm profile={profile}/></section>}
  else if(current==="addresses"){title="Çatdırılma ünvanları";const [addresses,cities]=await Promise.all([prisma.address.findMany({where:{userId:user.id},include:{city:{select:{name:true}}},orderBy:{isDefault:"desc"}}),prisma.city.findMany({where:{isActive:true},select:{id:true,name:true},orderBy:{name:"asc"}})]);content=<AddressBookClient initial={addresses} cities={cities}/>}
  else if(current==="notifications"){title="Bildirişlər";const items=await prisma.notification.findMany({where:{userId:user.id},orderBy:{createdAt:"desc"},take:30});content=<Notifications items={items}/>}
  else if(current==="wishlist"){title="İstək siyahısı";content=<EmptyState title="İstək siyahısı hələ aktiv deyil" detail="Mövcud verilənlər bazasında müştəri istək siyahısı modeli yoxdur."/>}
  else if(current==="security"){title="Təhlükəsizlik";const [googleAccount,accountSecurity]=await Promise.all([prisma.googleAccount.findUnique({where:{userId:user.id},select:{id:true}}),prisma.user.findUnique({where:{id:user.id},select:{passwordAuthEnabled:true}})]);content=<section className="rounded-2xl border border-line bg-white p-6"><h2 className="font-semibold">Şifrə və sessiya</h2>{accountSecurity?.passwordAuthEnabled?<PasswordChangeForm/>:<p className="mt-2 text-sm text-muted">Bu hesab Google ilə idarə olunur; BAGATI şifrəsi dəyişdirilmir.</p>}<div className="mt-6 border-t border-line pt-5"><h2 className="font-semibold">Google hesabı</h2>{googleAccount?<GoogleUnlinkButton canUnlink={Boolean(accountSecurity?.passwordAuthEnabled)}/>:<GoogleOAuthButton intent="customer" mode="link" nextPath="/account/security" errorCode={oauth} portal={portal}/>}</div><div className="mt-6 border-t border-line pt-5"><LogoutButton/></div><p className="mt-5 text-xs leading-5 text-muted">{accountSecurity?.passwordAuthEnabled?<>Şifrənizi unutmusunuzsa, <Link href="/forgot-password" className="font-medium text-emerald">bərpa keçidi istəyin</Link>.</>:<>Bu hesab üçün Google hesabınızdan istifadə edin.</>} Çoxmərhələli təsdiq hazırda təqdim edilmir.</p></section>}
  else notFound();
  return <div className="container py-10 md:py-14"><p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald"><Link href="/account">Hesabım</Link></p><h1 className="mt-2 mb-8 text-3xl font-semibold text-ink">{title}</h1><div className="grid gap-8 lg:grid-cols-[230px_1fr]"><AccountNavigation/><div>{content}</div></div></div>
}
