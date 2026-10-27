/** Telegram launch data stays in the SDK; app credentials for /tg stay in memory. */
export type TelegramWebApp = {
  initData: string;
  colorScheme?: "light" | "dark";
  viewportStableHeight?: number;
  safeAreaInset?: {top:number;bottom:number;left:number;right:number};
  contentSafeAreaInset?: {top:number;bottom:number;left:number;right:number};
  ready?:()=>void;
  expand?:()=>void;
  isVersionAtLeast?:(version:string)=>boolean;
  setHeaderColor?:(color:string)=>void;
  setBackgroundColor?:(color:string)=>void;
  openLink?:(url:string)=>void;
  onEvent?:(name:string,handler:()=>void)=>void;
  offEvent?:(name:string,handler:()=>void)=>void;
  BackButton?: {show:()=>void;hide:()=>void;onClick:(handler:()=>void)=>void;offClick:(handler:()=>void)=>void};
};
declare global {interface Window {Telegram?:{WebApp?:TelegramWebApp}}}

export function isTelegramPath(path=typeof window==="undefined"?"/":window.location.pathname) {
  return path==="/tg"||path==="/tg/";
}
export const applicationBase=(path:string)=>isTelegramPath(path)?"/tg":"/";
export const telegramWebApp=()=>window.Telegram?.WebApp;
let sdkLoading:Promise<TelegramWebApp>|null=null;

export function loadTelegramSDK():Promise<TelegramWebApp> {
  const existing=telegramWebApp();
  if(existing)return Promise.resolve(existing);
  if(sdkLoading)return sdkLoading;
  sdkLoading=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://telegram.org/js/telegram-web-app.js";
    script.async=true;
    const fail=()=>{clearTimeout(timer);script.remove();sdkLoading=null;reject(new Error("Не удалось загрузить Telegram. Проверьте соединение и повторите попытку."));};
    const timer=setTimeout(fail,12000);
    script.onerror=fail;
    script.onload=()=>{clearTimeout(timer);const sdk=telegramWebApp();if(sdk){resolve(sdk);window.dispatchEvent(new Event('compass-telegram-sdk-ready'));}else fail();};
    document.head.append(script);
  });
  return sdkLoading;
}

export function openFullWebsite() {
  const url=new URL("/",window.location.origin).href;
  const sdk=telegramWebApp();
  if(sdk?.initData&&sdk.openLink)sdk.openLink(url);
  else window.location.assign(url);
}
