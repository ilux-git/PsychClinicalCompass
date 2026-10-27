import {useEffect,useRef} from "react";
import {ExternalLink,X} from "lucide-react";
import type {User} from "./api";
import {Button} from "./UI";
import {isTelegramPath,openFullWebsite} from "./telegramRuntime";
import {accountName} from "./presentation";

export function AccountSettings({user,close}:{user:User;close:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const element=dialog.current;
    element?.showModal();
    return()=>{if(element?.open)element.close();if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[user.id]);
  return <dialog ref={dialog} className="account-dialog" aria-labelledby="account-settings-title" onCancel={event=>{event.preventDefault();close();}}>
    <header><div><h2 id="account-settings-title">Настройки аккаунта</h2><p>{accountName(user.display_name)} · {user.username}</p></div><button type="button" className="icon-button" aria-label="Закрыть настройки" onClick={close}><X size={20}/></button></header>
    <div className="account-dialog-body">
      <section className="account-link-section" aria-labelledby="telegram-login-mode-title">
        <h3 id="telegram-login-mode-title">Вход в приложение</h3>
        <p>Веб-версия и Telegram используют логин и пароль Вашей учётной записи.</p>
        <p className="muted">Постоянная привязка к Telegram отключена. При новом открытии Mini App потребуется войти снова.</p>
      </section>
      <section className="account-link-section" aria-labelledby="environment-mode-title">
        <h3 id="environment-mode-title">Режим стенда</h3>
        <p>Демонстрационный режим с синтетическими пациентами. Внешняя доставка сообщений в Telegram и приём документов ЭМК симулируются; юридическая электронная подпись не применяется.</p>
        <p>Обмен баллов на купон показывает механику программы. Реальная скидка, цена приёма и оплата в клинике не меняются.</p>
        <p>Сгенерированные завершения опросов участвуют в общих количествах, но исключаются из временных метрик. Использованные и исключённые завершения указаны в аналитике отдельно.</p>
      </section>
      {isTelegramPath()&&<Button variant="secondary" onClick={openFullWebsite}><ExternalLink size={16}/>Открыть веб-версию</Button>}
    </div>
  </dialog>;
}
