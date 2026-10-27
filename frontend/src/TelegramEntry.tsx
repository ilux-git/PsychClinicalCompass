import {useEffect,type ReactNode} from "react";
import {isTelegramPath,loadTelegramSDK,telegramWebApp,type TelegramWebApp} from "./telegramRuntime";

export function TelegramHost({children}:{children:ReactNode}) {
  useEffect(()=>{
    if(!isTelegramPath())return;
    let active=true,dispose=()=>{},configured:TelegramWebApp|undefined;
    const attach=(sdk:TelegramWebApp)=>{
      if(!active||configured===sdk)return;
      dispose();configured=sdk;
      const root=document.documentElement;
      root.classList.add("telegram-app");
      const appearance=()=>{
        const dark=sdk.colorScheme==="dark";
        root.dataset.telegramTheme=dark?"dark":"light";
        const color=dark?"#181b1c":"#F6F4EF";
        if(sdk.initData&&sdk.isVersionAtLeast?.("6.1")){sdk.setHeaderColor?.(color);sdk.setBackgroundColor?.(color);}
        const insets=[sdk.safeAreaInset,sdk.contentSafeAreaInset];
        for(const edge of ["top","bottom","left","right"] as const) {
          const value=insets.reduce((sum,area)=>sum+Math.max(0,Math.min(150,area?.[edge]??0)),0);
          root.style.setProperty(`--tg-inset-${edge}`,`${value}px`);
        }
        if(sdk.viewportStableHeight&&sdk.viewportStableHeight>0)root.style.setProperty("--tg-stable-height",`${sdk.viewportStableHeight}px`);
      };
      appearance();sdk.ready?.();if(sdk.initData)sdk.expand?.();
      const events=["themeChanged","safeAreaChanged","contentSafeAreaChanged","viewportChanged"];
      events.forEach(name=>sdk.onEvent?.(name,appearance));
      dispose=()=>{events.forEach(name=>sdk.offEvent?.(name,appearance));root.classList.remove("telegram-app");delete root.dataset.telegramTheme;};
    };
    const retryReady=()=>{const sdk=telegramWebApp();if(sdk)attach(sdk);};
    window.addEventListener('compass-telegram-sdk-ready',retryReady);
    void loadTelegramSDK().then(attach).catch(()=>{/* The entry view exposes an actionable retry. */});
    return()=>{active=false;dispose();window.removeEventListener('compass-telegram-sdk-ready',retryReady);};
  },[]);
  return <>{children}</>;
}
