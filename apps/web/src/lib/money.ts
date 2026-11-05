/** Pesos with centavos, the way the store writes them: "₱1,250.00". */
export const formatPeso = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * POS-07: the VAT part of a VAT-inclusive total, total × rate ÷ (100 + rate), to the centavo.
 * ₱112.00 at 12% holds ₱12.00 VAT.
 */
export const vatPart = (total: number, rate: number) =>
  Math.round(((total * rate) / (100 + rate)) * 100) / 100;
