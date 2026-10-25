import { ArrowRight, Check, Coins } from "lucide-react";
import { Button, date, plural } from "./UI";
import "./participation-receipt.css";

export type AwardReceipt = {points:number;policy_version:string;recorded_at:string};
export type ParticipationConfirmation = {participation?:AwardReceipt|null;replayed?:boolean};

/** Confirmed ledger facts only: an absent receipt is not a zero-point award. */
export function ParticipationReceipt({result,progress}: {result:ParticipationConfirmation;progress?:()=>void}) {
  const receipt=result.participation;
  const points=receipt?`${receipt.points} ${plural(receipt.points,"балл","балла","баллов")}`:"";
  const title=!receipt?"Участие сохранено":receipt.points===0?"Сохранено без дополнительных баллов":
    result.replayed?`Ранее учтено: ${points}`:`+${points} за участие`;
  return <div className="participation-receipt" role="status">
    <span className="participation-receipt-icon" aria-hidden="true">{receipt&&receipt.points>0?<Coins size={22}/>:<Check size={22}/>}</span>
    <div className="participation-receipt-copy">
      <strong>{title}</strong>
      <p>{!receipt?"Отдельное подтверждение начисления пока недоступно. Баланс можно посмотреть в «Мой прогресс».":result.replayed?"Это прежняя запись начисления. Повторная отправка не добавила новые баллы.":receipt.points>0?"Баллы — за участие. Содержание ответа и самочувствие на награду не влияют.":"Записи и опросы остаются доступны. Баланс и условия начисления — в «Мой прогресс»."}</p>
      {receipt&&<small>По записи от {date(receipt.recorded_at)}</small>}
      {progress&&<Button variant="ghost" onClick={progress}>Мой прогресс<ArrowRight size={16}/></Button>}
    </div>
  </div>;
}
