import mark from "./assets/limbus-mark.svg";

export const productName = "Лимбус";

export function BrandIdentity() {
  return <><span className="brand-mark" aria-hidden="true"><img src={mark} width="30" height="24" alt=""/></span><span>{productName}</span></>;
}
