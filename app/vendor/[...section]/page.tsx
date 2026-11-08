import { EmptyPage } from "@/components/empty-page";
import { requireStoreAccess } from "@/lib/auth";
import { redirect } from "next/navigation";
export default async function Page({params}:{params:Promise<{section:string[]}>}){const {section}=await params;const access=await requireStoreAccess(section[0]);if(!access)redirect("/account");return <EmptyPage title={`Satıcı · ${section.slice(1).map(x=>x.replaceAll("-"," ")).join(" / ")||"Mağaza"}`}/>}
