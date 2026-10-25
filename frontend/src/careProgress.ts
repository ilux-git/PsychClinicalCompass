export type TaskState = {status:string;verification_status:string};

export function careProgress(tasks:readonly TaskState[]) {
  return {
    active:tasks.filter(task=>task.status!=="done").length,
    awaiting:tasks.filter(task=>task.status==="done"&&task.verification_status==="pending").length,
    checked:tasks.filter(task=>task.status==="done"&&task.verification_status!=="pending").length,
  };
}

/** The API pending count also includes actions which have not been completed. */
export function verificationProgress(tasks:{action_done:number;verification:Record<string,number>}) {
  const resolved=tasks.verification.resolved??0;
  const notResolved=tasks.verification.not_resolved??0;
  const unknown=tasks.verification.unknown??0;
  const checked=resolved+notResolved+unknown;
  return {resolved,notResolved,unknown,checked,awaiting:Math.max(0,tasks.action_done-checked)};
}
