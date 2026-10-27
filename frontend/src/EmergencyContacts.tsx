import {useEffect,useRef,useState} from "react";
import {Phone} from "lucide-react";
import "./emergency-contacts.css";

export function EmergencyContacts({active=false}:{active?:boolean}) {
  const [open,setOpen]=useState(active);
  const panel=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{if(active)setOpen(true);},[active]);
  useEffect(()=>{if(active&&open)panel.current?.scrollIntoView({block:"nearest"});},[active,open]);
  return <details ref={panel} className="emergency-contacts" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>Экстренная помощь</summary>
    <div className="emergency-contacts-body">
      <p role={active?"alert":undefined}><strong>{active?"Позвоните 112 сейчас. Не ждите ответа в чате.":"Если сейчас есть опасность для жизни, позвоните 112. Не ждите ответа в чате."}</strong></p>
      <div className="emergency-contact-actions"><a className="button primary" href="tel:112"><Phone size={17} aria-hidden="true"/>112 · Экстренная служба</a><a className="button secondary" href="tel:103"><Phone size={17} aria-hidden="true"/>103 · Скорая помощь</a></div>
      <ol><li>Нажмите кнопку и подтвердите звонок на телефоне.</li><li>Назовите диспетчеру, где Вы находитесь и что произошло.</li><li>Если звонить трудно, попросите человека рядом помочь.</li></ol>
      <small className="field-hint">Номера экстренных служб РФ.</small>
    </div>
  </details>;
}
