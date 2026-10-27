export const clinicTimeZone="Europe/Moscow";
const dateParts=(instant:Date)=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{
  timeZone:clinicTimeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",
}).formatToParts(instant).map(part=>[part.type,part.value]));

export function clinicDay(instant=new Date()):string {
  const parts=dateParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function clinicInputValue(instant=new Date()):string {
  const parts=dateParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** New appointment/deadline inputs use the agreed Moscow wall clock. */
export function clinicInputToIso(value:string):string {
  return new Date(`${value}+03:00`).toISOString();
}
