"use client";
import { useRef, useState } from "react";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";
import { buttonClass } from "@/components/ui/button";
export function LogoutButton(){const[busy,setBusy]=useState(false),[error,setError]=useState("");const submitting=useRef(false);async function logout(){if(submitting.current)return;submitting.current=true;setBusy(true);setError("");const result=await postLogout();if(!result.ok){setError(result.error);submitting.current=false;setBusy(false);return}finishAuthNavigation("/")}return <div><button disabled={busy} onClick={()=>void logout()} className={buttonClass({variant:"secondary",size:"sm"})}>{busy?"Çıxış edilir…":"Hesabdan çıx"}</button>{error&&<p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}</div>}
